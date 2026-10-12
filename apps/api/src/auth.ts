import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";

export const WO_URL = () => (process.env.WO_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** Fitur WO (Admin → Hak Akses → "Aplikasi: CRM") yang menjadi gerbang masuk CRM. ADMIN selalu boleh. */
export const CRM_FEATURE = "app.crm";

export interface Principal {
  id: string; name: string; email?: string; role: string; subRole?: string; features: string[];
  /** Admin WO yang sedang "bertindak sebagai" peran lain (menu Data & Backup ditolak selama itu). */
  acting?: boolean;
}

declare global {
  namespace Express {
    interface Request { user?: Principal }
  }
}

const cache = new Map<string, { exp: number; user: Principal }>();
const TTL_MS = 60_000;

/** Validasi token ke WO: GET /api/auth/me (200 = valid; 401 = tidak valid/kedaluwarsa). Satu panggilan memberi peran + fitur. */
async function whoAmI(token: string): Promise<Principal | null> {
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(`${WO_URL()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`WO /auth/me ${r.status}`);
  const d = (await r.json()) as { id?: string; name?: string; email?: string; role?: string; subRole?: string; features?: unknown; acting?: unknown };
  if (!d.id || !d.role) return null;
  const user: Principal = {
    id: String(d.id), name: d.name ?? String(d.id), email: d.email, role: d.role, subRole: d.subRole,
    features: Array.isArray(d.features) ? d.features.filter((f): f is string => typeof f === "string") : [],
    acting: !!d.acting,
  };
  if (cache.size > 500) for (const [k, v] of cache) if (v.exp <= Date.now()) cache.delete(k);
  cache.set(token, { exp: Date.now() + TTL_MS, user });
  await pool.query(
    `INSERT INTO wo_user_cache (user_id,name,email,role,sub_role,seen_at) VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (user_id) DO UPDATE SET name=$2,email=$3,role=$4,sub_role=$5,seen_at=now()`,
    [user.id, user.name, user.email ?? null, user.role, user.subRole ?? null],
  );
  return user;
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return void res.status(401).json({ error: "Belum login" });
  try {
    const u = await whoAmI(m[1]);
    if (!u) return void res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
    req.user = u;
    next();
  } catch {
    res.status(502).json({ error: "Maung WO tidak dapat dihubungi" });
  }
}

// Gerbang: ADMIN, atau fitur app.crm diberikan di WO. Cakupan data: ADMIN / MKT MANAGER|SUPERVISOR = reviewer (lihat semua);
// selain itu hanya report miliknya (pembuat atau PIC).
export const canUseCrm = (u: Principal) => u.role === "ADMIN" || u.features.includes(CRM_FEATURE);
export const isReviewer = (u: Principal) =>
  u.role === "ADMIN" || (u.role === "MKT" && (u.subRole === "MANAGER" || u.subRole === "SUPERVISOR"));

export function requireCrm(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !canUseCrm(req.user)) return void res.status(403).json({ error: "Akses CRM belum diberikan. Hubungi Admin Maung WO (Hak Akses → Aplikasi: CRM)." });
  next();
}

/** Menu Admin CRM (Pengaturan, Data & Backup): hanya Admin ASLI WO — bukan peran lain, bukan Admin yang sedang "bertindak sebagai". */
export function requireRealAdmin(req: Request, res: Response, next: NextFunction) {
  const u = req.user;
  if (!u || u.role !== "ADMIN") return void res.status(403).json({ error: "Hanya Admin" });
  if (u.acting) return void res.status(403).json({ error: 'Berhenti "bertindak sebagai" peran lain dulu untuk memakai menu ini' });
  next();
}

/** Hanya untuk uji. */
export const _clearAuthCache = () => cache.clear();
