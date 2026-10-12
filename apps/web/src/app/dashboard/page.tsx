"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ACTIVITY_TYPES, api } from "@/lib/api";
import { STAGE } from "@/lib/leads";
import { QSTATUS, rupiah } from "@/lib/money";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

function Tile({ label, value, sub, tone, href }: { label: string; value: React.ReactNode; sub?: string; tone?: "warn" | "good"; href?: string }) {
  const inner = (
    <div className={`card h-full ${tone === "warn" ? "border-amber-400" : ""}`}>
      <div className="subheader">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone === "warn" ? "text-amber-700" : tone === "good" ? "text-green-700" : "text-brand-900"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

function Bars({ rows, fmt = (n: number) => String(n) }: { rows: { label: string; value: number; note?: string }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-slate-500">Tidak ada data pada rentang ini.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-2"><span>{r.label}</span><span className="font-medium">{fmt(r.value)}{r.note ? <span className="text-xs font-normal text-slate-500"> · {r.note}</span> : null}</span></div>
          <div className="h-2 rounded bg-slate-100" role="presentation"><div className="h-2 rounded bg-accent-500" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function WoSync() {
  const [st, setSt] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const load = () => api("/wo-sync").then(setSt).catch(() => setSt(null)); // 403 untuk staf → panel tidak tampil
  useEffect(() => { load(); }, []);
  if (!st) return null;
  const retry = async (id: number) => { try { await api(`/wo-sync/${id}/retry`, { method: "POST" }); setMsg(""); await load(); } catch (e: any) { setMsg(e.message); } };
  return (
    <div className="card space-y-2 text-sm">
      <b>Kirim ke WO</b>
      <p className={st.enabled ? "text-slate-600" : "text-amber-700"}>
        {st.enabled ? `Aktif · menunggu ${st.pending} · ditolak WO ${st.blocked}` : st.keySet ? "Dimatikan (WO_SYNC_ENABLED=0)." : "Nonaktif: kunci integrasi belum diisi di server."}
      </p>
      {st.problems.map((p: any) => (
        <div key={p.id} className="rounded-lg border border-slate-200 p-2 text-xs">
          <div><b>{p.kind === "CATALOG" ? "Katalog" : "Penawaran"}</b> {p.crmId} · {p.status === "BLOCKED" ? "DITOLAK" : `percobaan ${p.attempts}`}</div>
          <div className="text-red-700">{p.lastError}</div>
          {p.status === "BLOCKED" && <button className="btn-ghost mt-1" onClick={() => retry(p.id)}>Coba lagi (setelah data diperbaiki)</button>}
        </div>
      ))}
      {msg && <p className="text-red-600">{msg}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [f, setF] = useState({ from: daysAgo(29), to: iso(new Date()), marketing: "", area: "" });
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
      api(`/dashboard?${p}`).then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message));
    }, f.area ? 400 : 0);
    return () => clearTimeout(t);
  }, [f]);

  const preset = (n: number) => setF((x) => ({ ...x, from: daysAgo(n - 1), to: iso(new Date()) }));
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <div className="card space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div><label className="lbl">Dari</label><input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div><label className="lbl">Sampai</label><input className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          {d?.people?.length > 0 && (
            <div><label className="lbl">Marketing</label>
              <select className="input" value={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.value })}>
                <option value="">Semua</option>{d.people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
          )}
          <div><label className="lbl">Area</label><input className="input" placeholder="mis. Bekasi" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></div>
        </div>
        <div className="flex gap-2 text-sm">{[7, 30, 90].map((n) => <button key={n} className="btn-ghost" onClick={() => preset(n)}>{n} hari</button>)}</div>
        {d && d.scope === "marketing" && !d.people?.length && <p className="text-xs text-slate-500">Menampilkan data Anda sendiri.</p>}
      </div>
      {err && <p className="text-red-600">{err}</p>}
      {!d && !err && <p>Memuat…</p>}
      {d && (
        <>
          <h2 className="subheader pt-1">Field Activities</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label="Total visit" value={d.field.visits} sub="report yang sudah disubmit, per rentang" />
            <Tile label="GPS Verified" value={d.field.verified} sub={`${d.field.unverified} Unverified`} tone={d.field.unverified > 0 ? "warn" : "good"} />
            <Tile label="Perlu review" value={d.field.awaitingReview} sub={`${d.field.needsRevision} menunggu revisi`} tone={d.field.awaitingReview > 0 ? "warn" : undefined} href="/?status=SUBMITTED" />
            <Tile label="Follow-up terbuka" value={d.field.tasks.open} sub={`${d.field.tasks.doneInRange} selesai di rentang`} />
            <Tile label="Follow-up terlambat" value={d.field.tasks.overdue} tone={d.field.tasks.overdue > 0 ? "warn" : "good"} />
          </div>
          <div className="card space-y-2"><b className="text-sm">Visit per marketing</b>
            <Bars rows={d.field.perMarketing.map((m: any) => ({ label: m.name, value: m.visits, note: `${m.verified} verified` }))} /></div>
          <div className="card space-y-2"><b className="text-sm">Visit per jenis aktivitas</b>
            <Bars rows={d.field.byType.map((t: any) => ({ label: ACTIVITY_TYPES[t.type] ?? t.type, value: t.n }))} /></div>

          <h2 className="subheader pt-1">Lead &amp; Penawaran</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile label="Lead baru" value={d.leads.created} sub={`${d.leads.byKind.INTERNET} internet · ${d.leads.byKind.NON_INTERNET} non-internet`} href="/leads" />
            <Tile label="Won / Lost" value={`${d.leads.won} / ${d.leads.lost}`} sub={d.leads.winRate == null ? "belum ada yang ditutup" : `win rate ${d.leads.winRate}%`} tone={d.leads.won > 0 ? "good" : undefined} />
            <Tile label="Lead terbuka" value={d.leads.open} sub={d.leads.cohortConversion == null ? undefined : `konversi lead baru → Won ${d.leads.cohortConversion}%`} />
            <Tile label="Nilai penawaran berjalan" value={rupiah(d.quotations.pipelineValue)} sub="disetujui + terkirim" href="/quotations" />
            <Tile label="Nilai diterima" value={rupiah(d.quotations.acceptedValue)} sub={`${d.quotations.acceptedCount} penawaran di rentang`} tone={d.quotations.acceptedCount > 0 ? "good" : undefined} />
            <Tile label="Menunggu persetujuan" value={d.quotations.awaitingApproval} tone={d.quotations.awaitingApproval > 0 ? "warn" : undefined} href="/quotations" />
          </div>
          <div className="card space-y-2"><b className="text-sm">Lead baru menurut tahap saat ini</b>
            <Bars rows={Object.entries(d.leads.byStage).map(([s, n]) => ({ label: STAGE[s] ?? s, value: n as number }))} /></div>
          <div className="card space-y-2"><b className="text-sm">Penawaran dibuat menurut status</b>
            <Bars rows={Object.entries(d.quotations.byStatus).map(([s, n]) => ({ label: QSTATUS[s] ?? s, value: n as number }))} /></div>
          <WoSync />
          <p className="text-xs text-slate-500">Belum tersedia: Area Prospect, Partnership Opportunity, Estimated Potential MRR, dan konversi canvassing → lead (belum ada datanya di CRM).</p>
        </>
      )}
    </div>
  );
}
