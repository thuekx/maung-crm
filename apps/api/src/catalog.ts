import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, pool } from "./db.js";
import { isReviewer } from "./auth.js";
import { enqueue } from "./woPush.js";

const fail = (status: number, error: string) => Object.assign(new Error(error), { status });
const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const base = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(80, "Nama maksimal 80 karakter (batas WO)"),
  kind: z.enum(["SERVICE", "PRODUCT"]),
  unit: z.string().trim().min(1).max(20),
  price: z.number().min(0).max(1e12),
  // Opsional; string kosong = tanpa SKU
  sku: z.string().trim().max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/, "SKU hanya huruf/angka . _ - /").optional().or(z.literal("")),
  description: z.string().trim().max(200).optional(), // batas WO
  active: z.boolean().optional(),
});
// Bawaan (satuan "unit", harga 0) hanya untuk item BARU; PATCH sebagian tidak boleh mereset nilai yang tidak dikirim.
const createBody = base.extend({ unit: base.shape.unit.default("unit"), price: base.shape.price.default(0) });
const patchBody = base.partial();

/** Nama tidak boleh sama dengan paket internet milik WO (WO menolak menimpa paket MSRadius). */
async function assertSkuFree(sku: string | null, exceptId?: number) {
  if (!sku) return;
  const c = await pool.query("SELECT id FROM catalog_items WHERE lower(sku)=lower($1)", [sku]);
  if (c.rows[0] && c.rows[0].id !== exceptId) throw fail(409, `SKU "${sku}" sudah dipakai item katalog lain`);
}
async function assertNameFree(name: string, exceptId?: number) {
  const w = await pool.query("SELECT 1 FROM wo_packages WHERE lower(name)=lower($1) AND kind='INTERNET'", [name]);
  if (w.rowCount) throw fail(409, `"${name}" sudah dipakai sebagai paket internet di WO — pakai nama lain`);
  const c = await pool.query("SELECT id FROM catalog_items WHERE lower(name)=lower($1)", [name]);
  if (c.rows[0] && c.rows[0].id !== exceptId) throw fail(409, `"${name}" sudah ada di katalog`);
}

export const catalogRoutes = Router();

catalogRoutes.get("/", ah(async (req, res) => {
  const all = req.query.all === "1" && isReviewer(req.user!);
  const r = await pool.query(
    `SELECT id, name, sku, kind, unit, price, description, active, wo_synced_at AS "woSyncedAt", wo_sync_error AS "woSyncError"
     FROM catalog_items ${all ? "" : "WHERE active"} ORDER BY lower(name)`);
  res.json(r.rows.map((x) => ({ ...x, price: Number(x.price) })));
}));

catalogRoutes.post("/", ah(async (req, res) => {
  const u = req.user!;
  // Item baru boleh ditambah siapa pun pengguna CRM (mis. langsung dari penawaran); ubah/nonaktifkan tetap hanya reviewer.
  const b = createBody.parse(req.body);
  await assertNameFree(b.name);
  const sku = b.sku || null;
  await assertSkuFree(sku);
  const r = await pool.query(
    "INSERT INTO catalog_items (name,sku,kind,unit,price,description,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [b.name, sku, b.kind, b.unit, b.price, b.description ?? null, b.active ?? true, u.id]);
  await audit(u.id, "catalog", r.rows[0].id, "CREATE", null, b);
  await enqueue("CATALOG", r.rows[0].id);
  res.status(201).json({ id: r.rows[0].id });
}));

catalogRoutes.patch("/:id", ah(async (req, res) => {
  const u = req.user!, id = Number(req.params.id);
  if (!isReviewer(u)) throw fail(403, "Katalog dikelola reviewer");
  if (!Number.isInteger(id) || id <= 0) throw fail(400, "ID tidak valid");
  const cur = (await pool.query("SELECT * FROM catalog_items WHERE id=$1", [id])).rows[0];
  if (!cur) throw fail(404, "Item katalog tidak ditemukan");
  const b = patchBody.parse(req.body);
  if (b.name && b.name.toLowerCase() !== cur.name.toLowerCase()) await assertNameFree(b.name, id);
  const sku = "sku" in b ? b.sku || null : cur.sku;
  if (sku !== cur.sku) await assertSkuFree(sku, id);
  const m = { sku, name: b.name ?? cur.name, kind: b.kind ?? cur.kind, unit: b.unit ?? cur.unit, price: b.price ?? Number(cur.price), description: "description" in b ? b.description ?? null : cur.description, active: b.active ?? cur.active };
  // Perubahan tidak mengubah penawaran lama: baris penawaran menyimpan salinan nama/harga saat dibuat.
  await pool.query("UPDATE catalog_items SET name=$2,kind=$3,unit=$4,price=$5,description=$6,active=$7,sku=$8,updated_at=now(),wo_synced_at=NULL WHERE id=$1", [id, m.name, m.kind, m.unit, m.price, m.description, m.active, m.sku]);
  await audit(u.id, "catalog", id, "UPDATE", { name: cur.name, price: Number(cur.price), active: cur.active }, m);
  await enqueue("CATALOG", id);
  res.json({ ok: true });
}));
