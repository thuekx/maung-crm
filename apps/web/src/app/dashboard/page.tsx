"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Section, Stat } from "@/components/ui";
import { ACTIVITY_TYPES, api } from "@/lib/api";
import { STAGE } from "@/lib/leads";
import { QSTATUS, rupiah } from "@/lib/money";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const fmtShort = (s: string) => new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });

function Bars({ rows, fmt = (n: number) => String(n) }: { rows: { label: string; value: number; note?: string }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-slate-500">Tidak ada data pada rentang ini.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="shrink-0 font-semibold text-brand-900 dark:text-white">{fmt(r.value)}{r.note ? <span className="text-xs font-normal text-slate-500"> · {r.note}</span> : null}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10" role="presentation"><div className="h-full rounded-full bg-gradient-to-r from-accent-400 to-accent-600 transition-all" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /></div>
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
    <Section icon="sync" title="Kirim ke WO" aside={<span className={`badge ${!st.enabled ? "badge-amber" : st.blocked ? "badge-red" : "badge-green"}`}>{!st.enabled ? "nonaktif" : st.blocked ? `${st.blocked} ditolak` : "normal"}</span>}>
      <p className={`text-sm ${st.enabled ? "text-slate-600 dark:text-slate-300" : "text-amber-700 dark:text-amber-400"}`}>
        {st.enabled ? `Menunggu ${st.pending} · ditolak WO ${st.blocked}` : st.keySet ? "Dimatikan (WO_SYNC_ENABLED=0)." : "Kunci integrasi belum diisi di server."}
      </p>
      {st.problems.map((p: any) => (
        <div key={p.id} className="rounded-xl border border-slate-200 p-2.5 text-xs dark:border-white/10">
          <div><b>{p.kind === "CATALOG" ? "Katalog" : "Penawaran"}</b> {p.crmId} · {p.status === "BLOCKED" ? "DITOLAK" : `percobaan ${p.attempts}`}</div>
          <div className="text-red-700 dark:text-red-400">{p.lastError}</div>
          {p.status === "BLOCKED" && <button className="btn-ghost mt-1.5" onClick={() => retry(p.id)}>Coba lagi (setelah data diperbaiki)</button>}
        </div>
      ))}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </Section>
  );
}

export default function Dashboard() {
  const [f, setF] = useState({ from: daysAgo(29), to: iso(new Date()), marketing: "", area: "" });
  const [d, setD] = useState<any>(null);
  const [me, setMe] = useState<any>(null);
  const [err, setErr] = useState("");
  const [show, setShow] = useState(false);
  useEffect(() => { api("/me").then(setMe).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
      api(`/dashboard?${p}`).then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message));
    }, f.area ? 400 : 0);
    return () => clearTimeout(t);
  }, [f]);

  const preset = (n: number) => setF((x) => ({ ...x, from: daysAgo(n - 1), to: iso(new Date()) }));
  const hour = new Date().getHours();
  const hello = hour < 11 ? "Selamat pagi" : hour < 15 ? "Selamat siang" : hour < 18 ? "Selamat sore" : "Selamat malam";
  const firstName = String(me?.name ?? "").split(" ")[0];
  const attention = d ? [
    d.field.awaitingReview > 0 && { icon: "clipboard" as const, text: `${d.field.awaitingReview} report menunggu review`, href: "/?status=SUBMITTED" },
    d.field.tasks.overdue > 0 && { icon: "alert" as const, text: `${d.field.tasks.overdue} follow-up terlambat`, href: "/" },
    d.quotations.awaitingApproval > 0 && { icon: "file" as const, text: `${d.quotations.awaitingApproval} penawaran menunggu persetujuan`, href: "/quotations" },
  ].filter(Boolean) as { icon: any; text: string; href: string }[] : [];

  return (
    <div className="space-y-4">
      <div className="hero rise relative overflow-hidden rounded-2xl p-5 text-white shadow-card">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent-500/20 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-white/70">{hello}{firstName ? "," : ""}</p>
            <h1 className="font-display text-2xl font-semibold">{firstName || "Dashboard"}</h1>
            {d?.hasDemo && <p className="mt-1 inline-flex rounded-full bg-accent-500/20 px-2 py-0.5 text-[11px] font-semibold text-accent-300">Data demo ikut dihitung</p>}
            {d && <p className="mt-1 text-xs text-white/70">{fmtShort(d.range.from)} – {fmtShort(d.range.to)}{d.scope === "marketing" && !d.people?.length ? " · data Anda" : ""}</p>}
          </div>
          <button className="rounded-xl bg-white/10 p-2.5 transition hover:bg-white/20" onClick={() => setShow(!show)} aria-label="Filter" aria-expanded={show}><Icon name="settings" size={18} /></button>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2">
          <Link href="/new" className="btn"><Icon name="plus" size={16} />Report baru</Link>
          <Link href="/leads/new" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold transition hover:bg-white/20"><Icon name="target" size={16} />Lead baru</Link>
        </div>
      </div>

      {show && (
        <div className="card rise space-y-3">
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
          <div className="flex gap-2">{[7, 30, 90].map((n) => <button key={n} className="chip" onClick={() => preset(n)}>{n} hari</button>)}</div>
        </div>
      )}
      {err && <p className="text-red-600">{err}</p>}
      {!d && !err && <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-white/5" />)}</div>}
      {d && (
        <>
          {attention.length > 0 && (
            <div className="rise rounded-2xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-400/30 dark:bg-amber-500/10">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300"><Icon name="sparkle" size={16} />Perlu perhatian</div>
              <ul className="space-y-1">{attention.map((a) => (
                <li key={a.text}><Link href={a.href} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-white/5"><span className="inline-flex items-center gap-2"><Icon name={a.icon} size={15} />{a.text}</span><Icon name="chevronRight" size={15} /></Link></li>
              ))}</ul>
            </div>
          )}

          <h2 className="subheader pt-1">Field Activities</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon="clipboard" tone="accent" label="Total visit" value={d.field.visits} sub="report tersubmit" />
            <Stat icon="shield" tone={d.field.unverified > 0 ? "amber" : "green"} label="GPS Verified" value={d.field.verified} sub={`${d.field.unverified} Unverified`} />
            <Stat icon="check" tone="blue" label="Follow-up terbuka" value={d.field.tasks.open} sub={`${d.field.tasks.doneInRange} selesai`} />
            <Stat icon="alert" tone={d.field.tasks.overdue > 0 ? "red" : "green"} label="Terlambat" value={d.field.tasks.overdue} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Section icon="users" title="Visit per marketing"><Bars rows={d.field.perMarketing.map((m: any) => ({ label: m.name, value: m.visits, note: `${m.verified} verified` }))} /></Section>
            <Section icon="layers" title="Per jenis aktivitas"><Bars rows={d.field.byType.map((t: any) => ({ label: ACTIVITY_TYPES[t.type] ?? t.type, value: t.n }))} /></Section>
          </div>

          <h2 className="subheader pt-1">Lead &amp; Penawaran</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat icon="target" tone="accent" label="Lead baru" value={d.leads.created} sub={`${d.leads.byKind.INTERNET} internet · ${d.leads.byKind.NON_INTERNET} non-internet`} href="/leads" />
            <Stat icon="trend" tone={d.leads.won > 0 ? "green" : "blue"} label="Won / Lost" value={`${d.leads.won} / ${d.leads.lost}`} sub={d.leads.winRate == null ? "belum ada yang ditutup" : `win rate ${d.leads.winRate}%`} />
            <Stat icon="inbox" tone="blue" label="Lead terbuka" value={d.leads.open} sub={d.leads.cohortConversion == null ? undefined : `konversi → Won ${d.leads.cohortConversion}%`} />
            <Stat icon="money" tone="blue" label="Penawaran berjalan" value={rupiah(d.quotations.pipelineValue)} sub="disetujui + terkirim" href="/quotations" />
            <Stat icon="check" tone={d.quotations.acceptedCount > 0 ? "green" : "blue"} label="Nilai diterima" value={rupiah(d.quotations.acceptedValue)} sub={`${d.quotations.acceptedCount} penawaran`} />
            <Stat icon="file" tone={d.quotations.awaitingApproval > 0 ? "amber" : "blue"} label="Menunggu persetujuan" value={d.quotations.awaitingApproval} href="/quotations" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Section icon="flag" title="Lead baru menurut tahap"><Bars rows={Object.entries(d.leads.byStage).map(([s, n]) => ({ label: STAGE[s] ?? s, value: n as number }))} /></Section>
            <Section icon="file" title="Penawaran menurut status"><Bars rows={Object.entries(d.quotations.byStatus).map(([s, n]) => ({ label: QSTATUS[s] ?? s, value: n as number }))} /></Section>
          </div>
          <WoSync />
          <p className="text-xs text-slate-500">Belum tersedia: Area Prospect, Partnership Opportunity, Estimated Potential MRR, dan konversi canvassing → lead (belum ada datanya di CRM).</p>
        </>
      )}
    </div>
  );
}
