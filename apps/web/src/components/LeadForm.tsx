"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CUST_STATUS, KIND } from "@/lib/leads";

export interface LeadFields { kind: string; name: string; phone: string; email: string; address: string; area: string; interest: string; source: string; notes: string }
const EMPTY: LeadFields = { kind: "INTERNET", name: "", phone: "", email: "", address: "", area: "", interest: "", source: "", notes: "" };

export default function LeadForm({ initial, submitLabel, onSubmit }: { initial?: Partial<LeadFields>; submitLabel: string; onSubmit: (f: LeadFields) => Promise<void> }) {
  const [f, setF] = useState<LeadFields>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [pkgs, setPkgs] = useState<string[]>([]);
  const [hint, setHint] = useState<any>(null);
  const editing = initial !== undefined;
  const set = (k: keyof LeadFields, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    api("/wo/areas").then((a: any[]) => setAreas(a.map((x) => x.name))).catch(() => {});
    api("/wo/packages").then((a: any[]) => setPkgs(a.filter((x) => x.active !== false).map((x) => x.name))).catch(() => {});
  }, []);
  // Petunjuk langsung: apakah nomor ini sudah milik pelanggan WO?
  useEffect(() => {
    setHint(null);
    if (f.phone.replace(/\D/g, "").length < 8) return;
    const t = setTimeout(() => api(`/customers/lookup?phone=${encodeURIComponent(f.phone)}`).then(setHint).catch(() => {}), 450);
    return () => clearTimeout(t);
  }, [f.phone]);

  const save = async () => {
    setBusy(true); setErr("");
    try { await onSubmit(f); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const ok = f.name.trim() && f.phone.trim().length >= 5;
  return (
    <div className="card space-y-3">
      {!editing && (
        <div>
          <label className="lbl">Jenis lead</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(KIND).map(([k, v]) => (
              <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${f.kind === k ? "border-accent-500 bg-accent-50 text-brand-900" : "border-slate-300"}`}>
                <input type="radio" name="kind" checked={f.kind === k} onChange={() => set("kind", k)} className="mt-1" />
                <span><b>{v}</b><br /><span className="text-xs text-slate-500">{k === "INTERNET" ? "Didaftarkan di MSRadius; CRM melacak sampai aktif." : "Sewa WiFi, CCTV, dll. Lewat penawaran di CRM."}</span></span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="lbl">Nama</label><input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div>
          <label className="lbl">No. telepon / WA (boleh nomor luar negeri: +60…)</label>
          <input className="input" inputMode="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
      </div>
      {hint && hint.exact.length > 0 && (
        <div className="rounded-lg border border-accent-300 bg-accent-50 p-2 text-xs text-brand-900">
          Nomor ini sudah terdaftar di WO: {hint.exact.map((c: any) => `${c.name} (${c.code} · ${CUST_STATUS[c.status] ?? c.status})`).join("; ")}
          {f.kind === "INTERNET" && hint.exact.some((c: any) => c.status === "ACTIVE") && " — sudah pelanggan aktif; untuk layanan tambahan pilih jenis non-internet."}
        </div>
      )}
      {hint && hint.exact.length === 0 && hint.weak.length > 0 && (
        <div className="rounded-lg border border-slate-300 p-2 text-xs text-slate-600">Kemungkinan pelanggan WO (9 digit terakhir sama): {hint.weak.map((c: any) => `${c.name} (${c.code})`).join("; ")}</div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="lbl">Email</label><input className="input" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label className="lbl">Area</label><input className="input" list="lead-areas" value={f.area} onChange={(e) => set("area", e.target.value)} /><datalist id="lead-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist></div>
      </div>
      <div><label className="lbl">Alamat</label><input className="input" value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="lbl">Minat layanan / paket</label><input className="input" list="lead-pkgs" value={f.interest} onChange={(e) => set("interest", e.target.value)} /><datalist id="lead-pkgs">{pkgs.map((a) => <option key={a} value={a} />)}</datalist></div>
        <div><label className="lbl">Sumber (referral, canvassing, walk-in…)</label><input className="input" value={f.source} onChange={(e) => set("source", e.target.value)} /></div>
      </div>
      <div><label className="lbl">Catatan</label><textarea className="input" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn w-full" disabled={busy || !ok} onClick={save}>{busy ? "Menyimpan…" : submitLabel}</button>
    </div>
  );
}
