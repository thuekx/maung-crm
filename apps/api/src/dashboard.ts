import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { isReviewer } from "./auth.js";

const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

export const dashboardRoutes = Router();

/**
 * KPI Field Activities + pipeline Lead/Penawaran. Rentang tanggal [from, to] (bawaan 30 hari terakhir).
 * Staf hanya melihat datanya sendiri; reviewer melihat semua dan dapat menyaring per marketing (`marketing` = user id WO) dan area.
 * "Visit" = report yang sudah disubmit (bukan Draft), dihitung per PIC.
 */
dashboardRoutes.get("/", ah(async (req, res) => {
  const u = req.user!, reviewer = isReviewer(u);
  const q = z.object({ from: iso.optional(), to: iso.optional(), marketing: z.string().optional(), area: z.string().trim().max(80).optional() }).parse(req.query);
  const to = q.to ?? today(), from = q.from ?? addDays(to, -29);
  if (from > to) return void res.status(400).json({ error: "Tanggal mulai setelah tanggal akhir" });
  const who = reviewer ? (q.marketing || null) : u.id; // null = semua
  const area = q.area ? `%${q.area.toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c)}%` : null;
  const end = addDays(to, 1); // batas atas eksklusif

  // ── Field Activities ──
  const vis = await pool.query(
    `SELECT p.user_id AS "userId", p.name, count(*)::int AS visits,
            count(*) FILTER (WHERE r.location_status='VERIFIED')::int AS verified
     FROM field_reports r JOIN field_report_pics p ON p.report_id=r.id
     WHERE r.deleted_at IS NULL AND r.status <> 'DRAFT' AND r.activity_at >= $1 AND r.activity_at < $2
       AND ($3::text IS NULL OR p.user_id=$3) AND ($4::text IS NULL OR lower(COALESCE(r.area,'')) LIKE $4)
     GROUP BY p.user_id, p.name ORDER BY visits DESC, p.name`, [from, end, who, area]);
  const rep = (await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE r.location_status='VERIFIED')::int AS verified,
            count(*) FILTER (WHERE r.status='SUBMITTED')::int AS "awaitingReview",
            count(*) FILTER (WHERE r.status='REVISION_REQUIRED')::int AS "needsRevision"
     FROM field_reports r
     WHERE r.deleted_at IS NULL AND r.status <> 'DRAFT' AND r.activity_at >= $1 AND r.activity_at < $2
       AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM field_report_pics p WHERE p.report_id=r.id AND p.user_id=$3))
       AND ($4::text IS NULL OR lower(COALESCE(r.area,'')) LIKE $4)`, [from, end, who, area])).rows[0];
  const byType = (await pool.query(
    `SELECT r.activity_type AS type, count(*)::int AS n FROM field_reports r
     WHERE r.deleted_at IS NULL AND r.status <> 'DRAFT' AND r.activity_at >= $1 AND r.activity_at < $2
       AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM field_report_pics p WHERE p.report_id=r.id AND p.user_id=$3))
       AND ($4::text IS NULL OR lower(COALESCE(r.area,'')) LIKE $4)
     GROUP BY r.activity_type ORDER BY n DESC`, [from, end, who, area])).rows;
  // Follow-up: kondisi saat ini (bukan per rentang) untuk PIC terpilih
  const tasks = (await pool.query(
    `SELECT count(*) FILTER (WHERE status='OPEN')::int AS open,
            count(*) FILTER (WHERE status='OPEN' AND due_date < current_date)::int AS overdue,
            count(*) FILTER (WHERE status='DONE' AND updated_at >= $2 AND updated_at < $3)::int AS "doneInRange"
     FROM field_tasks WHERE deleted_at IS NULL AND ($1::text IS NULL OR pic_user_id=$1)`, [who, from, end])).rows[0];

  // ── Lead ──
  const leadScope = "l.deleted_at IS NULL AND ($1::text IS NULL OR l.owner_id=$1) AND ($2::text IS NULL OR lower(COALESCE(l.area,'')) LIKE $2)";
  const created = (await pool.query(
    `SELECT l.kind, l.stage, count(*)::int AS n FROM leads l WHERE ${leadScope} AND l.created_at >= $3 AND l.created_at < $4 GROUP BY l.kind, l.stage`, [who, area, from, end])).rows;
  const wl = (await pool.query(
    `SELECT count(*) FILTER (WHERE l.stage='WON' AND l.won_at >= $3 AND l.won_at < $4)::int AS won,
            count(*) FILTER (WHERE l.stage='LOST' AND l.closed_at >= $3 AND l.closed_at < $4)::int AS lost,
            count(*) FILTER (WHERE l.stage NOT IN ('WON','LOST'))::int AS open
     FROM leads l WHERE ${leadScope}`, [who, area, from, end])).rows[0];
  const nCreated = created.reduce((s, x) => s + x.n, 0);
  const stages: Record<string, number> = {};
  for (const x of created) stages[x.stage] = (stages[x.stage] ?? 0) + x.n;
  const cohortWon = stages.WON ?? 0;

  // ── Penawaran ──
  const qScope = "q.deleted_at IS NULL AND ($1::text IS NULL OR q.owner_id=$1) AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM leads l WHERE l.id=q.lead_id AND lower(COALESCE(l.area,'')) LIKE $2))";
  const qs = (await pool.query(`SELECT q.status, count(*)::int AS n FROM quotations q WHERE ${qScope} AND q.created_at >= $3 AND q.created_at < $4 GROUP BY q.status`, [who, area, from, end])).rows;
  const qv = (await pool.query(
    `SELECT COALESCE(sum(q.total) FILTER (WHERE q.status IN ('APPROVED','SENT')),0) AS pipeline,
            COALESCE(sum(q.total) FILTER (WHERE q.status='ACCEPTED' AND q.decided_at >= $3 AND q.decided_at < $4),0) AS accepted,
            count(*) FILTER (WHERE q.status='ACCEPTED' AND q.decided_at >= $3 AND q.decided_at < $4)::int AS "acceptedCount",
            count(*) FILTER (WHERE q.status='PENDING_APPROVAL')::int AS "awaitingApproval"
     FROM quotations q WHERE ${qScope}`, [who, area, from, end])).rows[0];

  // Daftar marketing untuk filter (reviewer)
  const people = reviewer ? (await pool.query("SELECT user_id AS id, name FROM wo_user_cache WHERE role IN ('MKT','ADMIN') ORDER BY name")).rows : [];

  const demoRows = Number((await pool.query("SELECT (SELECT count(*) FROM leads WHERE is_demo AND deleted_at IS NULL) + (SELECT count(*) FROM quotations WHERE is_demo AND deleted_at IS NULL) + (SELECT count(*) FROM field_reports WHERE is_demo AND deleted_at IS NULL) AS n")).rows[0].n);
  res.json({
    hasDemo: demoRows > 0, range: { from, to }, scope: who ? "marketing" : "semua", filters: { marketing: who, area: q.area ?? null }, people,
    field: { visits: rep.total, verified: rep.verified, unverified: rep.total - rep.verified, awaitingReview: rep.awaitingReview, needsRevision: rep.needsRevision, perMarketing: vis.rows, byType, tasks },
    leads: { created: nCreated, byStage: stages, byKind: { INTERNET: created.filter((x) => x.kind === "INTERNET").reduce((s, x) => s + x.n, 0), NON_INTERNET: created.filter((x) => x.kind === "NON_INTERNET").reduce((s, x) => s + x.n, 0) },
      won: wl.won, lost: wl.lost, open: wl.open, winRate: wl.won + wl.lost ? Math.round((wl.won / (wl.won + wl.lost)) * 1000) / 10 : null, cohortConversion: nCreated ? Math.round((cohortWon / nCreated) * 1000) / 10 : null },
    quotations: { byStatus: Object.fromEntries(qs.map((x) => [x.status, x.n])), pipelineValue: Number(qv.pipeline), acceptedValue: Number(qv.accepted), acceptedCount: qv.acceptedCount, awaitingApproval: qv.awaitingApproval },
  });
}));
