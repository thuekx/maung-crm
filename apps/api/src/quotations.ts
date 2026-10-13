import { notify, reviewerIds } from "./notify.js";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, pool } from "./db.js";
import { isReviewer, type Principal } from "./auth.js";
import { advanceLead } from "./leads.js";
import { enqueue } from "./woPush.js";
import { getSetting } from "./settings.js";
import { woCustomerProblems } from "./woPayload.js";

const fail = (status: number, error: string) => Object.assign(new Error(error), { status });
const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const idParam = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw fail(400, "ID tidak valid"); return n; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
type Q = { query: typeof pool.query };

export const STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const;
const LIVE = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"];

const lineSchema = z.object({
  catalogId: z.coerce.number().int().positive(),
  qty: z.number().positive().max(1e7),
  unitPrice: z.number().min(0).max(1e12).optional(),
  note: z.string().trim().max(300).optional(),
});
const bodySchema = z.object({
  subject: z.string().trim().max(200).optional(),
  customerName: z.string().trim().min(1).max(120).optional(),
  customerPhone: z.string().trim().max(30).optional(),
  customerEmail: z.string().trim().max(120).optional(),
  customerAddress: z.string().trim().max(300).optional(),
  picName: z.string().trim().max(120).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  terms: z.string().trim().max(2000).optional(), // batas WO
  notes: z.string().trim().max(2000).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  discount: z.number().min(0).max(1e12).optional(),
  lines: z.array(lineSchema).max(60).optional(),
});

const scope = (u: Principal, args: unknown[]) => {
  if (isReviewer(u)) return "TRUE";
  args.push(u.id);
  // Penawaran tetap terlihat oleh pemilik lead saat ini walau lead dipindahtangankan (jejak pemilik penawaran tidak berubah).
  return `(q.owner_id=$${args.length} OR q.created_by=$${args.length} OR EXISTS (SELECT 1 FROM leads lx WHERE lx.id=q.lead_id AND lx.owner_id=$${args.length}))`;
};
async function load(id: number, u: Principal) {
  const args: unknown[] = [id];
  const r = await pool.query(`SELECT q.* FROM quotations q WHERE q.id=$1 AND q.deleted_at IS NULL AND ${scope(u, args)}`, args);
  if (!r.rows[0]) throw fail(404, "Penawaran tidak ditemukan");
  return r.rows[0];
}
async function event(db: Q, id: number, type: string, o: { from?: string | null; to?: string | null; note?: string | null; actor?: { id: string; name: string } | null }) {
  await db.query("INSERT INTO quotation_events (quotation_id,type,from_status,to_status,note,actor_id,actor_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, type, o.from ?? null, o.to ?? null, o.note ?? null, o.actor?.id ?? null, o.actor?.name ?? null]);
}

/** Hitung total di server (klien tidak dipercaya): baris → subtotal → diskon → PPN → total. */
export function totals(lines: { qty: number; unitPrice: number }[], discount: number, taxRate: number) {
  const subtotal = r2(lines.reduce((s, l) => s + r2(l.qty * l.unitPrice), 0));
  if (discount > subtotal) throw fail(400, "Diskon melebihi subtotal");
  const taxable = r2(subtotal - discount), tax = r2((taxable * taxRate) / 100);
  return { subtotal, taxAmount: tax, total: r2(taxable + tax) };
}

async function nextNumber(db: Q, d: Date) {
  const y = d.getFullYear();
  const r = await db.query("INSERT INTO quotation_counters (year,value) VALUES ($1,1) ON CONFLICT (year) DO UPDATE SET value=quotation_counters.value+1 RETURNING value", [y]);
  return `QT-${String(y % 1000).padStart(3, "0")}-${String(r.rows[0].value).padStart(4, "0")}`;
}

/** Ganti seluruh baris dari katalog aktif; nama/jenis/satuan disalin (penawaran tidak berubah bila katalog diubah). */
async function writeLines(db: Q, id: number, lines: z.infer<typeof lineSchema>[]) {
  const ids = [...new Set(lines.map((l) => l.catalogId))];
  const cat = ids.length ? (await db.query("SELECT id,name,sku,kind,unit,price,active,is_demo FROM catalog_items WHERE id=ANY($1)", [ids])).rows : [];
  const by = new Map(cat.map((c: any) => [Number(c.id), c]));
  const demoQ = !!(await db.query("SELECT is_demo FROM quotations WHERE id=$1", [id])).rows[0]?.is_demo;
  await db.query("DELETE FROM quotation_lines WHERE quotation_id=$1", [id]);
  const priced: { qty: number; unitPrice: number }[] = [];
  for (const [i, l] of lines.entries()) {
    const c: any = by.get(l.catalogId);
    if (!c) throw fail(400, `Item katalog #${l.catalogId} tidak ada`);
    if (!c.active) throw fail(400, `Item katalog "${c.name}" nonaktif`);
    if (c.is_demo && !demoQ) throw fail(400, `Item "${c.name}" adalah data demo — hanya untuk penawaran demo`);
    const unitPrice = l.unitPrice ?? Number(c.price);
    priced.push({ qty: l.qty, unitPrice });
    await db.query("INSERT INTO quotation_lines (quotation_id,position,catalog_id,name,sku,kind,unit,qty,unit_price,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [id, i, c.id, c.name, c.sku ?? null, c.kind, c.unit, l.qty, unitPrice, l.note ?? null]);
  }
  return priced;
}

export async function detail(q: any) {
  const [lines, events, revs, lead] = await Promise.all([
    pool.query(`SELECT id, position, catalog_id AS "catalogId", name, sku, kind, unit, qty, unit_price AS "unitPrice", note FROM quotation_lines WHERE quotation_id=$1 ORDER BY position`, [q.id]),
    pool.query(`SELECT id, type, from_status AS "fromStatus", to_status AS "toStatus", note, actor_name AS "actorName", at FROM quotation_events WHERE quotation_id=$1 ORDER BY at, id`, [q.id]),
    pool.query(`SELECT rev, reason, actor_name AS "actorName", at, snapshot->>'total' AS total, snapshot->>'status' AS status FROM quotation_revisions WHERE quotation_id=$1 ORDER BY rev`, [q.id]),
    pool.query(`SELECT id, name, stage, kind, customer_code AS "customerCode", related_customer_code AS "relatedCustomerCode", new_location AS "newLocation" FROM leads WHERE id=$1`, [q.lead_id]),
  ]);
  const n = (v: unknown) => Number(v);
  return {
    id: q.id, number: q.number, rev: q.rev, status: q.status, leadId: q.lead_id, lead: lead.rows[0] ?? null, ownerId: q.owner_id, ownerName: q.owner_name, marketingUserId: q.owner_id, marketingName: q.owner_name, createdBy: q.created_by, createdByName: q.created_by_name,
    customerCode: q.customer_code, customerName: q.customer_name, customerPhone: q.customer_phone, customerEmail: q.customer_email, customerAddress: q.customer_address,
    picName: q.pic_name, subject: q.subject, validUntil: q.valid_until ? String(q.valid_until).slice(0, 10) : null, terms: q.terms, notes: q.notes,
    taxRate: n(q.tax_rate), discount: n(q.discount), subtotal: n(q.subtotal), taxAmount: n(q.tax_amount), total: n(q.total),
    sentAt: q.sent_at, decidedAt: q.decided_at, decisionNote: q.decision_note, approvedByName: q.approved_by_name, approvedAt: q.approved_at,
    createdAt: q.created_at, updatedAt: q.updated_at,
    wo: { syncedAt: q.wo_synced_at ?? null, syncedRev: q.wo_synced_rev ?? null, syncedStatus: q.wo_synced_status ?? null, woNumber: q.wo_number ?? null, warnings: q.wo_warnings ?? null },
    lines: lines.rows.map((l) => ({ ...l, qty: n(l.qty), unitPrice: n(l.unitPrice) })),
    events: events.rows, revisions: revs.rows.map((r) => ({ ...r, total: Number(r.total) })),
  };
}

/** SENT yang melewati masa berlaku → EXPIRED (dipanggil berkala dan saat membaca daftar). */
export async function sweepExpired(): Promise<number> {
  const r = await pool.query(
    `UPDATE quotations SET status='EXPIRED', updated_at=now(), decided_at=now() WHERE status='SENT' AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE AND deleted_at IS NULL RETURNING id`);
  for (const x of r.rows) { await event(pool, x.id, "STATUS", { from: "SENT", to: "EXPIRED", note: "Masa berlaku berakhir", actor: null }); await enqueue("QUOTATION", x.id); }
  return r.rowCount ?? 0;
}
export function startExpirySweep() { setInterval(() => sweepExpired().catch((e) => console.error("sweep penawaran:", e)), 3_600_000).unref(); }

export const quotationRoutes = Router();

quotationRoutes.post("/", ah(async (req, res) => {
  const u = req.user!;
  const b = bodySchema.extend({ leadId: z.coerce.number().int().positive() }).parse(req.body);
  const largs: unknown[] = [b.leadId];
  const lead = (await pool.query(`SELECT l.* FROM leads l WHERE l.id=$1 AND l.deleted_at IS NULL AND ${isReviewer(u) ? "TRUE" : (largs.push(u.id), `(l.owner_id=$2 OR l.created_by=$2)`)}`, largs)).rows[0];
  if (!lead) throw fail(404, "Lead tidak ditemukan");
  if (lead.kind !== "NON_INTERNET") throw fail(409, "Penawaran hanya untuk lead non-internet / layanan tambahan (lead internet didaftarkan di MSRadius)");
  if (["WON", "LOST"].includes(lead.stage)) throw fail(409, "Lead sudah ditutup");
  const cfg = await getSetting("quotation"); // default dari Pengaturan CRM
  const c = await pool.connect();
  let id: number;
  try {
    await c.query("BEGIN");
    const number = await nextNumber(c, new Date());
    const lines = b.lines ?? [];
    const r = await c.query(
      `INSERT INTO quotations (number,lead_id,owner_id,owner_name,customer_code,customer_name,customer_phone,customer_email,customer_address,pic_name,subject,valid_until,terms,notes,tax_rate,discount,created_by,created_by_name,is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [number, lead.id, lead.owner_id, lead.owner_name, lead.customer_code, b.customerName ?? lead.name, b.customerPhone ?? lead.phone, b.customerEmail ?? lead.email, b.customerAddress ?? lead.address,
       b.picName ?? null, b.subject ?? lead.interest ?? null, b.validUntil ?? new Date(Date.now() + cfg.validDays * 86_400_000).toISOString().slice(0, 10), b.terms ?? cfg.terms, b.notes ?? null, b.taxRate ?? cfg.taxRate, b.discount ?? 0, u.id, u.name, !!lead.is_demo]); // penawaran dari lead demo ikut demo → tak pernah dikirim ke WO
    id = r.rows[0].id;
    const t = totals(await writeLines(c, id, lines), b.discount ?? 0, b.taxRate ?? cfg.taxRate);
    await c.query("UPDATE quotations SET subtotal=$2, tax_amount=$3, total=$4 WHERE id=$1", [id, t.subtotal, t.taxAmount, t.total]);
    await event(c, id, "CREATED", { to: "DRAFT", actor: u });
    await advanceLead(c, lead.id, "QUOTING", `Penawaran ${number} dibuat`, u);
    await audit(u.id, "quotation", id, "CREATE", null, { number, leadId: lead.id }, c);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  res.status(201).json(await detail(await load(id, u)));
}));

quotationRoutes.get("/", ah(async (req, res) => {
  const u = req.user!;
  await sweepExpired();
  const args: unknown[] = [], where = ["q.deleted_at IS NULL", scope(u, args)];
  const f = z.object({ status: z.string().optional(), leadId: z.coerce.number().int().optional(), q: z.string().optional(), open: z.string().optional() }).parse(req.query);
  if (f.status) { args.push(f.status); where.push(`q.status=$${args.length}`); }
  if (f.open === "1") { args.push(LIVE); where.push(`q.status=ANY($${args.length})`); }
  if (f.leadId) { args.push(f.leadId); where.push(`q.lead_id=$${args.length}`); }
  if (f.q?.trim()) { args.push(`%${f.q.trim().toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c)}%`); where.push(`(lower(q.number) LIKE $${args.length} OR lower(q.customer_name) LIKE $${args.length})`); }
  const r = await pool.query(
    `SELECT q.id, q.number, q.rev, q.status, q.lead_id AS "leadId", q.customer_name AS "customerName", q.subject, q.total, q.valid_until AS "validUntil", q.owner_name AS "ownerName", q.updated_at AS "updatedAt"
     FROM quotations q WHERE ${where.join(" AND ")} ORDER BY q.updated_at DESC LIMIT 300`, args);
  res.json(r.rows.map((x) => ({ ...x, total: Number(x.total), validUntil: x.validUntil ? String(x.validUntil).slice(0, 10) : null })));
}));

quotationRoutes.get("/:id", ah(async (req, res) => { await sweepExpired(); res.json(await detail(await load(idParam(req), req.user!))); }));

/** Ubah isi — hanya DRAFT. */
quotationRoutes.put("/:id", ah(async (req, res) => {
  const u = req.user!, id = idParam(req), q = await load(id, u), b = bodySchema.parse(req.body);
  if (q.status !== "DRAFT") throw fail(409, "Hanya penawaran DRAFT yang bisa diubah (buat revisi untuk yang sudah diajukan/dikirim)");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const m = {
      customer_name: b.customerName ?? q.customer_name, customer_phone: "customerPhone" in b ? b.customerPhone ?? null : q.customer_phone, customer_email: "customerEmail" in b ? b.customerEmail ?? null : q.customer_email,
      customer_address: "customerAddress" in b ? b.customerAddress ?? null : q.customer_address, pic_name: "picName" in b ? b.picName ?? null : q.pic_name, subject: "subject" in b ? b.subject ?? null : q.subject,
      valid_until: b.validUntil ?? q.valid_until, terms: b.terms ?? q.terms, notes: "notes" in b ? b.notes ?? null : q.notes, tax_rate: b.taxRate ?? Number(q.tax_rate), discount: b.discount ?? Number(q.discount),
    };
    await c.query(
      `UPDATE quotations SET customer_name=$2,customer_phone=$3,customer_email=$4,customer_address=$5,pic_name=$6,subject=$7,valid_until=$8,terms=$9,notes=$10,tax_rate=$11,discount=$12,updated_at=now() WHERE id=$1`,
      [id, m.customer_name, m.customer_phone, m.customer_email, m.customer_address, m.pic_name, m.subject, m.valid_until, m.terms, m.notes, m.tax_rate, m.discount]);
    let priced: { qty: number; unitPrice: number }[];
    if (b.lines) priced = await writeLines(c, id, b.lines);
    else priced = (await c.query("SELECT qty, unit_price FROM quotation_lines WHERE quotation_id=$1", [id])).rows.map((l: any) => ({ qty: Number(l.qty), unitPrice: Number(l.unit_price) }));
    const t = totals(priced, m.discount, m.tax_rate);
    await c.query("UPDATE quotations SET subtotal=$2, tax_amount=$3, total=$4 WHERE id=$1", [id, t.subtotal, t.taxAmount, t.total]);
    await event(c, id, "UPDATED", { actor: u });
    await audit(u.id, "quotation", id, "UPDATE", null, { total: t.total }, c);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  res.json(await detail(await load(id, u)));
}));

const ACTIONS = {
  submit: { from: ["DRAFT"], to: "PENDING_APPROVAL", reviewer: false, note: false },
  approve: { from: ["PENDING_APPROVAL"], to: "APPROVED", reviewer: true, note: false },
  return: { from: ["PENDING_APPROVAL"], to: "DRAFT", reviewer: true, note: true },
  send: { from: ["APPROVED"], to: "SENT", reviewer: false, note: false },
  accept: { from: ["SENT"], to: "ACCEPTED", reviewer: false, note: false },
  reject: { from: ["SENT"], to: "REJECTED", reviewer: false, note: true },
  cancel: { from: LIVE, to: "CANCELLED", reviewer: false, note: true },
} as const;

quotationRoutes.post("/:id/:action", ah(async (req, res) => {
  const u = req.user!, id = idParam(req), key = String(req.params.action);
  const q = await load(id, u);
  const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});

  if (key === "revise") {
    if (!["APPROVED", "SENT", "REJECTED", "EXPIRED"].includes(q.status)) throw fail(409, q.status === "ACCEPTED" ? "Penawaran yang sudah disetujui pelanggan terkunci — buat penawaran baru" : "Revisi hanya untuk penawaran yang sudah disetujui/dikirim/ditolak/kedaluwarsa");
    if (!body.note) throw fail(400, "Alasan revisi wajib diisi");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const snap = await detail(q);
      await c.query("INSERT INTO quotation_revisions (quotation_id,rev,snapshot,reason,actor_id,actor_name) VALUES ($1,$2,$3,$4,$5,$6)", [id, q.rev, JSON.stringify(snap), body.note, u.id, u.name]);
      await c.query("UPDATE quotations SET rev=rev+1, status='DRAFT', sent_at=NULL, decided_at=NULL, decision_note=NULL, approved_by=NULL, approved_by_name=NULL, approved_at=NULL, updated_at=now() WHERE id=$1", [id]);
      await event(c, id, "REVISION", { from: q.status, to: "DRAFT", note: `Revisi ${q.rev + 1}: ${body.note}`, actor: u });
      await audit(u.id, "quotation", id, "REVISE", { rev: q.rev }, { rev: q.rev + 1 }, c);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
    return void res.json(await detail(await load(id, u)));
  }

  const a = (ACTIONS as Record<string, { from: readonly string[]; to: string; reviewer: boolean; note: boolean }>)[key];
  if (!a) throw fail(404, "Aksi tidak dikenal");
  if (a.reviewer && !isReviewer(u)) throw fail(403, "Hanya reviewer (Admin / MKT Manager / Supervisor)");
  if (!a.from.includes(q.status)) throw fail(409, `Aksi "${key}" tidak bisa dari status ${q.status}`);
  if (a.note && !body.note) throw fail(400, "Catatan/alasan wajib diisi");
  if (key === "submit" || key === "approve" || key === "send") {
    const n = (await pool.query("SELECT count(*)::int n FROM quotation_lines WHERE quotation_id=$1", [id])).rows[0].n;
    if (!n) throw fail(409, "Tambahkan minimal satu baris sebelum diajukan");
    if (key === "submit") {
      if (!q.valid_until) throw fail(409, "Isi tanggal berlaku sampai");
      const miss = woCustomerProblems({ customerName: q.customer_name, customerPhone: q.customer_phone, customerAddress: q.customer_address, customerEmail: q.customer_email });
      if (miss.length) throw fail(409, `Lengkapi data pelanggan sebelum diajukan (dibutuhkan WO): ${miss.join(", ")}`);
      const bad = (await pool.query("SELECT l.name FROM quotation_lines l JOIN catalog_items c ON c.id=l.catalog_id WHERE l.quotation_id=$1 AND NOT c.active LIMIT 1", [id])).rows[0];
      if (bad) throw fail(409, `Item katalog "${bad.name}" sudah nonaktif — ganti barisnya`);
    }
  }
  if (key === "send" && q.valid_until && String(q.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10)) throw fail(409, "Tanggal berlaku sudah lewat — buat revisi dengan tanggal baru");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `UPDATE quotations SET status=$2, updated_at=now(),
         approved_by=CASE WHEN $3='approve' THEN $4 WHEN $3='return' THEN NULL ELSE approved_by END, approved_by_name=CASE WHEN $3='approve' THEN $5 WHEN $3='return' THEN NULL ELSE approved_by_name END,
         approved_at=CASE WHEN $3='approve' THEN now() WHEN $3='return' THEN NULL ELSE approved_at END,
         sent_at=CASE WHEN $3='send' THEN now() ELSE sent_at END,
         decided_at=CASE WHEN $2 IN ('ACCEPTED','REJECTED','CANCELLED') THEN now() ELSE decided_at END,
         decision_note=CASE WHEN $2 IN ('ACCEPTED','REJECTED','CANCELLED') THEN $6 ELSE decision_note END WHERE id=$1`,
      [id, a.to, key, u.id, u.name, body.note ?? null]);
    await event(c, id, "STATUS", { from: q.status, to: a.to, note: body.note, actor: u });
    if (key === "send") await advanceLead(c, q.lead_id, "NEGOTIATION", `Penawaran ${q.number} dikirim`, u);
    if (key === "accept") await advanceLead(c, q.lead_id, "WON", `Penawaran ${q.number} disetujui pelanggan`, u);
    if (["send", "accept", "reject", "cancel"].includes(key)) await enqueue("QUOTATION", id, c); // kirim ke WO (QUOTED / WON / LOST)
    await audit(u.id, "quotation", id, key.toUpperCase(), { status: q.status }, { status: a.to }, c);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  if (!q.is_demo) {
    const href = `/quotations/${id}`;
    if (key === "submit") await notify(await reviewerIds(u.id), { type: "QUOTATION_SUBMITTED", title: `Penawaran ${q.number} menunggu persetujuan`, body: `${q.customer_name} · diajukan ${u.name}`, href, key: `qt-sub:${id}:${q.rev}` });
    if (key === "approve" && q.owner_id !== u.id) await notify([q.owner_id], { type: "QUOTATION_APPROVED", title: `Penawaran ${q.number} disetujui`, body: `${q.customer_name} · oleh ${u.name} — siap dikirim ke pelanggan`, href, key: `qt-app:${id}:${q.rev}` });
    if (key === "return" && q.owner_id !== u.id) await notify([q.owner_id], { type: "QUOTATION_RETURNED", title: `Penawaran ${q.number} dikembalikan`, body: `${u.name}: ${body.note}`, href });
  }
  res.json(await detail(await load(id, u)));
}));
