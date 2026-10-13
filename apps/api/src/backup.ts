import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import pg from "pg";
import { storage } from "./storage.js";

/**
 * Backup / restore / purge data CRM (Admin → Data & Backup) — padanan menu yang sama di Maung WO.
 * Format: NDJSON ter-gzip (`*.json.gz`): baris 1 = header (format, versi, migrasi skema, kolom per tabel), lalu {"t": tabel, "rows": [...]}.
 * Tabel ditulis berurutan menurut FK. Foto/berkas ada di Garage (bukan di database) dan dicadangkan lewat scripts/garage-backup.sh milik WO.
 */
export const backupDir = () => path.resolve(process.env.BACKUP_DIR ?? "./backups");
const FORMAT = "maung-crm-backup"; // berbeda dari "maung-backup" (WO) agar berkas WO tidak bisa dipulihkan ke CRM
const VERSION = 1;
const SKIP = new Set(["schema_migrations"]);

const connect = async () => { const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://postgres@localhost:5432/maung_crm" }); await c.connect(); return c; };
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export type BackupKind = "manual" | "auto" | "pre-purge" | "pre-restore";
export interface Meta { name: string; size: number; createdAt: string; kind: string; note?: string; by?: string; migration?: string; tables?: Record<string, number>; valid: boolean; error?: string }

/** Tabel aplikasi urut menurut FK (induk dulu) + kolomnya. */
async function schema(c: pg.Client) {
  const cols = (await c.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`)).rows as { table_name: string; column_name: string }[];
  const byTable = new Map<string, string[]>();
  for (const r of cols) if (!SKIP.has(r.table_name)) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.column_name]);
  const fks = (await c.query(`SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent FROM pg_constraint WHERE contype='f'`)).rows as { child: string; parent: string }[];
  const clean = (s: string) => s.replace(/^"|"$/g, "").replace(/^public\./, "").replace(/"/g, "");
  const deps = new Map<string, Set<string>>();
  for (const t of byTable.keys()) deps.set(t, new Set());
  for (const f of fks) { const ch = clean(f.child), pa = clean(f.parent); if (ch !== pa && deps.has(ch) && deps.has(pa)) deps.get(ch)!.add(pa); }
  const order: string[] = [];
  const left = new Set(byTable.keys());
  while (left.size) {
    const ready = [...left].filter((t) => [...deps.get(t)!].every((p) => !left.has(p))).sort();
    if (!ready.length) { order.push(...[...left].sort()); break; }
    for (const t of ready) { order.push(t); left.delete(t); }
  }
  return { order, byTable };
}

async function latestMigration(c: pg.Client) {
  try { return ((await c.query(`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`)).rows[0]?.name as string) ?? ""; } catch { return ""; }
}

export async function createBackup(o: { kind: BackupKind; note?: string; by?: string }): Promise<Meta> {
  fs.mkdirSync(backupDir(), { recursive: true });
  const name = `crm-${o.kind}-${stamp()}.json.gz`;
  const file = path.join(backupDir(), name);
  const c = await connect();
  const out = fs.createWriteStream(file + ".tmp");
  const gz = zlib.createGzip({ level: 6 });
  gz.pipe(out);
  const write = (s: string) => new Promise<void>((res, rej) => gz.write(s, (e) => (e ? rej(e) : res())));
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { order, byTable } = await schema(c);
    const counts: Record<string, number> = {};
    for (const t of order) counts[t] = Number((await c.query(`SELECT count(*) AS n FROM ${q(t)}`)).rows[0].n);
    const cols: Record<string, string[]> = Object.fromEntries(order.map((t) => [t, byTable.get(t)!]));
    await write(JSON.stringify({ format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), kind: o.kind, note: o.note ?? null, by: o.by ?? null, migration: await latestMigration(c), tables: counts, columns: cols }) + "\n");
    for (const t of order) {
      if (!counts[t]) continue;
      await c.query(`DECLARE cur NO SCROLL CURSOR FOR SELECT to_jsonb(t) AS j FROM ${q(t)} t`);
      for (;;) {
        const r = await c.query("FETCH 500 FROM cur");
        if (!r.rows.length) break;
        await write(JSON.stringify({ t, rows: r.rows.map((x: { j: unknown }) => x.j) }) + "\n");
      }
      await c.query("CLOSE cur");
    }
    await c.query("COMMIT");
    await new Promise<void>((res, rej) => { out.on("finish", () => res()); out.on("error", rej); gz.end(); });
    fs.renameSync(file + ".tmp", file);
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* sudah selesai */ }
    gz.destroy(); out.destroy(); fs.rmSync(file + ".tmp", { force: true });
    throw e;
  } finally { await c.end(); }
  return (await readMeta(name))!;
}

/** Baca header backup (baris pertama) tanpa memuat seluruh berkas. */
export async function readMeta(name: string): Promise<Meta | null> {
  const file = path.join(backupDir(), name);
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  const base: Meta = { name, size: st.size, createdAt: st.mtime.toISOString(), kind: "unknown", valid: false };
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let line = "";
    for await (const l of rl) { line = l; break; }
    rl.close();
    const h = JSON.parse(line);
    if (h.format !== FORMAT) return { ...base, error: "Bukan berkas backup CRM" };
    return { ...base, createdAt: h.createdAt ?? base.createdAt, kind: h.kind ?? "manual", note: h.note ?? undefined, by: h.by ?? undefined, migration: h.migration, tables: h.tables, valid: true };
  } catch { return { ...base, error: "Berkas rusak / bukan backup CRM" }; }
}

export async function listBackups(): Promise<Meta[]> {
  if (!fs.existsSync(backupDir())) return [];
  const names = fs.readdirSync(backupDir()).filter((n) => /\.json\.gz$/.test(n));
  const metas = await Promise.all(names.map((n) => readMeta(n)));
  return (metas.filter(Boolean) as Meta[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Simpan hanya `keep` backup otomatis terbaru. */
export function pruneAuto(keep = 7) {
  if (!fs.existsSync(backupDir())) return;
  const autos = fs.readdirSync(backupDir()).filter((n) => /^crm-auto-.*\.json\.gz$/.test(n)).sort().reverse();
  for (const n of autos.slice(keep)) fs.rmSync(path.join(backupDir(), n), { force: true });
}

export const safeName = (n: string) => /^[A-Za-z0-9._-]+\.json\.gz$/.test(n) && !n.includes("..");

/** Setelah memasukkan baris dengan id eksplisit, majukan sequence (bigserial) agar id berikutnya tidak bentrok. */
async function fixSequences(c: pg.Client, tables: string[], byTable: Map<string, string[]>) {
  for (const t of tables) {
    if (!byTable.get(t)?.includes("id")) continue; // tabel tanpa kolom id (kunci teks/komposit) tidak punya sequence
    const seq = (await c.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [`"${t}"`])).rows[0]?.s;
    if (seq) await c.query(`SELECT setval($1, GREATEST((SELECT COALESCE(max(id),0) FROM ${q(t)}), 1), (SELECT count(*) FROM ${q(t)}) > 0)`, [seq]);
  }
}

export interface RestoreResult { tables: number; rows: number; adminKept: boolean; preBackup: string }
export async function restoreBackup(name: string, o: { includeSettings: boolean; keepAdminId?: string; by?: string }): Promise<RestoreResult> {
  const file = path.join(backupDir(), name);
  const meta = await readMeta(name);
  if (!meta || !meta.valid) throw new Error(meta?.error ?? "Backup tidak ditemukan");
  const pre = await createBackup({ kind: "pre-restore", note: `sebelum restore ${name}`, by: o.by });
  const c = await connect();
  try {
    const cur = await schema(c);
    const curMig = await latestMigration(c);
    if (meta.migration && curMig && meta.migration > curMig) throw new Error(`Backup dibuat pada versi skema lebih baru (${meta.migration}) daripada aplikasi ini (${curMig}). Perbarui aplikasi dulu.`);
    const adminRow = o.keepAdminId ? (await c.query(`SELECT to_jsonb(u) AS j FROM wo_user_cache u WHERE user_id=$1`, [o.keepAdminId])).rows[0]?.j : null;

    await c.query("BEGIN");
    await c.query("SAVEPOINT rep");
    try { await c.query(`SET LOCAL session_replication_role = replica`); } catch { await c.query("ROLLBACK TO SAVEPOINT rep"); } // butuh superuser; tanpa itu urutan FK dipakai
    const wipe = cur.order.filter((t) => o.includeSettings || t !== "crm_settings");
    await c.query(`TRUNCATE ${wipe.map(q).join(", ")} RESTART IDENTITY CASCADE`);

    const header = JSON.parse(await firstLine(file));
    let tables = 0, rows = 0;
    const seen = new Set<string>();
    const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let first = true;
    for await (const line of rl) {
      if (first) { first = false; continue; }
      if (!line.trim()) continue;
      const { t, rows: chunk } = JSON.parse(line) as { t: string; rows: Record<string, unknown>[] };
      if (!cur.byTable.has(t) || (t === "crm_settings" && !o.includeSettings)) continue;
      const have = new Set(cur.byTable.get(t)!);
      const cols = ((header.columns?.[t] as string[] | undefined) ?? Object.keys(chunk[0] ?? {})).filter((x) => have.has(x)); // kolom baru memakai default; kolom yang sudah dihapus diabaikan
      if (!cols.length) continue;
      const list = cols.map(q).join(", ");
      await c.query(`INSERT INTO ${q(t)} (${list}) SELECT ${list} FROM jsonb_populate_recordset(null::${q(t)}, $1::jsonb)`, [JSON.stringify(chunk)]);
      rows += chunk.length; if (!seen.has(t)) { seen.add(t); tables++; }
    }
    // Akun Admin yang sedang dipakai (cache identitas WO) harus tetap ada.
    let adminKept = true;
    if (o.keepAdminId && adminRow) {
      const ex = await c.query(`SELECT 1 FROM wo_user_cache WHERE user_id=$1`, [o.keepAdminId]);
      if (!ex.rowCount) {
        const cols = Object.keys(adminRow).filter((x) => cur.byTable.get("wo_user_cache")!.includes(x)).map(q).join(", ");
        await c.query(`INSERT INTO wo_user_cache (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(null::wo_user_cache, $1::jsonb)`, [JSON.stringify([adminRow])]);
        adminKept = false;
      }
    }
    await fixSequences(c, cur.order, cur.byTable);
    await c.query("COMMIT");
    return { tables, rows, adminKept, preBackup: pre.name };
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch { /* abaikan */ }
    throw e;
  } finally { await c.end(); }
}

async function firstLine(file: string) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) { rl.close(); return l; }
  return "{}";
}

/* ───────── Purge ───────── */
export type PurgeScope = 1 | 2 | 3;
// Urut anak → induk (aman terhadap FK). Pengaturan (crm_settings) dan akun Admin TIDAK pernah ikut terhapus.
const S1 = ["field_report_comments", "field_tasks", "field_photos", "field_report_items", "field_report_pics", "field_reports", "quotation_events", "quotation_revisions", "quotation_lines", "quotations", "lead_events", "leads", "wo_outbox", "audit_log", "quotation_counters", "crm_notifications"];
const S2 = ["wo_customers", "wo_subscriptions", "wo_work_orders", "wo_sync_state", "wo_packages", "wo_areas"];
const S3 = ["catalog_items"];

export interface PurgeOpts { scope?: PurgeScope; onlyDemo?: boolean; deleteUsers?: boolean; deleteFiles?: boolean; keepAdminId?: string }

export async function purgeData(o: PurgeOpts) {
  const c = await connect();
  const deleted: Record<string, number> = {};
  const files: string[] = [];
  let adminRow: Record<string, unknown> | null = null;
  try {
    await c.query("BEGIN");
    const del = async (t: string, where = "", args: unknown[] = []) => { const r = await c.query(`DELETE FROM ${q(t)} ${where}`, args); deleted[t] = (deleted[t] ?? 0) + (r.rowCount ?? 0); };
    if (o.keepAdminId) adminRow = (await c.query(`SELECT to_jsonb(u) AS j FROM wo_user_cache u WHERE user_id=$1`, [o.keepAdminId])).rows[0]?.j ?? null;
    if (o.onlyDemo) {
      // hanya baris isDemo (+ anak-anaknya); data nyata tidak tersentuh
      const rep = "(SELECT id FROM field_reports WHERE is_demo)", qt = "(SELECT id FROM quotations WHERE is_demo)";
      if (o.deleteFiles) for (const r of (await c.query(`SELECT original_path, watermark_path FROM field_photos WHERE report_id IN ${rep}`)).rows) { if (r.original_path) files.push(r.original_path); if (r.watermark_path) files.push(r.watermark_path); }
      await del("field_report_comments", `WHERE report_id IN ${rep}`);
      await del("field_tasks", `WHERE is_demo OR report_id IN ${rep}`);
      await del("field_photos", `WHERE report_id IN ${rep}`);
      await del("field_report_items", `WHERE report_id IN ${rep}`);
      await del("field_report_pics", `WHERE report_id IN ${rep}`);
      await del("field_reports", `WHERE is_demo`);
      await del("wo_outbox", `WHERE (kind='QUOTATION' AND ref_id IN ${qt}) OR (kind='CATALOG' AND ref_id IN (SELECT id FROM catalog_items WHERE is_demo))`);
      await del("quotations", `WHERE is_demo`); // baris, revisi, riwayat ikut (ON DELETE CASCADE)
      await del("leads", `WHERE is_demo AND id NOT IN (SELECT lead_id FROM quotations)`); // lead_events ikut
      await del("catalog_items", `WHERE is_demo AND id NOT IN (SELECT catalog_id FROM quotation_lines)`);
    } else {
      if (o.deleteFiles) for (const r of (await c.query(`SELECT original_path, watermark_path FROM field_photos`)).rows) { if (r.original_path) files.push(r.original_path); if (r.watermark_path) files.push(r.watermark_path); }
      for (const t of S1) await del(t);
      if ((o.scope ?? 1) >= 2) for (const t of S2) await del(t);
      if ((o.scope ?? 1) >= 3) for (const t of S3) await del(t);
      if (o.deleteUsers) await del("wo_user_cache", o.keepAdminId ? `WHERE user_id <> $1` : "", o.keepAdminId ? [o.keepAdminId] : []);
    }
    // pengaman: akun Admin yang sedang dipakai tetap ada
    if (o.keepAdminId && adminRow && !(await c.query(`SELECT 1 FROM wo_user_cache WHERE user_id=$1`, [o.keepAdminId])).rowCount) throw new Error("Pengaman: akun Admin Anda tidak ditemukan setelah pembersihan — dibatalkan");
    await c.query("COMMIT");
  } catch (e) { try { await c.query("ROLLBACK"); } catch { /* abaikan */ } throw e; } finally { await c.end(); }
  let removedFiles = 0;
  for (const k of files) { try { await storage().del(k); removedFiles++; } catch { /* sudah tidak ada / tak terjangkau */ } }
  return { deleted, removedFiles };
}

/* ───────── Ringkasan ───────── */
export async function overview(db: { query: pg.Pool["query"] }) {
  const n = async (sql: string) => Number((await db.query(sql)).rows[0].n);
  const [leads, quotations, catalog, reports, photos, tasks, customers, users, outbox] = await Promise.all([
    n("SELECT count(*) n FROM leads WHERE deleted_at IS NULL"), n("SELECT count(*) n FROM quotations WHERE deleted_at IS NULL"), n("SELECT count(*) n FROM catalog_items"),
    n("SELECT count(*) n FROM field_reports WHERE deleted_at IS NULL"), n("SELECT count(*) n FROM field_photos WHERE deleted_at IS NULL"), n("SELECT count(*) n FROM field_tasks WHERE deleted_at IS NULL"),
    n("SELECT count(*) n FROM wo_customers"), n("SELECT count(*) n FROM wo_user_cache"), n("SELECT count(*) n FROM wo_outbox WHERE status='PENDING'"),
  ]);
  const demo = {
    leads: await n("SELECT count(*) n FROM leads WHERE is_demo AND deleted_at IS NULL"), quotations: await n("SELECT count(*) n FROM quotations WHERE is_demo AND deleted_at IS NULL"),
    reports: await n("SELECT count(*) n FROM field_reports WHERE is_demo AND deleted_at IS NULL"), catalog: await n("SELECT count(*) n FROM catalog_items WHERE is_demo"),
  };
  return { counts: { leads, quotations, catalog, reports, photos, tasks, customersMirror: customers, users, outboxPending: outbox }, demo };
}
