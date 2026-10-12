import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { audit, pool } from "./db.js";
import { isReviewer } from "./auth.js";

const fail = (status: number, error: string) => Object.assign(new Error(error), { status });
const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const body = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  kind: z.enum(["SERVICE", "PRODUCT"]),
  unit: z.string().trim().min(1).max(20).default("unit"),
  price: z.number().min(0).max(1e12).default(0),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
});

/** Nama tidak boleh sama dengan paket internet milik WO (WO menolak menimpa paket MSRadius). */
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
    `SELECT id, name, kind, unit, price, description, active, wo_synced_at AS "woSyncedAt", wo_sync_error AS "woSyncError"
     FROM catalog_items ${all ? "" : "WHERE active"} ORDER BY lower(name)`);
  res.json(r.rows.map((x) => ({ ...x, price: Number(x.price) })));
}));

catalogRoutes.post("/", ah(async (req, res) => {
  const u = req.user!;
  if (!isReviewer(u)) throw fail(403, "Katalog dikelola reviewer (Admin / MKT Manager / Supervisor)");
  const b = body.parse(req.body);
  await assertNameFree(b.name);
  const r = await pool.query(
    "INSERT INTO catalog_items (name,kind,unit,price,description,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [b.name, b.kind, b.unit, b.price, b.description ?? null, b.active ?? true, u.id]);
  await audit(u.id, "catalog", r.rows[0].id, "CREATE", null, b);
  res.status(201).json({ id: r.rows[0].id });
}));

catalogRoutes.patch("/:id", ah(async (req, res) => {
  const u = req.user!, id = Number(req.params.id);
  if (!isReviewer(u)) throw fail(403, "Katalog dikelola reviewer");
  if (!Number.isInteger(id) || id <= 0) throw fail(400, "ID tidak valid");
  const cur = (await pool.query("SELECT * FROM catalog_items WHERE id=$1", [id])).rows[0];
  if (!cur) throw fail(404, "Item katalog tidak ditemukan");
  const b = body.partial().parse(req.body);
  if (b.name && b.name.toLowerCase() !== cur.name.toLowerCase()) await assertNameFree(b.name, id);
  const m = { name: b.name ?? cur.name, kind: b.kind ?? cur.kind, unit: b.unit ?? cur.unit, price: b.price ?? Number(cur.price), description: "description" in b ? b.description ?? null : cur.description, active: b.active ?? cur.active };
  // Perubahan tidak mengubah penawaran lama: baris penawaran menyimpan salinan nama/harga saat dibuat.
  await pool.query("UPDATE catalog_items SET name=$2,kind=$3,unit=$4,price=$5,description=$6,active=$7,updated_at=now(),wo_synced_at=NULL WHERE id=$1", [id, m.name, m.kind, m.unit, m.price, m.description, m.active]);
  await audit(u.id, "catalog", id, "UPDATE", { name: cur.name, price: Number(cur.price), active: cur.active }, m);
  res.json({ ok: true });
}));
