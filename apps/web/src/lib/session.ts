// Sesi tunggal Maung: token login WO disimpan browser per alamat (satu domain) pada kunci `maung_token`
// (localStorage = "ingat saya", jika tidak sessionStorage). CRM tidak punya login/akun sendiri.
const TOK = "maung_token";
const LAST = "maung_last_active";
export const API_PREFIX = "/crm/api"; // API & unggahan CRM; /api dan /uploads di domain ini milik WO

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export const token = (): string | null =>
  typeof window === "undefined" ? null : safe(() => localStorage.getItem(TOK) ?? sessionStorage.getItem(TOK), null);
const store = (): Storage => safe(() => (localStorage.getItem(TOK) ? localStorage : sessionStorage), sessionStorage);

/** Hanya jalur internal yang dipakai sebagai `next`. */
export const toLogin = () => {
  const here = location.pathname + location.search;
  location.href = `/login?next=${encodeURIComponent(here.startsWith("/") && !here.startsWith("//") ? here : "/crm/")}`;
};

export const logout = () => {
  safe(() => { localStorage.removeItem(TOK); sessionStorage.removeItem(TOK); }, undefined);
  location.href = "/login";
};

let refreshing = false;
/** Perpanjang sesi diam WO (30 mnt): POST /api/auth/refresh (milik WO, satu domain) → token baru ke penyimpanan yang sama. */
export async function keepAlive() {
  if (refreshing || !token()) return;
  refreshing = true;
  try {
    safe(() => localStorage.setItem(LAST, String(Date.now())), undefined);
    const r = await fetch("/api/auth/refresh", { method: "POST", headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" }, body: "{}" });
    if (r.ok) { const d = await r.json(); if (d?.token) safe(() => store().setItem(TOK, d.token), undefined); }
    else if (r.status === 401) toLogin();
  } catch { /* jaringan: coba lagi pada siklus berikutnya */ } finally { refreshing = false; }
}
