import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, pool } from "./db.js";
import { isReviewer, type Principal } from "./auth.js";
import { normalizePhone } from "./phone.js";
import { lookupByPhone } from "./woSync.js";

export const KINDS = ["INTERNET", "NON_INTERNET"] as const;
export type Kind = (typeof KINDS)[number];
export const STAGES: Record<Kind, string[]> = {
  INTERNET: ["NEW", "CONTACTED", "QUALIFIED", "REGISTERED", "INSTALLING", "WON", "LOST"],
  NON_INTERNET: ["NEW", "CONTACTED", "QUALIFIED", "QUOTING", "NEGOTIATION", "WON", "LOST"],
};
/** Tahap yang boleh diatur manual. REGISTERED/INSTALLING/WON (internet) hanya mengikuti WO. */
const MANUAL: Record<Kind, string[]> = {
  INTERNET: ["NEW", "CONTACTED", "QUALIFIED", "LOST"],
  NON_INTERNET: ["NEW", "CONTACTED", "QUALIFIED", "QUOTING", "NEGOTIATION", "WON", "LOST"],
};
const OPEN = ["NEW", "CONTACTED", "QUALIFIED", "REGISTERED", "INSTALLING", "QUOTING", "NEGOTIATION"];

const fail = (status: number, error: string) => Object.assign(new Error(error), { status });
const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const idParam = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw fail(400, "ID tidak valid"); return n; };

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const createSchema = z.object({
  kind: z.enum(KINDS),
  name: z.string().trim().min(1, "Nama wajib").max(120),
  phone: z.string().trim().min(5, "Nomor telepon wajib").max(30),
  email: opt(120), address: opt(300), area: opt(80), interest: opt(200), source: opt(80), notes: opt(2000),
  ownerId: z.string().optional(),
});
const patchSchema = createSchema.omit({ kind: true }).partial();

/** Pemilik/pembuat melihat miliknya; reviewer (ADMIN / MKT MANAGER|SUPERVISOR) melihat semua. */
const scope = (u: Principal, args: unknown[]) => {
  if (isReviewer(u)) return "TRUE";
  args.push(u.id);
  return `(l.owner_id=$${args.length} OR l.created_by=$${args.length})`;
};
async function loadLead(id: number, u: Principal) {
  const args: unknown[] = [id];
  const r = await pool.query(`SELECT l.* FROM leads l WHERE l.id=$1 AND l.deleted_at IS NULL AND ${scope(u, args)}`, args);
  if (!r.rows[0]) throw fail(404, "Lead tidak ditemukan");
  return r.rows[0];
}

type Q = { query: typeof pool.query };
async function event(db: Q, leadId: number, type: string, o: { from?: string | null; to?: string | null; note?: string | null; actor?: { id: string; name: string } | null }) {
  await db.query("INSERT INTO lead_events (lead_id,type,from_stage,to_stage,note,actor_id,actor_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [leadId, type, o.from ?? null, o.to ?? null, o.note ?? null, o.actor?.id ?? null, o.actor?.name ?? null]);
}

/** Tahap lead internet menurut status pelanggan WO (cermin). null = tidak ada perubahan tahap. */
export function stageFromCustomer(status: string | null): { stage: string; lost?: string } | null {
  switch (status) {
    case "PROSPECT": return { stage: "REGISTERED" };
    case "INSTALLING": return { stage: "INSTALLING" };
    case "ACTIVE": return { stage: "WON" };
    case "TERMINATED": case "TERMINATING": return { stage: "LOST", lost: `Pelanggan di WO berstatus ${status} sebelum aktif` };
    default: return null; // NEED_CHECK/SUSPENDED/OFFLINE tidak mengubah tahap
  }
}

/**
 * Tautan otomatis (konservatif).
 * INTERNET: tepat SATU kandidat exact, pelanggan dibuat ≥1 hari sebelum Lead (pendaftar baru), status PROSPECT|INSTALLING.
 * NON_INTERNET (layanan tambahan): tepat SATU kandidat exact (pelanggan existing) — tertaut sejak awal.
 * Selain itu tidak menautkan; kandidat ditampilkan untuk dikonfirmasi manual.
 */
export function pickAuto(kind: Kind, leadCreatedAt: Date, exact: { code: string; status: string | null; createdAt: string | null }[]) {
  if (exact.length !== 1) return null;
  const c = exact[0];
  if (kind === "NON_INTERNET") return c.status === "TERMINATED" ? null : c;
  const woCreated = c.createdAt ? new Date(c.createdAt).getTime() : NaN;
  const recent = Number.isFinite(woCreated) && woCreated >= leadCreatedAt.getTime() - 86_400_000;
  return recent && (c.status === "PROSPECT" || c.status === "INSTALLING") ? c : null;
}

async function applyLink(db: Q, leadId: number, code: string, state: "AUTO" | "MANUAL", actor: { id: string; name: string } | null) {
  await db.query("UPDATE leads SET customer_code=$2, link_state=$3, updated_at=now() WHERE id=$1", [leadId, code, state]);
  await event(db, leadId, "LINKED", { note: `${state === "AUTO" ? "Otomatis" : "Manual"}: pelanggan WO ${code}`, actor });
}

/** Terapkan tahap dari pelanggan WO ke lead internet yang tertaut (dipanggil setelah sinkron). Lead yang ditutup manual tidak disentuh. */
async function followCustomer(db: Q, lead: any): Promise<boolean> {
  if (lead.kind !== "INTERNET" || !lead.customer_code || !OPEN.includes(lead.stage)) return false;
  const c = (await db.query("SELECT status, activated_at, wo_created_at FROM wo_customers WHERE code=$1", [lead.customer_code])).rows[0];
  let next = c ? stageFromCustomer(c.status) : null;
  // WO Pasang Baru ditolak/dibatalkan (setelah Lead ada) padahal pelanggan masih Prospect/Instalasi → Lost otomatis.
  if (c && (c.status === "PROSPECT" || c.status === "INSTALLING")) {
    const since = new Date(lead.created_at ?? Date.now()).getTime() - 86_400_000;
    const w = (await db.query("SELECT number, status, wo_updated_at FROM wo_work_orders WHERE customer_code=$1 AND type='NEW_INSTALL' ORDER BY wo_created_at DESC NULLS LAST LIMIT 1", [lead.customer_code])).rows[0];
    if (w && (w.status === "REJECTED" || w.status === "CANCELLED") && new Date(w.wo_updated_at ?? 0).getTime() >= since)
      next = { stage: "LOST", lost: `WO Pasang Baru ${w.number} ${w.status === "REJECTED" ? "ditolak (validasi teknis)" : "dibatalkan"}` };
  }
  if (!next || next.stage === lead.stage) return false;
  // Pelanggan lama yang sudah aktif sebelum Lead ada BUKAN kemenangan Lead ini (tetap terbuka; ubah manual bila perlu).
  if (next.stage === "WON") {
    const since = new Date(lead.created_at ?? Date.now()).getTime() - 86_400_000;
    const t = (v: unknown) => (v ? new Date(v as string).getTime() : NaN);
    if (!(t(c.activated_at) >= since || t(c.wo_created_at) >= since)) return false;
  }
  const closed = next.stage === "WON" || next.stage === "LOST";
  await db.query(
    `UPDATE leads SET stage=$2, updated_at=now(), won_at=CASE WHEN $2='WON' THEN now() ELSE won_at END, closed_at=CASE WHEN $3 THEN now() ELSE closed_at END,
       lost_reason=CASE WHEN $2='LOST' THEN $4 ELSE lost_reason END, lost_auto=($2='LOST') WHERE id=$1`,
    [lead.id, next.stage, closed, next.lost ?? null]);
  await event(db, lead.id, "STAGE", { from: lead.stage, to: next.stage, note: next.lost ?? "Mengikuti status pelanggan di WO", actor: null });
  return true;
}

/** Setelah sinkron cermin: tautkan otomatis lead internet yang belum tertaut, lalu ikuti status pelanggan WO. */
export async function refreshLeadLinks(): Promise<{ linked: number; moved: number }> {
  let linked = 0, moved = 0;
  const open = await pool.query("SELECT * FROM leads WHERE deleted_at IS NULL AND kind='INTERNET' AND stage = ANY($1) ORDER BY id", [OPEN]);
  for (const lead of open.rows) {
    if (!lead.customer_code && lead.link_state === "NONE" && lead.phone) {
      const m = await lookupByPhone(lead.phone);
      const pick = pickAuto("INTERNET", lead.created_at, m.exact);
      if (pick) { await applyLink(pool, lead.id, pick.code, "AUTO", null); lead.customer_code = pick.code; linked++; }
    }
    if (await followCustomer(pool, lead)) moved++;
  }
  return { linked, moved };
}

export const leadRoutes = Router();

leadRoutes.post("/", ah(async (req, res) => {
  const u = req.user!, b = createSchema.parse(req.body);
  if (b.ownerId && b.ownerId !== u.id && !isReviewer(u)) throw fail(403, "Hanya reviewer yang boleh menetapkan pemilik lain");
  let ownerId = u.id, ownerName = u.name;
  if (b.ownerId && b.ownerId !== u.id) {
    const o = await pool.query("SELECT user_id, name FROM wo_user_cache WHERE user_id=$1 AND role IN ('MKT','ADMIN')", [b.ownerId]);
    if (!o.rows[0]) throw fail(400, "Pemilik tidak dikenal (harus user MKT yang pernah login)");
    ownerId = o.rows[0].user_id; ownerName = o.rows[0].name;
  }
  const p = normalizePhone(b.phone);
  const m = await lookupByPhone(b.phone);
  const now = new Date();
  const auto = pickAuto(b.kind, now, m.exact);
  const existing = b.kind === "INTERNET" && m.exact.some((c: any) => c.status === "ACTIVE" || c.status === "SUSPENDED" || c.status === "NEED_CHECK");
  const dupes = (await pool.query("SELECT id, name, stage, owner_name AS \"ownerName\" FROM leads WHERE deleted_at IS NULL AND stage = ANY($1) AND phone_norm IS NOT DISTINCT FROM $2 AND ($2::text IS NOT NULL OR phone_digits=$3) ORDER BY id DESC LIMIT 5", [OPEN, p.e164, p.digits])).rows;
  const c = await pool.connect();
  let id: number;
  try {
    await c.query("BEGIN");
    const r = await c.query(
      `INSERT INTO leads (kind,name,phone,phone_norm,phone_digits,email,address,area,interest,source,notes,owner_id,owner_name,existing_customer,created_by,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [b.kind, b.name, b.phone, p.e164, p.digits || null, b.email ?? null, b.address ?? null, b.area ?? null, b.interest ?? null, b.source ?? null, b.notes ?? null, ownerId, ownerName, existing, u.id, now]);
    id = r.rows[0].id;
    await event(c, id, "CREATED", { to: "NEW", actor: u });
    if (auto) {
      await applyLink(c, id, auto.code, "AUTO", u);
      if (b.kind === "INTERNET") await followCustomer(c, { id, kind: b.kind, customer_code: auto.code, stage: "NEW", created_at: now });
    }
    await audit(u.id, "lead", id, "CREATE", null, { kind: b.kind, name: b.name }, c);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  res.status(201).json({ ...(await detail(await loadLead(id, u))), duplicates: dupes, candidates: auto ? [] : { exact: m.exact, weak: m.weak } });
}));

async function detail(l: any) {
  const [events, cust] = await Promise.all([
    pool.query(`SELECT id, type, from_stage AS "fromStage", to_stage AS "toStage", note, actor_name AS "actorName", at FROM lead_events WHERE lead_id=$1 ORDER BY at, id`, [l.id]),
    l.customer_code
      ? pool.query(`SELECT code, name, phone, package_name AS "packageName", status, radius_status AS "radiusStatus", area_name AS "areaName", sales_name AS "salesName", activated_at AS "activatedAt" FROM wo_customers WHERE code=$1`, [l.customer_code])
      : Promise.resolve({ rows: [] as any[] }),
  ]);
  return {
    id: l.id, kind: l.kind, stage: l.stage, name: l.name, phone: l.phone, phoneNorm: l.phone_norm, email: l.email, address: l.address, area: l.area,
    interest: l.interest, source: l.source, notes: l.notes, ownerId: l.owner_id, ownerName: l.owner_name,
    customerCode: l.customer_code, linkState: l.link_state, existingCustomer: l.existing_customer,
    lostReason: l.lost_reason, lostAuto: l.lost_auto, wonAt: l.won_at, closedAt: l.closed_at, createdAt: l.created_at, updatedAt: l.updated_at,
    customer: cust.rows[0] ?? null, events: events.rows, stages: STAGES[l.kind as Kind], manualStages: MANUAL[l.kind as Kind],
  };
}

leadRoutes.get("/", ah(async (req, res) => {
  const u = req.user!, args: unknown[] = [];
  const where = ["l.deleted_at IS NULL", scope(u, args)];
  const q = z.object({ stage: z.string().optional(), kind: z.enum(KINDS).optional(), q: z.string().optional(), open: z.string().optional(), owner: z.string().optional() }).parse(req.query);
  if (q.stage) { args.push(q.stage); where.push(`l.stage=$${args.length}`); }
  if (q.kind) { args.push(q.kind); where.push(`l.kind=$${args.length}`); }
  if (q.open === "1") { args.push(OPEN); where.push(`l.stage = ANY($${args.length})`); }
  if (q.owner === "me") { args.push(u.id); where.push(`l.owner_id=$${args.length}`); }
  if (q.q?.trim()) {
    const t = q.q.trim(), p = normalizePhone(t);
    args.push(`%${t.toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    const conds = [`lower(l.name) LIKE $${args.length}`, `lower(COALESCE(l.interest,'')) LIKE $${args.length}`];
    if (p.digits.length >= 5) { args.push(p.e164 ?? p.digits); conds.push(p.e164 ? `l.phone_norm=$${args.length}` : `l.phone_digits=$${args.length}`); }
    where.push(`(${conds.join(" OR ")})`);
  }
  const r = await pool.query(
    `SELECT l.id, l.kind, l.stage, l.name, l.phone, l.interest, l.area, l.owner_name AS "ownerName", l.customer_code AS "customerCode", l.link_state AS "linkState",
            l.existing_customer AS "existingCustomer", l.created_at AS "createdAt", l.updated_at AS "updatedAt"
     FROM leads l WHERE ${where.join(" AND ")} ORDER BY l.updated_at DESC LIMIT 300`, args);
  res.json(r.rows);
}));

leadRoutes.get("/:id", ah(async (req, res) => { res.json(await detail(await loadLead(idParam(req), req.user!))); }));

leadRoutes.get("/:id/candidates", ah(async (req, res) => {
  const l = await loadLead(idParam(req), req.user!);
  res.json(l.phone ? await lookupByPhone(l.phone) : { normalized: null, valid: false, exact: [], weak: [] });
}));

leadRoutes.patch("/:id", ah(async (req, res) => {
  const u = req.user!, id = idParam(req), l = await loadLead(id, u), b = patchSchema.parse(req.body);
  if (!OPEN.includes(l.stage) && !isReviewer(u)) throw fail(409, "Lead sudah ditutup");
  if (b.ownerId && b.ownerId !== l.owner_id && !isReviewer(u)) throw fail(403, "Hanya reviewer yang boleh mengganti pemilik");
  const sets: string[] = [], args: unknown[] = [id];
  const put = (col: string, v: unknown) => { args.push(v ?? null); sets.push(`${col}=$${args.length}`); };
  if (b.name !== undefined) put("name", b.name);
  if (b.phone !== undefined) { const p = normalizePhone(b.phone); put("phone", b.phone); put("phone_norm", p.e164); put("phone_digits", p.digits || null); }
  for (const [k, col] of [["email", "email"], ["address", "address"], ["area", "area"], ["interest", "interest"], ["source", "source"], ["notes", "notes"]] as const)
    if (k in b) put(col, (b as any)[k]);
  if (b.ownerId && b.ownerId !== l.owner_id) {
    const o = await pool.query("SELECT user_id, name FROM wo_user_cache WHERE user_id=$1 AND role IN ('MKT','ADMIN')", [b.ownerId]);
    if (!o.rows[0]) throw fail(400, "Pemilik tidak dikenal");
    put("owner_id", o.rows[0].user_id); put("owner_name", o.rows[0].name);
  }
  if (sets.length) {
    await pool.query(`UPDATE leads SET ${sets.join(", ")}, updated_at=now() WHERE id=$1`, args);
    await event(pool, id, "UPDATED", { note: Object.keys(b).join(", "), actor: u });
    await audit(u.id, "lead", id, "UPDATE", null, b);
  }
  res.json(await detail(await loadLead(id, u)));
}));

leadRoutes.post("/:id/stage", ah(async (req, res) => {
  const u = req.user!, id = idParam(req), l = await loadLead(id, u);
  const b = z.object({ stage: z.string(), note: z.string().trim().max(500).optional(), reason: z.string().trim().max(300).optional() }).parse(req.body);
  const kind = l.kind as Kind;
  if (!STAGES[kind].includes(b.stage)) throw fail(400, "Tahap tidak dikenal untuk jenis lead ini");
  if (b.stage === l.stage) throw fail(409, "Lead sudah di tahap itu");
  const reopen = !OPEN.includes(l.stage);
  if (reopen) {
    if (!isReviewer(u)) throw fail(403, "Hanya reviewer yang boleh membuka kembali lead yang sudah ditutup");
    if (b.stage === "WON" || b.stage === "LOST") throw fail(409, "Lead sudah ditutup");
  }
  if (!MANUAL[kind].includes(b.stage)) throw fail(409, kind === "INTERNET" ? "Tahap Terdaftar/Instalasi/Won untuk lead internet mengikuti status pelanggan di WO (tautkan pelanggan)" : "Tahap tidak bisa diatur manual");
  if (b.stage === "LOST" && !b.reason) throw fail(400, "Alasan Lost wajib diisi");
  const closed = b.stage === "WON" || b.stage === "LOST";
  await pool.query(
    `UPDATE leads SET stage=$2, updated_at=now(), won_at=CASE WHEN $2='WON' THEN now() WHEN $4 THEN NULL ELSE won_at END,
       closed_at=CASE WHEN $3 THEN now() WHEN $4 THEN NULL ELSE closed_at END, lost_reason=CASE WHEN $2='LOST' THEN $5 WHEN $4 THEN NULL ELSE lost_reason END, lost_auto=false WHERE id=$1`,
    [id, b.stage, closed, reopen, b.reason ?? null]);
  await event(pool, id, "STAGE", { from: l.stage, to: b.stage, note: b.stage === "LOST" ? b.reason : b.note, actor: u });
  await audit(u.id, "lead", id, "STAGE", { stage: l.stage }, { stage: b.stage });
  res.json(await detail(await loadLead(id, u)));
}));

leadRoutes.post("/:id/link", ah(async (req, res) => {
  const u = req.user!, id = idParam(req), l = await loadLead(id, u);
  const b = z.object({ customerCode: z.string().trim().min(1).nullable() }).parse(req.body);
  if (b.customerCode === null) {
    await pool.query("UPDATE leads SET customer_code=NULL, link_state='MANUAL', updated_at=now() WHERE id=$1", [id]); // MANUAL: jangan ditautkan otomatis lagi
    await event(pool, id, "UNLINKED", { note: `Tautan ${l.customer_code ?? "-"} dilepas`, actor: u });
  } else {
    if (!(await pool.query("SELECT 1 FROM wo_customers WHERE code=$1", [b.customerCode])).rowCount) throw fail(404, "Pelanggan tidak ada di cermin WO");
    await applyLink(pool, id, b.customerCode, "MANUAL", u);
    await followCustomer(pool, { ...l, customer_code: b.customerCode });
  }
  await audit(u.id, "lead", id, "LINK", { customerCode: l.customer_code }, b);
  res.json(await detail(await loadLead(id, u)));
}));

leadRoutes.delete("/:id", ah(async (req, res) => {
  const u = req.user!, id = idParam(req);
  if (!isReviewer(u)) throw fail(403, "Hanya reviewer");
  await loadLead(id, u);
  await pool.query("UPDATE leads SET deleted_at=now() WHERE id=$1", [id]);
  await audit(u.id, "lead", id, "DELETE");
  res.json({ ok: true });
}));

const PIPE = ["NEW", "CONTACTED", "QUALIFIED", "QUOTING", "NEGOTIATION"];
/** Dipakai modul penawaran: majukan tahap lead non-internet (hanya maju; WON dari tahap terbuka mana pun). */
export async function advanceLead(db: Q, leadId: number, to: "QUOTING" | "NEGOTIATION" | "WON", note: string, actor: { id: string; name: string } | null) {
  const l = (await db.query("SELECT id, stage, kind FROM leads WHERE id=$1 AND deleted_at IS NULL", [leadId])).rows[0];
  if (!l || l.kind !== "NON_INTERNET" || !OPEN.includes(l.stage)) return false;
  if (to !== "WON" && !(PIPE.indexOf(to) > PIPE.indexOf(l.stage))) return false;
  await db.query(
    `UPDATE leads SET stage=$2, updated_at=now(), won_at=CASE WHEN $2='WON' THEN now() ELSE won_at END, closed_at=CASE WHEN $2='WON' THEN now() ELSE closed_at END WHERE id=$1`, [leadId, to]);
  await event(db, leadId, "STAGE", { from: l.stage, to, note, actor });
  return true;
}
