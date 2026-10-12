import { API_PREFIX, token, toLogin } from "./session";

export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

/** Unduh berkas dari API (butuh header Authorization → fetch + blob, bukan tautan biasa). */
export async function download(path: string, filename: string) {
  const t = token(); if (!t) { toLogin(); return; }
  const r = await fetch(`${API_PREFIX}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Gagal (${r.status})`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function upload<T = any>(path: string, file: File): Promise<T> {
  const t = token(); if (!t) { toLogin(); throw new Error("Belum login"); }
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch(`${API_PREFIX}${path}`, { method: "POST", headers: { Authorization: `Bearer ${t}` }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `Gagal (${r.status})`);
  return d as T;
}
