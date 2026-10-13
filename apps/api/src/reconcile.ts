import { pool } from "./db.js";
import { WO_URL } from "./auth.js";
import { detail } from "./quotations.js";
import { WO_STATUS } from "./woPayload.js";
import { quotationCrmId } from "./woPush.js";

/**
 * Rekonsiliasi baca-saja CRM ↔ WO: `GET /api/integrations/crm/quotations?demo=include` (kunci integrasi yang sama, hanya dari env).
 * Tidak mengubah apa pun di CRM maupun WO. Membandingkan penawaran CRM (yang seharusnya ada di WO) dengan yang tercatat di WO.
 */
interface WoRow { crmId: string; number: string; rev: number; status: string; total: number; demo: boolean; marketingName: string | null; woNumber: string | null; woStatus: string | null; updatedAt: string }

async function fetchWo(): Promise<WoRow[]> {
  const key = process.env.CRM_INTEGRATION_KEY ?? "";
  if (!key) throw Object.assign(new Error("CRM_INTEGRATION_KEY belum diisi — tidak bisa membaca daftar rekonsiliasi dari WO"), { status: 400 });
  const out: WoRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page++) {
    const u = new URL(`${WO_URL()}/api/integrations/crm/quotations`);
    u.searchParams.set("demo", "include"); u.searchParams.set("limit", "500"); if (cursor) u.searchParams.set("cursor", cursor);
    let r: Response;
    try { r = await fetch(u, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(30_000) }); }
    catch { throw Object.assign(new Error("WO tidak terjangkau saat membaca daftar rekonsiliasi"), { status: 502 }); }
    if (!r.ok) throw Object.assign(new Error(`WO menolak daftar rekonsiliasi (HTTP ${r.status})${r.status === 404 ? " — WO belum menyediakan endpoint ini" : ""}`), { status: 502 });
    const j: any = await r.json().catch(() => ({}));
    out.push(...(Array.isArray(j.data) ? j.data : []));
    cursor = j.nextCursor ?? null;
    if (!cursor) return out;
  }
  throw Object.assign(new Error("Daftar WO terlalu panjang (>20.000) — dihentikan"), { status: 502 });
}

const money = (n: number) => Math.round(n * 100) / 100;

export async function reconcile() {
  const wo = await fetchWo();
  const byCrm = new Map(wo.map((w) => [w.crmId, w]));
  const rows = (await pool.query("SELECT * FROM quotations WHERE deleted_at IS NULL ORDER BY id")).rows;
  const pending = new Set((await pool.query("SELECT ref_id FROM wo_outbox WHERE kind='QUOTATION' AND status IN ('PENDING','BLOCKED')")).rows.map((r) => String(r.ref_id)));
  const seen = new Set<string>();
  const missing: any[] = [], diff: any[] = [], demoLeft: any[] = [];
  let matched = 0;
  for (const row of rows) {
    const id = quotationCrmId(row.id), w = byCrm.get(id);
    const expect = WO_STATUS[row.status]; // status yang seharusnya dilihat WO (null = tidak dikirim: DRAFT/menunggu/disetujui)
    if (row.is_demo) {
      // demo hanya relevan bila pernah dikirim sebagai uji sambung
      if (!row.wo_test_at) continue;
      seen.add(id);
      if (!w) { missing.push({ crmId: id, number: row.number, crmStatus: row.status, demo: true, note: "pernah dikirim sebagai uji sambung tetapi tidak ada di WO (sudah dibersihkan di WO?)" }); continue; }
    } else {
      if (!expect) { if (w) seen.add(id); continue; }
      if (expect === "LOST" && !row.wo_synced_at && !w) continue; // LOST yang tak pernah terkirim memang tidak dikirim
      seen.add(id);
      if (!w) { missing.push({ crmId: id, number: row.number, crmStatus: row.status, demo: false, queued: pending.has(String(row.id)), note: pending.has(String(row.id)) ? "menunggu/ditahan di antrean kirim" : "belum terkirim ke WO" }); continue; }
    }
    seen.add(id);
    const d = await detail(row);
    const problems: string[] = [];
    if (expect && w.status !== expect) problems.push(`status CRM ${row.status} (→${expect}) ≠ WO ${w.status}`);
    if (w.rev !== row.rev) problems.push(`revisi CRM ${row.rev} ≠ WO ${w.rev}`);
    if (money(w.total) !== money(d.total)) problems.push(`total CRM ${money(d.total)} ≠ WO ${money(w.total)}`);
    if (row.status === "ACCEPTED" && !w.woNumber && !row.is_demo) problems.push("WON tetapi WO belum membentuk order");
    if (problems.length) diff.push({ crmId: id, number: row.number, demo: !!row.is_demo, crmStatus: row.status, woStatus: w.status, crmTotal: money(d.total), woTotal: money(w.total), crmRev: row.rev, woRev: w.rev, woNumber: w.woNumber, queued: pending.has(String(row.id)), problems });
    else matched++;
  }
  const onlyInWo = wo.filter((w) => !seen.has(w.crmId) && !w.demo).map((w) => ({ crmId: w.crmId, number: w.number, status: w.status, total: money(w.total), woNumber: w.woNumber }));
  const crmIds = new Set(rows.map((r) => quotationCrmId(r.id)));
  for (const w of wo) if (w.demo) demoLeft.push({ crmId: w.crmId, number: w.number, status: w.status, total: money(w.total), woNumber: w.woNumber, inCrm: crmIds.has(w.crmId) });
  return {
    checkedAt: new Date().toISOString(), woCount: wo.length, matched,
    missingInWo: missing, mismatched: diff, onlyInWo, demoInWo: demoLeft,
    ok: !missing.length && !diff.length && !onlyInWo.length,
  };
}
