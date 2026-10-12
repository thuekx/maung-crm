import { pool } from "./db.js";
import { WO_URL } from "./auth.js";
import { normalizePhone, phoneSuffix } from "./phone.js";
import { refreshLeadLinks } from "./leads.js";

/**
 * Sinkron cermin BACA-SAJA dari Export API Maung WO (`GET {WO_URL}/api/export/<resource>`, header x-api-key).
 * Kunci (WO_EXPORT_API_KEY) hanya di .env CRM dan tidak pernah dicatat/ditampilkan.
 * `since` di WO saat ini memfilter createdAt (perubahan status tidak terlihat) → tarik PENUH tiap siklus; baris yang tak ada lagi dihapus dari cermin.
 */
const KEY = () => process.env.WO_EXPORT_API_KEY ?? "";
export const syncEnabled = () => KEY().length > 0;
const PAGE = 5000;
const MAX_PAGES = 200;

type Row = Record<string, any>;

class MissingResource extends Error {}

async function fetchAll(resource: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const u = new URL(`${WO_URL()}/api/export/${resource}`);
    u.searchParams.set("limit", String(PAGE));
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: { "x-api-key": KEY() }, signal: AbortSignal.timeout(60_000) });
    if (r.status === 404) throw new MissingResource(resource);
    if (r.status === 401) throw new Error("Export API menolak kunci (401) — periksa WO_EXPORT_API_KEY");
    if (r.status === 503) throw new Error("Export API nonaktif di WO (EXPORT_API_KEY belum diisi di WO)");
    if (!r.ok) throw new Error(`Export API ${resource}: HTTP ${r.status}`);
    const d = (await r.json()) as { data?: Row[]; nextCursor?: string | null };
    if (!Array.isArray(d.data)) throw new Error(`Export API ${resource}: respons tidak sesuai`);
    out.push(...d.data);
    if (!d.nextCursor) return out;
    cursor = d.nextCursor;
  }
  throw new Error(`Export API ${resource}: terlalu banyak halaman`);
}

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const t = (v: unknown) => { const d = typeof v === "string" ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

async function replaceAll(table: string, key: string, cols: string, recordset: string, rows: Row[], conflictSet: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    for (let i = 0; i < rows.length; i += 2000) {
      await c.query(
        `INSERT INTO ${table} (${cols}, synced_at) SELECT ${cols}, now() FROM jsonb_to_recordset($1::jsonb) AS x(${recordset})
         ON CONFLICT (${key}) DO UPDATE SET ${conflictSet}, synced_at=now()`,
        [JSON.stringify(rows.slice(i, i + 2000))],
      );
    }
    await c.query(`DELETE FROM ${table} WHERE ${key} <> ALL($1::text[])`, [rows.map((r) => r[key])]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
const upd = (cols: string[]) => cols.map((c) => `${c}=EXCLUDED.${c}`).join(", ");

async function syncCustomers() {
  const data = await fetchAll("customers");
  const rows = data.filter((r) => s(r.code) && s(r.name)).map((r) => {
    const p = normalizePhone(r.phone);
    return {
      code: s(r.code), name: s(r.name), phone: s(r.phone), phone_norm: p.e164, phone_digits: p.digits || null, phone_suffix: phoneSuffix(p),
      email: s(r.email), address: s(r.address), package_name: s(r.packageName), status: s(r.status), radius_status: s(r.radiusStatus),
      sales_name: s(r.salesName), area_name: s(r.areaName), wo_source: s(r.source), activated_at: t(r.activatedAt), wo_created_at: t(r.createdAt),
    };
  });
  const cols = "code,name,phone,phone_norm,phone_digits,phone_suffix,email,address,package_name,status,radius_status,sales_name,area_name,wo_source,activated_at,wo_created_at";
  const rec = "code text,name text,phone text,phone_norm text,phone_digits text,phone_suffix text,email text,address text,package_name text,status text,radius_status text,sales_name text,area_name text,wo_source text,activated_at timestamptz,wo_created_at timestamptz";
  await replaceAll("wo_customers", "code", cols, rec, rows, upd(cols.split(",").slice(1)));
  return rows.length;
}

async function syncSubscriptions() {
  const data = await fetchAll("subscriptions");
  const rows = data.filter((r) => s(r.regNo)).map((r) => {
    const p = normalizePhone(r.phone);
    return {
      reg_no: s(r.regNo), form_date: t(r.formDate), name: s(r.name), phone: s(r.phone), phone_norm: p.e164, phone_digits: p.digits || null,
      address: s(r.address), package_name: s(r.packageName), source: s(r.source), marketing_name: s(r.marketingName),
      customer_code: s(r.customerCode), wo_number: s(r.woNumber), wo_created_at: t(r.createdAt),
    };
  });
  const cols = "reg_no,form_date,name,phone,phone_norm,phone_digits,address,package_name,source,marketing_name,customer_code,wo_number,wo_created_at";
  const rec = "reg_no text,form_date timestamptz,name text,phone text,phone_norm text,phone_digits text,address text,package_name text,source text,marketing_name text,customer_code text,wo_number text,wo_created_at timestamptz";
  await replaceAll("wo_subscriptions", "reg_no", cols, rec, rows, upd(cols.split(",").slice(1)));
  return rows.length;
}

/** `packages` belum tentu ada di WO (permintaan perubahan WO): bila 404, turunkan dari nama paket yang dipakai pelanggan/langganan. */
async function syncPackages(): Promise<{ rows: number; mode: string }> {
  try {
    const data = await fetchAll("packages");
    const rows = data.filter((r) => s(r.name)).map((r) => ({ name: s(r.name), kind: s(r.kind) ?? "INTERNET", speed: s(r.speed), price_sell: num(r.priceSell), unit: s(r.unit), active: r.active !== false, origin: "EXPORT" }));
    const cols = "name,kind,speed,price_sell,unit,active,origin";
    await replaceAll("wo_packages", "name", cols, "name text,kind text,speed text,price_sell numeric,unit text,active boolean,origin text", rows, upd(cols.split(",").slice(1)));
    return { rows: rows.length, mode: "full" };
  } catch (e) {
    if (!(e instanceof MissingResource)) throw e;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO wo_packages (name, origin, synced_at) SELECT DISTINCT package_name, 'DERIVED', now() FROM wo_customers WHERE package_name IS NOT NULL
         ON CONFLICT (name) DO UPDATE SET synced_at=now()`);
      await c.query("DELETE FROM wo_packages WHERE origin='DERIVED' AND name NOT IN (SELECT package_name FROM wo_customers WHERE package_name IS NOT NULL)");
      const n = (await c.query("SELECT count(*)::int AS n FROM wo_packages")).rows[0].n as number;
      await c.query("COMMIT");
      return { rows: n, mode: "derived" };
    } catch (e2) { await c.query("ROLLBACK"); throw e2; } finally { c.release(); }
  }
}

async function syncAreas(): Promise<{ rows: number; mode: string }> {
  try {
    const data = await fetchAll("areas");
    const rows = data.filter((r) => s(r.name) && r.active !== false).map((r) => ({ name: s(r.name), code: s(r.code), origin: "EXPORT" }));
    await replaceAll("wo_areas", "name", "name,code,origin", "name text,code text,origin text", rows, upd(["code", "origin"]));
    return { rows: rows.length, mode: "full" };
  } catch (e) {
    if (!(e instanceof MissingResource)) throw e;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO wo_areas (name, origin, synced_at) SELECT DISTINCT area_name, 'DERIVED', now() FROM wo_customers WHERE area_name IS NOT NULL
         ON CONFLICT (name) DO UPDATE SET synced_at=now()`);
      await c.query("DELETE FROM wo_areas WHERE origin='DERIVED' AND name NOT IN (SELECT area_name FROM wo_customers WHERE area_name IS NOT NULL)");
      const n = (await c.query("SELECT count(*)::int AS n FROM wo_areas")).rows[0].n as number;
      await c.query("COMMIT");
      return { rows: n, mode: "derived" };
    } catch (e2) { await c.query("ROLLBACK"); throw e2; } finally { c.release(); }
  }
}

async function record(resource: string, ok: { rows: number; mode: string } | null, err?: unknown) {
  const msg = err ? String((err as Error).message ?? err).slice(0, 300) : null;
  await pool.query(
    `INSERT INTO wo_sync_state (resource,last_run_at,last_ok_at,rows,mode,last_error) VALUES ($1,now(),CASE WHEN $4::text IS NULL THEN now() END,$2,$3,$4)
     ON CONFLICT (resource) DO UPDATE SET last_run_at=now(), last_error=$4,
       last_ok_at=CASE WHEN $4::text IS NULL THEN now() ELSE wo_sync_state.last_ok_at END,
       rows=COALESCE($2, wo_sync_state.rows), mode=COALESCE($3, wo_sync_state.mode)`,
    [resource, ok?.rows ?? null, ok?.mode ?? null, msg],
  );
}

let running = false;
export interface SyncResult { ok: boolean; skipped?: string; errors: Record<string, string> }

/** Satu siklus: customers → subscriptions → packages → areas (packages/areas turunan memakai customers yang baru). Gagal satu resource tidak menghentikan yang lain. */
export async function runSync(): Promise<SyncResult> {
  if (!syncEnabled()) return { ok: false, skipped: "WO_EXPORT_API_KEY belum diisi", errors: {} };
  if (running) return { ok: false, skipped: "sinkron sedang berjalan", errors: {} };
  running = true;
  const errors: Record<string, string> = {};
  try {
    const steps: [string, () => Promise<{ rows: number; mode: string }>][] = [
      ["customers", async () => ({ rows: await syncCustomers(), mode: "full" })],
      ["subscriptions", async () => ({ rows: await syncSubscriptions(), mode: "full" })],
      ["packages", syncPackages],
      ["areas", syncAreas],
    ];
    for (const [name, fn] of steps) {
      try { await record(name, await fn()); }
      catch (e) { errors[name] = String((e as Error).message ?? e); await record(name, null, e); }
    }
    if (!errors.customers) await refreshLeadLinks().catch((e) => { errors.leads = String((e as Error).message ?? e); });
    return { ok: Object.keys(errors).length === 0, errors };
  } finally { running = false; }
}

export async function syncStatus() {
  const r = await pool.query(`SELECT resource, last_ok_at AS "lastOkAt", last_run_at AS "lastRunAt", rows, mode, last_error AS "lastError" FROM wo_sync_state ORDER BY resource`);
  return { enabled: syncEnabled(), running, intervalMin: intervalMin(), resources: r.rows };
}

const intervalMin = () => Math.max(5, Number(process.env.SYNC_INTERVAL_MIN ?? 30) || 30);

/** Jadwal berkala (dipanggil dari index.ts, bukan dari createApp). */
export function startWoSync() {
  if (!syncEnabled()) { console.log("sinkron WO nonaktif: WO_EXPORT_API_KEY kosong"); return; }
  const tick = () => runSync().then((r) => { if (!r.ok && r.skipped == null) console.error("sinkron WO gagal sebagian:", r.errors); }).catch((e) => console.error("sinkron WO:", e));
  setTimeout(tick, 20_000).unref();
  setInterval(tick, intervalMin() * 60_000).unref();
}

/** Cari pelanggan WO menurut nomor: `exact` = E.164 sama (kuat); `weak` = 9 digit terakhir sama tetapi bukan exact (saran manual). */
export async function lookupByPhone(raw: string) {
  const p = normalizePhone(raw);
  const cols = `code, name, phone, address, package_name AS "packageName", status, radius_status AS "radiusStatus", sales_name AS "salesName", area_name AS "areaName", wo_created_at AS "createdAt", activated_at AS "activatedAt"`;
  const key = p.e164;
  const exact = key || p.digits
    ? (await pool.query(`SELECT ${cols} FROM wo_customers WHERE ${key ? "phone_norm=$1" : "phone_digits=$1"} ORDER BY wo_created_at DESC NULLS LAST LIMIT 20`, [key ?? p.digits])).rows
    : [];
  const sfx = phoneSuffix(p);
  const weak = sfx
    ? (await pool.query(`SELECT ${cols} FROM wo_customers WHERE phone_suffix=$1 AND code <> ALL($2::text[]) ORDER BY wo_created_at DESC NULLS LAST LIMIT 20`, [sfx, exact.map((x: any) => x.code)])).rows
    : [];
  return { normalized: p.e164, valid: p.valid, exact, weak };
}
