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
const inflight = new Map<string, Promise<Principal | null>>();
const TTL_MS = 60_000;
/** Bila WO sesaat tidak terjangkau (restart/deploy, jaringan), pengguna yang tervalidasi ≤10 menit lalu tetap dilayani. */
const STALE_MS = 10 * 60_000;
const TIMEOUT_MS = 8_000;

/** WO tidak menjawab dengan benar — `reason` dicatat di log dan ditampilkan singkat ke pengguna. */
class WoUnreachable extends Error {
  constructor(readonly reason: string) { super(reason); }
}

async function fetchMe(token: string): Promise<globalThis.Response> {
  let last: WoUnreachable | undefined;
  for (let i = 0; i < 2; i++) {
    if (i) await new Promise((r) => setTimeout(r, 400));
    try {
      const r = await fetch(`${WO_URL()}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (r.status === 429 || r.status >= 500) { last = new WoUnreachable(`HTTP ${r.status}`); continue; } // sementara → ulangi sekali
      return r;
    } catch (e) {
      const c = (e as { cause?: { code?: string } }).cause?.code;
      last = new WoUnreachable((e as Error).name === "TimeoutError" ? "timeout" : c ?? (e as Error).message);
    }
  }
  throw last!;
}

/** Validasi token ke WO: GET /api/auth/me (200 = valid; 401 = tidak valid/kedaluwarsa). Satu panggilan memberi peran + fitur. */
async function whoAmI(token: string): Promise<Principal | null> {
  const r = await fetchMe(token);
  if (r.status === 401) return null;
  if (!r.ok) throw new WoUnreachable(`HTTP ${r.status}`);
  let d: { id?: string; name?: string; email?: string; role?: string; subRole?: string; features?: unknown; acting?: unknown };
  try { d = await r.json(); } catch { throw new WoUnreachable(`jawaban bukan JSON (${r.headers.get("content-type") ?? "-"})`); }
  if (!d.id || !d.role) return null;
  const user: Principal = {
    id: String(d.id), name: d.name ?? String(d.id), email: d.email, role: d.role, subRole: d.subRole,
    features: Array.isArray(d.features) ? d.features.filter((f): f is string => typeof f === "string") : [],
    acting: !!d.acting,
  };
  if (cache.size > 500) for (const [k, v] of cache) if (v.exp + STALE_MS <= Date.now()) cache.delete(k);
  cache.set(token, { exp: Date.now() + TTL_MS, user });
  // cache nama/peran untuk daftar PIC — gagal tulis di DB CRM bukan alasan menolak login
  await pool.query(
    `INSERT INTO wo_user_cache (user_id,name,email,role,sub_role,seen_at) VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (user_id) DO UPDATE SET name=$2,email=$3,role=$4,sub_role=$5,seen_at=now()`,
    [user.id, user.name, user.email ?? null, user.role, user.subRole ?? null],
  ).catch((e) => console.error("[auth] wo_user_cache:", (e as Error).message));
  return user;
}

/** Satu panggilan ke WO per token sekaligus (Dashboard memanggil beberapa API bersamaan). */
async function resolve(token: string): Promise<Principal | null> {
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  let p = inflight.get(token);
  if (!p) {
    p = whoAmI(token).finally(() => inflight.delete(token));
    inflight.set(token, p);
  }
  try {
    return await p;
  } catch (e) {
    if (e instanceof WoUnreachable && hit && hit.exp + STALE_MS > Date.now()) return hit.user;
    throw e;
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  if (!m) return void res.status(401).json({ error: "Belum login" });
  let u: Principal | null;
  try {
    u = await resolve(m[1]);
  } catch (e) {
    const reason = e instanceof WoUnreachable ? e.reason : (e as Error).message;
    console.error(`[auth] GET ${WO_URL()}/api/auth/me gagal: ${reason}`);
    return void res.status(502).json({ error: `Maung WO tidak dapat dihubungi (${reason}). Coba muat ulang sebentar lagi.` });
  }
  if (!u) return void res.status(401).json({ error: "Token tidak valid atau kedaluwarsa" });
  req.user = u;
  next();
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
export const _clearAuthCache = () => { cache.clear(); inflight.clear(); };
/** Hanya untuk uji: anggap validasi token sudah lewat TTL. */
export const _expireAuthCache = () => { for (const v of cache.values()) v.exp = Date.now() - 1; };
