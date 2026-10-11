import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import { audit, pool } from "./db.js";
import { authenticate, isReviewer, requireCrm, WO_URL, type Principal } from "./auth.js";
import { locationStatus, validCoords } from "./gps.js";
import { storage } from "./storage.js";
import { MAX_BYTES, compress, saveFile, sign, validateImage, verifySig } from "./files.js";

const ACTIVITY_TYPES = ["CANVASSING", "MEETING", "FOLLOW_UP", "SURVEY", "PARTNERSHIP", "COMMUNITY_ENGAGEMENT", "LAINNYA"] as const;
const SOURCES = ["LIVE", "EXIF", "UPLOAD", "MANUAL"] as const;

const gpsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable().optional(),
  at: z.coerce.date(),
  source: z.enum(SOURCES),
});
const itemsSchema = z.object({
  discussion: z.array(z.string().trim().min(1)).default([]),
  agreement: z.array(z.string().trim().min(1)).default([]),
  issues: z.array(z.string().trim().min(1)).default([]),
});
const reportSchema = z.object({
  activityType: z.enum(ACTIVITY_TYPES),
  activityAt: z.coerce.date().optional(),
  counterpart: z.string().trim().optional(),
  accountName: z.string().trim().optional(),
  area: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  summary: z.string().trim().optional(),
  nextAction: z.string().trim().optional(),
  picIds: z.array(z.string()).optional(),
  items: itemsSchema.optional(),
});
const taskSchema = z.object({
  title: z.string().trim().min(1),
  picUserId: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);
const fail = (status: number, error: string) => Object.assign(new Error(error), { status });
const idParam = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw fail(400, "ID tidak valid");
  return n;
};

async function picsFor(ids: string[]) {
  const r = await pool.query("SELECT user_id, name FROM wo_user_cache WHERE user_id = ANY($1) AND role IN ('MKT','ADMIN')", [ids]);
  if (r.rowCount !== new Set(ids).size) throw fail(400, "PIC tidak dikenal (harus user MKT yang pernah login)");
  return r.rows as { user_id: string; name: string }[];
}

/** Ambil report yang boleh diakses; STAFF hanya miliknya (pembuat/PIC). */
async function loadReport(id: number, u: Principal) {
  const r = await pool.query("SELECT * FROM field_reports WHERE id=$1 AND deleted_at IS NULL", [id]);
  const row = r.rows[0];
  if (!row) throw fail(404, "Report tidak ditemukan");
  if (!isReviewer(u)) {
    const p = await pool.query("SELECT 1 FROM field_report_pics WHERE report_id=$1 AND user_id=$2", [id, u.id]);
    if (row.created_by !== u.id && !p.rowCount) throw fail(403, "Bukan report Anda");
  }
  return row;
}
const editable = (row: { status: string }) => {
  if (row.status !== "DRAFT" && row.status !== "REVISION_REQUIRED") throw fail(409, "Report sudah disubmit, tidak dapat diubah");
};

async function writeItems(c: { query: typeof pool.query }, reportId: number, items: z.infer<typeof itemsSchema>) {
  await c.query("DELETE FROM field_report_items WHERE report_id=$1", [reportId]);
  const rows: [string, string][] = [
    ...items.discussion.map((t) => ["DISCUSSION", t] as [string, string]),
    ...items.agreement.map((t) => ["AGREEMENT", t] as [string, string]),
    ...items.issues.map((t) => ["ISSUE", t] as [string, string]),
  ];
  for (const [i, [kind, text]] of rows.entries())
    await c.query("INSERT INTO field_report_items (report_id,kind,text,position) VALUES ($1,$2,$3,$4)", [reportId, kind, text, i]);
}

async function writePics(c: { query: typeof pool.query }, reportId: number, ids: string[]) {
  const pics = await picsFor(ids);
  await c.query("DELETE FROM field_report_pics WHERE report_id=$1", [reportId]);
  for (const p of pics) await c.query("INSERT INTO field_report_pics (report_id,user_id,name) VALUES ($1,$2,$3)", [reportId, p.user_id, p.name]);
}

async function detail(row: any) {
  const [pics, items, photos, tasks] = await Promise.all([
    pool.query("SELECT user_id AS \"userId\", name FROM field_report_pics WHERE report_id=$1 ORDER BY name", [row.id]),
    pool.query("SELECT kind, text FROM field_report_items WHERE report_id=$1 ORDER BY position", [row.id]),
    pool.query("SELECT * FROM field_photos WHERE report_id=$1 AND deleted_at IS NULL ORDER BY taken_at", [row.id]),
    pool.query("SELECT id, title, pic_user_id AS \"picUserId\", pic_name AS \"picName\", to_char(due_date,'YYYY-MM-DD') AS \"dueDate\", status FROM field_tasks WHERE report_id=$1 AND deleted_at IS NULL ORDER BY due_date", [row.id]),
  ]);
  const grouped = (k: string) => items.rows.filter((i) => i.kind === k).map((i) => i.text);
  return {
    id: row.id, status: row.status, activityType: row.activity_type, activityAt: row.activity_at,
    counterpart: row.counterpart, accountName: row.account_name, area: row.area, branchId: row.branch_id,
    summary: row.summary, nextAction: row.next_action, createdBy: row.created_by, submittedAt: row.submitted_at,
    checkin: row.gps_source
      ? { lat: row.gps_lat, lng: row.gps_lng, accuracy: row.gps_accuracy, at: row.gps_at, source: row.gps_source, locationStatus: row.location_status }
      : null,
    pics: pics.rows,
    items: { discussion: grouped("DISCUSSION"), agreement: grouped("AGREEMENT"), issues: grouped("ISSUE") },
    photos: photos.rows.map((p) => ({
      id: p.id, caption: p.caption, takenAt: p.taken_at, source: p.gps_source, locationStatus: p.location_status,
      lat: p.gps_lat, lng: p.gps_lng, accuracy: p.gps_accuracy, gpsAt: p.gps_at,
      originalUrl: sign(p.id, "original"), watermarkUrl: p.watermark_path ? sign(p.id, "watermark") : null,
    })),
    tasks: tasks.rows,
  };
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 2 } });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Login terpusat: diteruskan ke Maung WO (tidak ada tabel user sendiri).
  app.post("/api/auth/login", ah(async (req, res) => {
    // Kontrak login WO: { email, password } (email boleh berupa username). Terima juga { username } dari klien.
    const b = (req.body ?? {}) as { email?: string; username?: string; password?: string };
    const r = await fetch(`${WO_URL()}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: b.email ?? b.username ?? "", password: b.password ?? "" }),
    });
    res.status(r.status).json(await r.json().catch(() => ({})));
  }));

  // Berkas foto memakai signed URL (img tag tidak bisa kirim header Authorization).
  app.get("/api/photos/:id/file", ah(async (req, res) => {
    const id = idParam(req);
    const variant = req.query.variant === "watermark" ? "watermark" : "original";
    if (!verifySig(id, variant, Number(req.query.exp), String(req.query.sig ?? ""))) throw fail(403, "Tautan tidak valid atau kedaluwarsa");
    const r = await pool.query("SELECT original_path, watermark_path, mime, caption FROM field_photos WHERE id=$1 AND deleted_at IS NULL", [id]);
    const p = r.rows[0];
    if (!p) throw fail(404, "Foto tidak ditemukan");
    const rel = variant === "watermark" ? p.watermark_path : p.original_path;
    if (!rel) throw fail(404, "Versi tidak tersedia");
    res.type(variant === "watermark" ? "image/jpeg" : p.mime);
    if (req.query.download) res.attachment(`foto-${id}-${variant}`);
    res.send(await storage().get(rel));
  }));

  app.use("/api", authenticate, requireCrm);

  app.get("/api/me", (req, res) => res.json({ ...req.user, reviewer: isReviewer(req.user!) }));

  app.get("/api/pics", ah(async (_req, res) => {
    const r = await pool.query("SELECT user_id AS id, name FROM wo_user_cache WHERE role IN ('MKT','ADMIN') ORDER BY name");
    res.json(r.rows);
  }));

  app.post("/api/reports", ah(async (req, res) => {
    const u = req.user!;
    const b = reportSchema.parse(req.body);
    const picIds = b.picIds?.length ? b.picIds : [u.id];
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(
        `INSERT INTO field_reports (activity_type,activity_at,counterpart,account_name,area,branch_id,summary,next_action,created_by)
         VALUES ($1,COALESCE($2,now()),$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [b.activityType, b.activityAt ?? null, b.counterpart ?? null, b.accountName ?? null, b.area ?? null, b.branchId ?? null, b.summary ?? null, b.nextAction ?? null, u.id],
      );
      const id = r.rows[0].id as number;
      await writePics(c, id, picIds);
      if (b.items) await writeItems(c, id, b.items);
      await audit(u.id, "field_report", id, "CREATE", null, b, c);
      await c.query("COMMIT");
      res.status(201).json(await detail(await loadReport(id, u)));
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }));

  app.get("/api/reports", ah(async (req, res) => {
    const u = req.user!;
    const where = ["r.deleted_at IS NULL"];
    const args: unknown[] = [];
    if (!isReviewer(u)) {
      args.push(u.id);
      where.push(`(r.created_by=$${args.length} OR EXISTS (SELECT 1 FROM field_report_pics p WHERE p.report_id=r.id AND p.user_id=$${args.length}))`);
    }
    if (typeof req.query.status === "string") { args.push(req.query.status); where.push(`r.status=$${args.length}`); }
    const r = await pool.query(
      `SELECT r.id, r.status, r.activity_type AS "activityType", r.activity_at AS "activityAt", r.area, r.account_name AS "accountName",
              r.location_status AS "locationStatus", r.gps_source AS "gpsSource",
              (SELECT string_agg(name, ', ' ORDER BY name) FROM field_report_pics p WHERE p.report_id=r.id) AS pics,
              (SELECT count(*)::int FROM field_photos f WHERE f.report_id=r.id AND f.deleted_at IS NULL) AS "photoCount"
       FROM field_reports r WHERE ${where.join(" AND ")} ORDER BY r.activity_at DESC LIMIT 200`, args);
    res.json(r.rows);
  }));

  app.get("/api/reports/:id", ah(async (req, res) => {
    res.json(await detail(await loadReport(idParam(req), req.user!)));
  }));

  app.put("/api/reports/:id", ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    const row = await loadReport(id, u);
    editable(row);
    const b = reportSchema.parse(req.body);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `UPDATE field_reports SET activity_type=$2, activity_at=COALESCE($3,activity_at), counterpart=$4, account_name=$5, area=$6,
           branch_id=$7, summary=$8, next_action=$9, updated_at=now() WHERE id=$1`,
        [id, b.activityType, b.activityAt ?? null, b.counterpart ?? null, b.accountName ?? null, b.area ?? null, b.branchId ?? null, b.summary ?? null, b.nextAction ?? null],
      );
      if (b.picIds?.length) await writePics(c, id, b.picIds);
      if (b.items) await writeItems(c, id, b.items);
      await audit(u.id, "field_report", id, "UPDATE", null, b, c);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    res.json(await detail(await loadReport(id, u)));
  }));

  app.delete("/api/reports/:id", ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    const row = await loadReport(id, u);
    if (row.created_by !== u.id && !isReviewer(u)) throw fail(403, "Hanya pembuat/reviewer yang boleh menghapus");
    editable(row);
    await pool.query("UPDATE field_reports SET deleted_at=now() WHERE id=$1", [id]);
    await audit(u.id, "field_report", id, "DELETE");
    res.status(204).end();
  }));

  // GPS check-in: koordinat dari klien (Geolocation saat check-in). Perubahan lokasi selalu masuk audit log.
  app.post("/api/reports/:id/checkin", ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    const row = await loadReport(id, u);
    editable(row);
    const g = gpsSchema.parse(req.body);
    const status = locationStatus(g, new Date());
    const before = row.gps_source ? { lat: row.gps_lat, lng: row.gps_lng, accuracy: row.gps_accuracy, source: row.gps_source } : null;
    await pool.query(
      `UPDATE field_reports SET gps_lat=$2,gps_lng=$3,gps_accuracy=$4,gps_at=$5,gps_source=$6,location_status=$7,updated_at=now() WHERE id=$1`,
      [id, g.lat, g.lng, g.accuracy ?? null, g.at, g.source, status],
    );
    await audit(u.id, "field_report", id, "CHECKIN", before, { ...g, locationStatus: status });
    res.json({ locationStatus: status });
  }));

  app.post("/api/reports/:id/photos", upload.fields([{ name: "original", maxCount: 1 }, { name: "watermark", maxCount: 1 }]), ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    editable(await loadReport(id, u));
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const orig = files?.original?.[0];
    if (!orig) throw fail(400, "Berkas 'original' wajib");
    const meta = z.object({
      caption: z.string().trim().optional(),
      takenAt: z.coerce.date().default(() => new Date()),
      lat: z.coerce.number().optional(), lng: z.coerce.number().optional(),
      accuracy: z.coerce.number().nonnegative().optional(),
      gpsAt: z.coerce.date().optional(),
      source: z.enum(SOURCES).optional(),
    }).parse(req.body);

    const hasGps = validCoords(meta.lat, meta.lng);
    if ((meta.lat != null || meta.lng != null) && !hasGps) throw fail(400, "Koordinat tidak valid");
    if (hasGps && !meta.source) throw fail(400, "Sumber GPS (source) wajib bila koordinat diisi");
    if (!hasGps && meta.source === "LIVE") throw fail(400, "source LIVE tanpa koordinat ditolak; kirim tanpa source bila GPS tidak tersedia");

    const o = await validateImage(orig.buffer);
    const wm = files?.watermark?.[0];
    if (wm) await validateImage(wm.buffer);
    const origRel = await saveFile(orig.buffer, o.ext, o.mime);
    const wmRel = wm ? await saveFile(await compress(wm.buffer), "jpg", "image/jpeg") : null;
    const status = hasGps
      ? locationStatus({ lat: meta.lat, lng: meta.lng, accuracy: meta.accuracy, at: meta.gpsAt, source: meta.source }, meta.takenAt)
      : "UNVERIFIED";
    const r = await pool.query(
      `INSERT INTO field_photos (report_id,caption,original_path,watermark_path,mime,size_bytes,taken_at,gps_lat,gps_lng,gps_accuracy,gps_at,gps_source,location_status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [id, meta.caption ?? null, origRel, wmRel, o.mime, orig.size, meta.takenAt, hasGps ? meta.lat : null, hasGps ? meta.lng : null,
        hasGps ? meta.accuracy ?? null : null, hasGps ? meta.gpsAt ?? null : null, hasGps ? meta.source : null, status, u.id],
    );
    await audit(u.id, "field_photo", r.rows[0].id, "CREATE", null, { reportId: id, source: meta.source ?? null, locationStatus: status });
    res.status(201).json({ id: r.rows[0].id, locationStatus: status });
  }));

  app.delete("/api/reports/:id/photos/:photoId", ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    editable(await loadReport(id, u));
    const r = await pool.query("UPDATE field_photos SET deleted_at=now() WHERE id=$1 AND report_id=$2 AND deleted_at IS NULL RETURNING id", [Number(req.params.photoId), id]);
    if (!r.rowCount) throw fail(404, "Foto tidak ditemukan");
    await audit(u.id, "field_photo", r.rows[0].id, "DELETE");
    res.status(204).end();
  }));

  app.post("/api/reports/:id/submit", ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    const row = await loadReport(id, u);
    editable(row);
    if (!row.summary?.trim()) throw fail(400, "Summary wajib diisi sebelum submit");
    await pool.query("UPDATE field_reports SET status='SUBMITTED', submitted_at=now(), updated_at=now() WHERE id=$1", [id]);
    await audit(u.id, "field_report", id, "SUBMIT", { status: row.status }, { status: "SUBMITTED" });
    res.json(await detail(await loadReport(id, u)));
  }));

  // Follow-up task: wajib PIC & due date.
  app.post("/api/reports/:id/tasks", ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    await loadReport(id, u);
    const t = taskSchema.parse(req.body);
    const [pic] = await picsFor([t.picUserId]);
    const r = await pool.query(
      "INSERT INTO field_tasks (report_id,title,pic_user_id,pic_name,due_date,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [id, t.title, pic.user_id, pic.name, t.dueDate, u.id],
    );
    await audit(u.id, "field_task", r.rows[0].id, "CREATE", null, t);
    res.status(201).json({ id: r.rows[0].id });
  }));

  app.patch("/api/tasks/:id", ah(async (req, res) => {
    const u = req.user!, id = idParam(req);
    const { status } = z.object({ status: z.enum(["OPEN", "DONE"]) }).parse(req.body);
    const t = await pool.query("SELECT report_id, pic_user_id, status FROM field_tasks WHERE id=$1 AND deleted_at IS NULL", [id]);
    if (!t.rowCount) throw fail(404, "Task tidak ditemukan");
    if (t.rows[0].pic_user_id !== u.id && !isReviewer(u)) await loadReport(t.rows[0].report_id, u);
    await pool.query("UPDATE field_tasks SET status=$2, updated_at=now() WHERE id=$1", [id, status]);
    await audit(u.id, "field_task", id, "STATUS", { status: t.rows[0].status }, { status });
    res.json({ id, status });
  }));

  app.get("/api/tasks", ah(async (req, res) => {
    const u = req.user!;
    const mine = !isReviewer(u) || req.query.mine === "1";
    const r = await pool.query(
      `SELECT t.id, t.report_id AS "reportId", t.title, t.pic_user_id AS "picUserId", t.pic_name AS "picName",
              to_char(t.due_date,'YYYY-MM-DD') AS "dueDate", t.status, (t.status='OPEN' AND t.due_date < current_date) AS overdue
       FROM field_tasks t WHERE t.deleted_at IS NULL ${mine ? "AND t.pic_user_id=$1" : "AND $1::text IS NOT NULL"} ORDER BY t.due_date`, [u.id]);
    res.json(r.rows);
  }));

  // Map View: hanya koordinat valid; titik report (check-in) dan foto.
  app.get("/api/map", ah(async (req, res) => {
    const u = req.user!;
    const scope = isReviewer(u) ? "" : "AND (r.created_by=$1 OR EXISTS (SELECT 1 FROM field_report_pics p WHERE p.report_id=r.id AND p.user_id=$1))";
    const args = isReviewer(u) ? [] : [u.id];
    const reports = await pool.query(
      `SELECT r.id, r.activity_type AS "activityType", r.activity_at AS "activityAt", r.area, r.status, r.gps_lat AS lat, r.gps_lng AS lng,
              r.gps_accuracy AS accuracy, r.location_status AS "locationStatus", r.gps_source AS source,
              (SELECT string_agg(name, ', ' ORDER BY name) FROM field_report_pics p WHERE p.report_id=r.id) AS pics
       FROM field_reports r WHERE r.deleted_at IS NULL AND r.gps_lat IS NOT NULL ${scope}`, args);
    const photos = await pool.query(
      `SELECT f.id, f.report_id AS "reportId", f.caption, f.taken_at AS "takenAt", f.gps_lat AS lat, f.gps_lng AS lng,
              f.gps_accuracy AS accuracy, f.gps_source AS source, f.location_status AS "locationStatus"
       FROM field_photos f JOIN field_reports r ON r.id=f.report_id
       WHERE f.deleted_at IS NULL AND r.deleted_at IS NULL AND f.gps_lat IS NOT NULL ${scope}`, args);
    res.json({
      reports: reports.rows,
      photos: photos.rows.map((p) => ({ ...p, thumbUrl: sign(p.id, "watermark") })),
    });
  }));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: "Data tidak valid", detail: err.issues });
    if (err instanceof multer.MulterError) return void res.status(400).json({ error: err.message });
    const status: number = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Kesalahan server" : err.message });
  });
  return app;
}
