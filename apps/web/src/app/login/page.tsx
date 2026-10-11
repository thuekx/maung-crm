"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const d = await api<{ token?: string; accessToken?: string }>("/auth/login", { method: "POST", json: { username, password } });
      const t = d.token ?? d.accessToken;
      if (!t) throw new Error("Respons login tidak berisi token");
      setToken(t);
      await api("/me"); // memastikan akun berhak (MKT/ADMIN)
      router.push("/");
    } catch (e: any) { setToken(null); setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card mx-auto mt-16 max-w-sm space-y-3">
      <h1 className="text-lg font-semibold">Masuk dengan akun Maung WO</h1>
      <div><label className="lbl">Username</label><input className="inp" value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" required /></div>
      <div>
        <label className="lbl">Password</label>
        <div className="flex gap-2">
          <input className="inp" type={show ? "text" : "password"} value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required />
          <button type="button" className="btn-ghost" aria-label="Tampilkan password" onClick={() => setShow(!show)}>{show ? "🙈" : "👁"}</button>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn w-full" disabled={busy}>{busy ? "Memproses…" : "Masuk"}</button>
    </form>
  );
}
