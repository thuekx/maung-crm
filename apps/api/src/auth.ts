import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";

export const WO_URL = () => (process.env.WO_URL ?? "http://localhost:4000").replace(/\/$/, "");

export interface Principal {
  id: string; name: string; email?: string; role: string; subRole?: string;
}

declare global {
  namespace Express {
    interface Request { user?: Principal }
  }
}

const cache = new Map<string, { exp: number; user: Principal }>();
const TTL_MS = 30_000;

async function introspect(token: string): Promise<Principal | null> {
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(`${WO_URL()}/api/auth/introspect`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const d = (await r.json()) as { active?: boolean; sub?: string; name?: string; email?: string; role?: string; subRole?: string };
  if (!d.active || !d.sub || !d.role) return null;
  const user: Principal = { id: String(d.sub), name: d.name ?? String(d.sub), email: d.email, role: d.role, subRole: d.subRole };
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
    const u = await introspect(m[1]);
    if (!u) return void res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
    req.user = u;
    next();
  } catch {
    res.status(502).json({ error: "Maung WO tidak dapat dihubungi" });
  }
}

// RBAC: ADMIN = semua; divisi MKT: MANAGER/SUPERVISOR = reviewer (lihat semua); STAFF = hanya miliknya.
export const canUseCrm = (u: Principal) => u.role === "ADMIN" || u.role === "MKT";
export const isReviewer = (u: Principal) =>
  u.role === "ADMIN" || (u.role === "MKT" && (u.subRole === "MANAGER" || u.subRole === "SUPERVISOR"));

export function requireCrm(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !canUseCrm(req.user)) return void res.status(403).json({ error: "Akses hanya untuk divisi MKT/ADMIN" });
  next();
}
