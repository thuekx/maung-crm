"use client";
import { useCallback, useEffect, useState } from "react";
import { Avatar, Badge, PageHeader, Section } from "@/components/ui";
import { token, toLogin } from "@/lib/session";

/**
 * Profil pengguna — sama dengan Profil di Maung WO. Akun & password dikelola WO (satu login untuk semua aplikasi):
 * halaman ini memanggil API WO di domain yang sama (/api/auth/*) dengan token login yang sama.
 */
const ROLE: Record<string, string> = { ADMIN: "Admin", MKT: "Marketing", NOC: "NOC", FOC: "Field Operation", GA: "General Affairs", FIN: "Finance" };
const SUB: Record<string, string> = { MANAGER: "Manager", SUPERVISOR: "Supervisor", STAFF: "Staff" };

async function wo<T = any>(path: string, init: { method?: string; json?: unknown; body?: FormData } = {}): Promise<T> {
  const t = token(); if (!t) { toLogin(); throw new Error("Belum login"); }
  const headers: Record<string, string> = { authorization: `Bearer ${t}` };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`/api${path}`, { method: init.method ?? "GET", headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (r.status === 401) { toLogin(); throw new Error("Sesi berakhir"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? d.message ?? `Gagal (${r.status})`);
  return d as T;
}

export default function Profile() {
  const [u, setU] = useState<any>(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", email: "" });
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [tg, setTg] = useState<any>(null);
  const [msg, setMsg] = useState<{ k: string; ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => wo("/auth/me").then((d) => { const x = d.user ?? d; setU(x); setF({ name: x.name ?? "", email: x.email ?? "" }); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <p className="card text-sm text-red-600">{err}</p>;
  if (!u) return <p>Memuat…</p>;

  const run = async (k: string, ok: string, fn: () => Promise<unknown>) => {
    setBusy(k); setMsg(null);
    try { await fn(); setMsg({ k, ok: true, t: ok }); await load(); } catch (e: any) { setMsg({ k, ok: false, t: e.message }); } finally { setBusy(""); }
  };
  const note = (k: string) => msg?.k === k && <p className={`text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>{msg.t}</p>;
  const pwBad = pw.next.length < 8 ? "Password baru minimal 8 karakter" : pw.next !== pw.again ? "Konfirmasi password tidak sama" : "";
  return (
    <div className="mx-auto max-w-xl space-y-4">
      {u.mustChangePassword && <p className="rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">⚠ Password Anda diatur ulang oleh Admin. Ganti password di bawah.</p>}
      <PageHeader icon="user" title="Profil" subtitle={`${u.email} · ${ROLE[u.role] ?? u.role}${u.role !== "ADMIN" && u.subRole ? ` · ${SUB[u.subRole] ?? u.subRole}` : ""}`} />

      <Section icon="user" title="Data profil">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={u.name} size={72} url={u.avatarUrl} />
          <div className="space-y-1.5">
            <label className="btn-ghost cursor-pointer">{busy === "avatar" ? "Mengunggah…" : "Unggah foto"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
                const fd = new FormData(); fd.append("file", file);
                run("avatar", "Foto profil tersimpan", () => wo("/auth/me/avatar", { method: "POST", body: fd }));
              }} />
            </label>
            {u.avatarUrl && <button className="btn-ghost ml-2 !border-red-300 !text-red-600" disabled={!!busy} onClick={() => run("avatar", "Foto dihapus", () => wo("/auth/me/avatar", { method: "DELETE" }))}>Hapus foto</button>}
            <p className="text-xs text-slate-500">JPG/PNG/WEBP, maks. 2 MB. Sama dengan foto profil di Maung WO.</p>
            {note("avatar")}
          </div>
        </div>
        <div><label className="lbl">Nama</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="lbl">Email (juga dipakai untuk login &amp; notifikasi)</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <p className="text-xs text-slate-500">Perubahan berlaku di semua aplikasi Maung. Lead, penawaran, dan report yang sudah dibuat tetap memuat nama saat dibuat (jejak permanen).</p>
        <button className="btn" disabled={!!busy || f.name.trim().length < 2 || !f.email.trim() || (f.name.trim() === u.name && f.email.trim() === u.email)}
          onClick={() => run("profile", "Profil tersimpan", () => wo("/auth/me", { method: "PATCH", json: { name: f.name.trim(), email: f.email.trim() } }))}>{busy === "profile" ? "Menyimpan…" : "Simpan profil"}</button>
        {note("profile")}
      </Section>

      <Section icon="chat" title="Notifikasi Telegram" aside={u.telegramLinked ? <Badge tone="green" dot>terhubung</Badge> : undefined}>
        <p className="text-sm text-slate-500">Buat kode, lalu kirim perintah di bawah ke bot Telegram perusahaan. Email selalu aktif.</p>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run("tg", "Kode dibuat", async () => setTg(await wo("/auth/telegram-code", { method: "POST", json: {} })))}>Buat kode tautan</button>
        {tg && (
          <div className="space-y-1 rounded-xl bg-slate-100 p-3 text-sm dark:bg-white/5">
            <p>1. Buka bot Telegram{tg.botUsername ? <> <b>@{tg.botUsername}</b></> : " perusahaan"}.</p>
            <p>2. Kirim pesan ini ke bot: <span className="font-mono">{tg.command}</span> <span className="text-xs text-slate-500">(berlaku {Math.round(tg.expiresInSec / 60)} menit)</span></p>
          </div>
        )}
        {note("tg")}
      </Section>

      <Section icon="shield" title="Ganti password">
        <div><label className="lbl">Password lama</label><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
        <div><label className="lbl">Password baru (min. 8 karakter)</label><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
        <div><label className="lbl">Ulangi password baru</label><input className="input" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></div>
        {pw.next && pwBad && <p className="text-xs text-amber-700 dark:text-amber-400">{pwBad}</p>}
        <button className="btn" disabled={!!busy || !pw.current || !!pwBad}
          onClick={() => run("pw", "Password diganti", async () => { await wo("/auth/change-password", { method: "POST", json: { current: pw.current, next: pw.next } }); setPw({ current: "", next: "", again: "" }); })}>{busy === "pw" ? "Menyimpan…" : "Ganti password"}</button>
        {note("pw")}
      </Section>
    </div>
  );
}
