import { pool } from "./db.js";
import { WO_URL } from "./auth.js";
import { detail } from "./quotations.js";
import { quotationWoPayload, WO_STATUS } from "./woPayload.js";
import { getSetting } from "./settings.js";

/**
 * Antrean kirim CRM → WO (kontrak: docs/API.md WO, "Integrasi CRM → WO").
 *   PUT /api/integrations/crm/catalog/:crmId      PUT|GET /api/integrations/crm/quotations/:crmId      header x-api-key
 * Kunci (CRM_INTEGRATION_KEY) hanya dibaca dari lingkungan, tidak pernah dicatat/ditampilkan/disimpan di DB.
 * Hasil: 2xx → DONE; 400/404/409/422 → BLOCKED (butuh perbaikan manusia, tidak diulang); 401/403/429/5xx/jaringan → dicoba lagi bertahap.
 */
const KEY = () => process.env.CRM_INTEGRATION_KEY ?? "";
export const pushEnabled = () => KEY().length > 0 && (process.env.WO_SYNC_ENABLED ?? "1") !== "0";
export const catalogCrmId = (id: number | string) => `catalog-${id}`;
export const quotationCrmId = (id: number | string) => `quotation-${id}`;

type Q = { query: typeof pool.query };

/** Tandai entitas perlu dikirim (idempoten: satu baris PENDING per entitas). */
export async function enqueue(kind: "CATALOG" | "QUOTATION", refId: number | string, db: Q = pool) {
  const crmId = kind === "CATALOG" ? catalogCrmId(refId) : quotationCrmId(refId);
  // Baris demo (is_demo) TIDAK PERNAH diantre ke WO.
  const demo = await db.query(kind === "CATALOG" ? "SELECT is_demo FROM catalog_items WHERE id=$1" : "SELECT is_demo FROM quotations WHERE id=$1", [refId]);
  if (demo.rows[0]?.is_demo) return;
  await db.query(
    `INSERT INTO wo_outbox (kind, ref_id, crm_id) VALUES ($1,$2,$3)
     ON CONFLICT (kind, ref_id) WHERE status='PENDING' DO UPDATE SET next_attempt_at=now(), updated_at=now()`,
    [kind, refId, crmId]);
}

/** Bawa yang belum pernah tersinkron (mis. data lama sebelum integrasi aktif) ke antrean. */
export async function enqueueBackfill(): Promise<number> {
  const c = await pool.query(`SELECT id FROM catalog_items WHERE NOT is_demo AND wo_synced_at IS NULL AND NOT EXISTS (SELECT 1 FROM wo_outbox o WHERE o.kind='CATALOG' AND o.ref_id=catalog_items.id AND o.status IN ('PENDING','BLOCKED'))`);
  const q = await pool.query(
    `SELECT id FROM quotations WHERE deleted_at IS NULL AND NOT is_demo AND status IN ('SENT','ACCEPTED','REJECTED','EXPIRED')
       AND (wo_synced_rev IS DISTINCT FROM rev OR wo_synced_status IS DISTINCT FROM CASE status WHEN 'SENT' THEN 'QUOTED' WHEN 'ACCEPTED' THEN 'WON' ELSE 'LOST' END
            OR (status='ACCEPTED' AND wo_number IS NULL))
       AND NOT EXISTS (SELECT 1 FROM wo_outbox o WHERE o.kind='QUOTATION' AND o.ref_id=quotations.id AND o.status IN ('PENDING','BLOCKED'))`);
  for (const r of c.rows) await enqueue("CATALOG", r.id);
  for (const r of q.rows) await enqueue("QUOTATION", r.id);
  return c.rowCount! + q.rowCount!;
}

class PushError extends Error { constructor(public http: number | null, msg: string, public permanent: boolean) { super(msg); } }

async function put(path: string, body: unknown): Promise<{ http: number; data: any }> {
  let r: Response;
  try {
    r = await fetch(`${WO_URL()}/api/integrations/crm/${path}`, {
      method: "PUT", headers: { "x-api-key": KEY(), "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
  } catch (e) { throw new PushError(null, `WO tidak terjangkau: ${(e as Error).name === "TimeoutError" ? "batas waktu" : "jaringan"}`, false); }
  const data: any = await r.json().catch(() => ({}));
  if (r.ok) return { http: r.status, data };
  const msg = String(data?.error ?? data?.message ?? `HTTP ${r.status}`).slice(0, 300);
  // 400/404/409/422 = ditolak karena isi (butuh perbaikan manusia). Lainnya (401/403 kunci, 429, 5xx) = sementara.
  throw new PushError(r.status, `WO menolak (${r.status}): ${msg}`, [400, 404, 409, 422].includes(r.status));
}

async function catalogPayload(id: number) {
  const c = (await pool.query("SELECT * FROM catalog_items WHERE id=$1", [id])).rows[0];
  if (!c || c.is_demo) return null; // demo tidak dikirim
  return { name: c.name, kind: c.kind, unit: c.unit, priceSell: Number(c.price), active: c.active, description: c.description ?? undefined, sku: c.sku ?? undefined };
}

async function pushCatalog(id: number) {
  const p = await catalogPayload(id);
  if (!p) return { skipped: true };
  try {
    const r = await put(`catalog/${catalogCrmId(id)}`, p);
    await pool.query("UPDATE catalog_items SET wo_synced_at=now(), wo_sync_error=NULL WHERE id=$1", [id]);
    return { http: r.http, data: r.data };
  } catch (e) {
    if (e instanceof PushError) await pool.query("UPDATE catalog_items SET wo_sync_error=$2 WHERE id=$1", [id, e.message]);
    throw e;
  }
}

async function pushQuotation(id: number) {
  const row = (await pool.query("SELECT * FROM quotations WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  if (!row || row.is_demo) return { skipped: true, demo: !!row?.is_demo }; // demo tidak pernah dikirim ke WO
  const q = await detail(row);
  // LOST hanya bermakna bila WO pernah menerima penawaran ini.
  if (WO_STATUS[q.status] === "LOST" && !row.wo_synced_at) return { skipped: true };
  const areaName = (await pool.query("SELECT area FROM leads WHERE id=$1", [row.lead_id])).rows[0]?.area;
  const areaCode = areaName ? (await pool.query("SELECT code FROM wo_areas WHERE lower(name)=lower($1) AND code IS NOT NULL", [areaName])).rows[0]?.code ?? null : null;
  const payload = quotationWoPayload(q, { areaCode });
  if (!payload) return { skipped: true };
  // WON yang sudah terkirim tetapi belum punya nomor order WO (mis. dikirim sebelum Tahap 2b aktif di WO) dikirim ulang agar WO membentuk order.
  const wonWithoutOrder = payload.status === "WON" && !row.wo_number;
  if (row.wo_synced_rev === payload.rev && row.wo_synced_status === payload.status && !wonWithoutOrder) return { skipped: true, already: true };
  // Katalog yang dipakai harus sudah ada di WO (agar SKU/jenis terpetakan): kirim dulu bila belum/berubah.
  const cats = (await pool.query("SELECT DISTINCT c.id, c.wo_synced_at, c.name FROM quotation_lines l JOIN catalog_items c ON c.id=l.catalog_id WHERE l.quotation_id=$1", [id])).rows;
  for (const c of cats) {
    if (c.wo_synced_at) continue;
    try { await pushCatalog(Number(c.id)); }
    catch (e) { if (e instanceof PushError) throw new PushError(e.http, `Katalog "${c.name}" gagal disinkron: ${e.message}`, e.permanent); throw e; }
  }
  const r = await put(`quotations/${quotationCrmId(id)}`, payload);
  await pool.query(
    `UPDATE quotations SET wo_synced_at=now(), wo_synced_rev=$2, wo_synced_status=$3, wo_number=COALESCE($4, wo_number), wo_warnings=$5 WHERE id=$1`,
    [id, payload.rev, payload.status, r.data?.woNumber ?? null, r.data?.warnings ? JSON.stringify(r.data.warnings) : null]);
  return { http: r.http, data: r.data };
}

/**
 * UJI SAMBUNG (aksi eksplisit Admin): kirim satu penawaran DEMO ke WO dengan `demo:true`. Tidak lewat antrean, tidak mengubah wo_synced_*,
 * dan penawaran demo yang tidak dikirim lewat aksi ini tetap tidak pernah keluar. Hasil disimpan di kolom wo_test_*.
 */
export async function sendTestQuotation(id: number): Promise<{ ok: boolean; message: string; woNumber?: string | null }> {
  if (!pushEnabled()) throw new PushError(null, "Kirim ke WO nonaktif (CRM_INTEGRATION_KEY kosong atau WO_SYNC_ENABLED=0)", true);
  const row = (await pool.query("SELECT * FROM quotations WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  if (!row) throw new PushError(404, "Penawaran tidak ditemukan", true);
  if (!row.is_demo) throw new PushError(400, "Hanya penawaran demo yang boleh dikirim sebagai uji sambung", true);
  const q = await detail(row);
  const areaName = (await pool.query("SELECT area FROM leads WHERE id=$1", [row.lead_id])).rows[0]?.area;
  const areaCode = areaName ? (await pool.query("SELECT code FROM wo_areas WHERE lower(name)=lower($1) AND code IS NOT NULL", [areaName])).rows[0]?.code ?? null : null;
  let payload: ReturnType<typeof quotationWoPayload>;
  try { payload = quotationWoPayload(q, { areaCode, demo: true }); } catch (e) { throw new PushError(400, (e as Error).message, true); }
  if (!payload) throw new PushError(400, `Status ${q.status} tidak dikirim ke WO (hanya SENT, ACCEPTED, REJECTED, EXPIRED, CANCELLED)`, true);
  try {
    const r = await put(`quotations/${quotationCrmId(id)}`, payload);
    const no = r.data?.woNumber ?? null;
    await pool.query("UPDATE quotations SET wo_test_at=now(), wo_test_rev=$2, wo_test_status=$3, wo_test_number=COALESCE($4, wo_test_number), wo_test_error=NULL WHERE id=$1", [id, payload.rev, payload.status, no]);
    return { ok: true, message: `${q.number}: terkirim sebagai ${payload.status}${no ? ` (order ${no})` : ""}`, woNumber: no };
  } catch (e) {
    if (e instanceof PushError) { await pool.query("UPDATE quotations SET wo_test_error=$2 WHERE id=$1", [id, e.message]); return { ok: false, message: `${q.number}: ${e.message}` }; }
    throw e;
  }
}

const backoffMin = (attempts: number) => Math.min(60, 2 ** Math.min(attempts, 6)); // 1,2,4,8,16,32,60 menit

let running = false;
/** Proses satu siklus: semua baris PENDING yang jatuh tempo, berurutan (id naik). */
export async function processOutbox(): Promise<{ done: number; blocked: number; retry: number }> {
  const out = { done: 0, blocked: 0, retry: 0 };
  if (!pushEnabled() || running || (await getSetting("woSync")).paused) return out; // sakelar Pengaturan CRM → "Jeda kirim ke WO"
  running = true;
  try {
    // Katalog lebih dulu agar penawaran yang merujuknya tidak menunggu putaran berikutnya.
    const due = await pool.query(`SELECT * FROM wo_outbox WHERE status='PENDING' AND next_attempt_at <= now() ORDER BY (kind='QUOTATION'), id LIMIT 100`);
    // pengaman ganda: baris outbox milik data demo (mis. dibuat sebelum penanda) ditutup tanpa menghubungi WO
    for (const j of due.rows) {
      const d = await pool.query(j.kind === "CATALOG" ? "SELECT is_demo FROM catalog_items WHERE id=$1" : "SELECT is_demo FROM quotations WHERE id=$1", [j.ref_id]);
      if (d.rows[0]?.is_demo) { await pool.query(`UPDATE wo_outbox SET status='DONE', response='{"skipped":"demo"}', done_at=now(), updated_at=now() WHERE id=$1`, [j.id]); j.skip = true; }
    }
    due.rows = due.rows.filter((j: any) => !j.skip);
    for (const job of due.rows) {
      try {
        const r = job.kind === "CATALOG" ? await pushCatalog(Number(job.ref_id)) : await pushQuotation(Number(job.ref_id));
        await pool.query(`UPDATE wo_outbox SET status='DONE', attempts=attempts+1, last_http=$2, last_error=NULL, response=$3, done_at=now(), updated_at=now() WHERE id=$1`,
          [job.id, (r as any).http ?? null, JSON.stringify((r as any).data ?? { skipped: (r as any).skipped ?? true })]);
        out.done++;
      } catch (e) {
        const pe = e instanceof PushError ? e : new PushError(null, "Kesalahan tak terduga saat mengirim ke WO", false);
        if (!(e instanceof PushError)) console.error("woPush:", (e as Error).message);
        if (pe.permanent) {
          await pool.query(`UPDATE wo_outbox SET status='BLOCKED', attempts=attempts+1, last_http=$2, last_error=$3, updated_at=now() WHERE id=$1`, [job.id, pe.http, pe.message]);
          if (job.kind === "QUOTATION") await pool.query("UPDATE quotations SET wo_warnings=$2 WHERE id=$1", [job.ref_id, JSON.stringify({ error: pe.message })]);
          out.blocked++;
        } else {
          await pool.query(`UPDATE wo_outbox SET attempts=attempts+1, last_http=$2, last_error=$3, next_attempt_at=now() + make_interval(mins => $4), updated_at=now() WHERE id=$1`,
            [job.id, pe.http, pe.message, backoffMin(job.attempts + 1)]);
          out.retry++;
        }
      }
    }
    return out;
  } finally { running = false; }
}

export async function outboxStatus() {
  const c = (await pool.query(`SELECT status, count(*)::int n FROM wo_outbox WHERE status IN ('PENDING','BLOCKED') GROUP BY status`)).rows;
  const get = (s: string) => c.find((x) => x.status === s)?.n ?? 0;
  const problems = (await pool.query(
    `SELECT id, kind, ref_id AS "refId", crm_id AS "crmId", status, attempts, last_http AS "lastHttp", last_error AS "lastError", next_attempt_at AS "nextAttemptAt", updated_at AS "updatedAt"
     FROM wo_outbox WHERE status IN ('PENDING','BLOCKED') AND (status='BLOCKED' OR attempts > 0) ORDER BY id DESC LIMIT 50`)).rows;
  return { enabled: pushEnabled() && !(await getSetting("woSync")).paused, keySet: KEY().length > 0, paused: (await getSetting("woSync")).paused, pending: get("PENDING"), blocked: get("BLOCKED"), problems };
}

/** Coba lagi yang BLOCKED (setelah data diperbaiki) — membuat baris PENDING baru. */
export async function retryJob(id: number): Promise<boolean> {
  const j = (await pool.query("SELECT * FROM wo_outbox WHERE id=$1 AND status='BLOCKED'", [id])).rows[0];
  if (!j) return false;
  await enqueue(j.kind, j.ref_id);
  await pool.query("UPDATE wo_outbox SET status='DONE', last_error=COALESCE(last_error,'') || ' [dicoba ulang]', updated_at=now() WHERE id=$1", [id]);
  return true;
}

export function startWoPush() {
  if (!pushEnabled()) { console.log("kirim ke WO nonaktif (CRM_INTEGRATION_KEY kosong atau WO_SYNC_ENABLED=0)"); return; }
  const tick = () => enqueueBackfill().then(() => processOutbox()).catch((e) => console.error("kirim ke WO:", (e as Error).message));
  setTimeout(tick, 25_000).unref();
  setInterval(() => processOutbox().catch((e) => console.error("kirim ke WO:", (e as Error).message)), 60_000).unref();
  setInterval(() => enqueueBackfill().catch(() => {}), 3_600_000).unref();
}
