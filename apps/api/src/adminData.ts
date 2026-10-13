import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { audit, pool } from "./db.js";
import { requireRealAdmin } from "./auth.js";
import { backupDir, createBackup, listBackups, overview, purgeData, readMeta, restoreBackup, safeName } from "./backup.js";
import { loadDemo } from "./demo.js";
import { getSetting, putSetting } from "./settings.js";
import { outboxStatus, sendTestQuotation } from "./woPush.js";
import { reconcile } from "./reconcile.js";

const fail = (status: number, error: string) => Object.assign(new Error(error), { status });
const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const aud = (req: Request, summary: string) => audit(req.user!.id, "admin_data", 0, "ACTION", null, { summary }).catch(() => {});

/** Admin → Data & Backup dan Pengaturan CRM. Hanya Admin ASLI WO (bukan peran lain, bukan Admin yang sedang "bertindak sebagai"). */
export const adminRoutes = Router();
adminRoutes.use("/admin", requireRealAdmin);

/* ── Pengaturan CRM ── */
adminRoutes.get("/admin/settings", ah(async (_req, res) => {
  const env = process.env;
  res.json({
    quotation: await getSetting("quotation"), woSync: await getSetting("woSync"),
    // status integrasi (hanya baca; nilai kunci TIDAK pernah dikirim)
    integration: {
      woUrl: env.WO_URL ?? null, exportKeySet: !!env.WO_EXPORT_API_KEY, integrationKeySet: !!env.CRM_INTEGRATION_KEY, syncIntervalMin: Number(env.SYNC_INTERVAL_MIN ?? 30),
      phoneRegion: (env.PHONE_DEFAULT_REGION ?? "ID").toUpperCase(), storage: env.STORAGE_DRIVER ?? "local", s3Endpoint: env.STORAGE_DRIVER === "s3" ? env.S3_ENDPOINT ?? null : null,
      wo: await outboxStatus(), envSwitchOff: env.WO_SYNC_ENABLED === "0",
    },
  });
}));
adminRoutes.put("/admin/settings", ah(async (req, res) => {
  const b = z.object({
    quotation: z.object({ taxRate: z.number().min(0).max(100), validDays: z.number().int().min(1).max(365), terms: z.string().trim().min(1).max(2000) }).optional(),
    woSync: z.object({ paused: z.boolean() }).optional(),
  }).parse(req.body);
  if (b.quotation) await putSetting("quotation", b.quotation, req.user!.id);
  if (b.woSync) await putSetting("woSync", b.woSync, req.user!.id);
  await aud(req, `Pengaturan CRM diubah: ${Object.keys(b).join(", ")}`);
  res.json({ quotation: await getSetting("quotation"), woSync: await getSetting("woSync") });
}));

/* ── Data & Backup ── */
function diskInfo() {
  try { const s = fs.statfsSync(fs.existsSync(backupDir()) ? backupDir() : "."); return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }; } catch { return null; }
}

adminRoutes.get("/admin/data/overview", ah(async (_req, res) => {
  res.json({
    ...(await overview(pool)), backups: await listBackups(), backupDir: backupDir(), disk: diskInfo(), autoDaily: (await getSetting("backup")).autoDaily,
    storage: { driver: process.env.STORAGE_DRIVER ?? "local", note: "Foto & berkas ada di Garage (bukan di database); cadangkan dengan scripts/garage-backup.sh di folder WO." },
  });
}));

adminRoutes.put("/admin/data/auto", ah(async (req, res) => {
  const { autoDaily } = z.object({ autoDaily: z.boolean() }).parse(req.body);
  await putSetting("backup", { autoDaily }, req.user!.id);
  res.json({ autoDaily });
}));

adminRoutes.post("/admin/data/backup", ah(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().max(120).optional() }).parse(req.body ?? {});
  const m = await createBackup({ kind: "manual", note, by: req.user!.name });
  await aud(req, `Backup data dibuat: ${m.name}`);
  res.status(201).json(m);
}));

adminRoutes.get("/admin/data/backups/:name/download", ah(async (req, res) => {
  const name = String(req.params.name);
  if (!safeName(name) || !fs.existsSync(path.join(backupDir(), name))) throw fail(404, "Backup tidak ditemukan");
  res.download(path.join(backupDir(), name), name);
}));
adminRoutes.delete("/admin/data/backups/:name", ah(async (req, res) => {
  const name = String(req.params.name);
  if (!safeName(name)) throw fail(400, "Nama berkas tidak valid");
  fs.rmSync(path.join(backupDir(), name), { force: true });
  await aud(req, `Backup dihapus: ${name}`);
  res.json({ ok: true });
}));

const up = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { fs.mkdirSync(backupDir(), { recursive: true }); cb(null, backupDir()); },
    filename: (_r, f, cb) => cb(null, `crm-upload-${Date.now()}-${f.originalname.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.json\.gz$/i, "")}.json.gz`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
});
adminRoutes.post("/admin/data/backups/upload", up.single("file"), ah(async (req, res) => {
  if (!req.file) throw fail(400, "Pilih berkas backup (.json.gz)");
  const m = await readMeta(req.file.filename);
  if (!m?.valid) { fs.rmSync(req.file.path, { force: true }); throw fail(400, m?.error ?? "Berkas bukan backup CRM yang valid"); }
  await aud(req, `Backup diunggah: ${req.file.filename}`);
  res.status(201).json(m);
}));

adminRoutes.post("/admin/data/backups/:name/restore", ah(async (req, res) => {
  const name = String(req.params.name);
  const b = z.object({ includeSettings: z.boolean().default(false), confirm: z.string() }).parse(req.body);
  if (b.confirm !== "RESTORE") throw fail(400, "Ketik RESTORE untuk konfirmasi");
  if (!safeName(name)) throw fail(400, "Nama berkas tidak valid");
  try {
    const r = await restoreBackup(name, { includeSettings: b.includeSettings, keepAdminId: req.user!.id, by: req.user!.name });
    await aud(req, `Restore dari ${name}: ${r.rows} baris, ${r.tables} tabel`);
    res.json(r);
  } catch (e) { throw fail(400, `Restore gagal (data tidak diubah): ${(e as Error).message}`); }
}));

adminRoutes.post("/admin/data/purge", ah(async (req, res) => {
  const b = z.object({
    scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1), onlyDemo: z.boolean().default(false),
    deleteUsers: z.boolean().default(false), deleteFiles: z.boolean().default(false), backupFirst: z.boolean().default(true), confirm: z.string(),
  }).parse(req.body);
  if (b.confirm !== "HAPUS DATA") throw fail(400, "Ketik HAPUS DATA untuk konfirmasi");
  let pre: string | null = null;
  if (b.backupFirst) pre = (await createBackup({ kind: "pre-purge", note: b.onlyDemo ? "sebelum hapus data demo" : `sebelum purge cakupan ${b.scope}`, by: req.user!.name })).name;
  try {
    const testSent = Number((await pool.query("SELECT count(*) n FROM quotations WHERE wo_test_at IS NOT NULL")).rows[0].n);
    const r = await purgeData({ scope: b.scope, onlyDemo: b.onlyDemo, deleteUsers: b.deleteUsers, deleteFiles: b.deleteFiles, keepAdminId: req.user!.id });
    if (!b.onlyDemo) await pool.query("DELETE FROM crm_settings WHERE key='demo'");
    else if (!Number((await overview(pool)).demo.leads) && !Number((await overview(pool)).demo.reports)) await pool.query("DELETE FROM crm_settings WHERE key='demo'");
    await aud(req, b.onlyDemo ? `Data demo dihapus${pre ? ` (backup: ${pre})` : ""}` : `Purge data cakupan ${b.scope}${b.deleteUsers ? " + cache akun non-admin" : ""}${pre ? ` (backup: ${pre})` : ""}`);
    res.json({ ...r, backup: pre, testSent }); // testSent: penawaran demo yang pernah dikirim uji sambung — sisi WO perlu dibersihkan lewat purge uji sambung WO
  } catch (e) { throw fail(400, `Purge gagal (data tidak diubah): ${(e as Error).message}`); }
}));

/* ── Uji sambung CRM→WO: penawaran demo yang dikirim dengan demo:true (hanya lewat aksi eksplisit ini) ── */
adminRoutes.get("/admin/data/demo-quotations", ah(async (_req, res) => {
  const r = await pool.query(
    `SELECT id, number, rev, status, customer_name AS "customerName", subject, wo_test_at AS "testAt", wo_test_rev AS "testRev", wo_test_status AS "testStatus", wo_test_number AS "testNumber", wo_test_error AS "testError",
            (SELECT COALESCE(sum(qty*unit_price),0) FROM quotation_lines l WHERE l.quotation_id=quotations.id) AS subtotal
       FROM quotations WHERE is_demo AND deleted_at IS NULL ORDER BY id`);
  res.json({ items: r.rows.map((x) => ({ ...x, subtotal: Number(x.subtotal), sendable: ["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"].includes(x.status) })) });
}));
adminRoutes.post("/admin/data/demo-quotations/send-test", ah(async (req, res) => {
  const b = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(20), confirm: z.string() }).parse(req.body);
  if (b.confirm !== "KIRIM UJI") throw fail(400, "Ketik KIRIM UJI untuk konfirmasi");
  const results: { id: number; ok: boolean; message: string }[] = [];
  for (const id of b.ids) {
    try { results.push({ id, ...(await sendTestQuotation(id)) }); }
    catch (e) { results.push({ id, ok: false, message: (e as Error).message }); }
  }
  await aud(req, `Uji sambung ke WO: ${results.filter((r) => r.ok).length}/${results.length} penawaran demo dikirim (demo:true)`);
  res.json({ results });
}));

/* ── Rekonsiliasi CRM ↔ WO (baca-saja) ── */
adminRoutes.get("/admin/data/reconcile", ah(async (_req, res) => { res.json(await reconcile()); }));

/** Muat data demo: memakai akun demo WO (mkt@ …) + Admin; baris ditandai is_demo; tidak pernah dikirim ke WO. */
adminRoutes.post("/admin/data/demo", ah(async (req, res) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
  if (confirm !== "MUAT DEMO") throw fail(400, "Ketik MUAT DEMO untuk konfirmasi");
  const pre = await createBackup({ kind: "pre-restore", note: "sebelum memuat data demo", by: req.user!.name });
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
  const r = await loadDemo({ id: req.user!.id, name: req.user!.name, role: req.user!.role, subRole: req.user!.subRole, email: req.user!.email }, token, req.user!.name);
  await aud(req, "Data demo dimuat");
  res.json({ ok: true, backup: pre.name, ...r });
}));

