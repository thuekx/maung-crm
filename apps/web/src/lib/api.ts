import { API_PREFIX, token, toLogin } from "./session";

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = token();
  if (!t) { toLogin(); throw new Error("Belum login"); }
  headers.set("Authorization", `Bearer ${t}`);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const r = await fetch(`${API_PREFIX}${path}`, { ...init, headers, body });
  if (r.status === 401) { toLogin(); throw new Error("Sesi berakhir"); }
  if (r.status === 204) return undefined as T;
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Gagal (${r.status})`);
  return d as T;
}

export const ACTIVITY_TYPES: Record<string, string> = {
  CANVASSING: "Canvassing", MEETING: "Meeting", FOLLOW_UP: "Follow-up", SURVEY: "Survey",
  PARTNERSHIP: "Partnership", COMMUNITY_ENGAGEMENT: "Community Engagement", LAINNYA: "Lainnya",
};
export const fmtDate = (s: string) => new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
