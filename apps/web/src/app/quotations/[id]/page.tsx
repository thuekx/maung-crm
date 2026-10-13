"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import QuoteEditor from "@/components/QuoteEditor";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Section } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { QSTATUS, qTone, rupiah } from "@/lib/money";

type Act = { key: string; label: string; cls?: string; note?: "wajib" };

export default function QuotationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [q, setQ] = useState<any>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [ask, setAsk] = useState<Act | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setQ(await api(`/quotations/${id}`)); } catch (e: any) { setMsg(e.message); }
  }, [id]);
  const loadCatalog = useCallback(async () => { const c = await api("/catalog"); setCatalog(c); return c; }, []);
  useEffect(() => {
    load(); loadCatalog().catch(() => {}); api("/me").then(setMe).catch(() => {});
    api("/quotations/options").then((o) => setBanks(o.bankAccounts ?? [])).catch(() => {});
  }, [load, loadCatalog]);
  if (!q) return <p>{msg || "Memuat…"}</p>;

  const reviewer = !!me?.reviewer;
  const run = async (a: Act, n?: string) => {
    setBusy(true); setMsg("");
    try { await api(`/quotations/${id}/${a.key}`, { method: "POST", json: n ? { note: n } : {} }); setAsk(null); setNote(""); await load(); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const go = (a: Act) => (a.note ? setAsk(a) : run(a));

  const acts: Act[] = [];
  const s = q.status;
  if (s === "PENDING_APPROVAL" && reviewer) acts.push({ key: "approve", label: "Setujui", cls: "btn" }, { key: "return", label: "Kembalikan ke draft", cls: "btn-ghost", note: "wajib" });
  if (s === "APPROVED") acts.push({ key: "send", label: "Tandai terkirim ke pelanggan", cls: "btn" });
  if (s === "SENT") acts.push({ key: "accept", label: "Pelanggan menyetujui", cls: "btn" }, { key: "reject", label: "Pelanggan menolak", cls: "btn-ghost", note: "wajib" });
  if (["APPROVED", "SENT", "REJECTED", "EXPIRED"].includes(s)) acts.push({ key: "revise", label: "Buat revisi", cls: "btn-ghost", note: "wajib" });
  if (["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(s)) acts.push({ key: "cancel", label: "Batalkan", cls: "btn-danger", note: "wajib" });

  return (
    <div className="space-y-3">
      <Link href="/quotations" className="btn-link"><Icon name="chevronLeft" size={16} />Semua penawaran</Link>
      <div className="card hero rise space-y-3 !border-0 text-white">
        <div className="flex items-start gap-3">
          <Avatar name={q.customerName} size={48} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold leading-6">{q.number}{q.rev > 1 ? ` · rev ${q.rev}` : ""}</h1>
            <div className="text-sm text-white/80">{q.customerName}{q.subject ? ` — ${q.subject}` : ""}</div>
          </div>
          <Badge tone={qTone(s)} dot>{QSTATUS[s]}</Badge>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="font-display text-3xl font-semibold">{rupiah(q.total)}</div>
          <Link className="btn" href={`/quotations/${q.id}/print`}><Icon name="print" size={16} />Cetak / PDF</Link>
        </div>
        <div className="space-y-0.5 text-xs text-white/70">
          <div>Marketing: {q.marketingName} ({q.marketingUserId}) · dibuat oleh {q.createdByName}{q.validUntil ? ` · berlaku s.d. ${q.validUntil}` : ""}</div>
          {q.lead && <Link className="inline-flex items-center gap-1 text-white underline" href={`/leads/${q.lead.id}`}><Icon name="target" size={12} />Lead: {q.lead.name}</Link>}
        </div>
        {q.decisionNote && <p className="rounded-xl bg-white/10 p-2.5 text-sm">Catatan keputusan: {q.decisionNote}</p>}
        {s === "ACCEPTED" && <p className="rounded-xl bg-green-500/20 p-2.5 text-xs text-green-100">Terkunci. Penawaran ini menjadi dasar pekerjaan; perubahan lingkup = penawaran baru.</p>}
      </div>

      {q.wo && (
        <Section icon="sync" title="Sinkron ke WO">
          {q.wo.syncedAt ? (
            <p className="text-slate-600">Tersinkron: {q.wo.syncedStatus} (rev {q.wo.syncedRev}) · {fmtDate(q.wo.syncedAt)}</p>
          ) : <p className="text-slate-500">{["SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(s) ? "Menunggu dikirim ke WO." : "Belum dikirim ke WO (dikirim saat status Terkirim)."}</p>}
          {q.wo.woNumber && <p className="flex items-center gap-2 text-sm"><Badge tone="green" dot>Order di WO</Badge><b className="text-brand-900 dark:text-white">{q.wo.woNumber}</b><span className="text-xs text-slate-500">— lanjutan pekerjaan (sumber barang, jadwal, BA) dikerjakan di WO</span></p>}
          {s === "ACCEPTED" && q.wo.syncedAt && !q.wo.woNumber && <p className="text-xs text-amber-700">Penawaran WON sudah terkirim tetapi WO belum membentuk order — dikirim ulang otomatis; bila tetap kosong, hubungi admin WO.</p>}
          {q.wo.warnings?.error && <p className="text-red-600">Ditolak WO: {q.wo.warnings.error}</p>}
          {q.wo.warnings?.marketingMatched === false && <p className="text-xs text-amber-700">Marketing {q.marketingName} tidak dikenali sebagai pengguna MKT aktif di WO — nama &amp; id tetap tersimpan apa adanya.</p>}
        </Section>
      )}

      {s === "DRAFT" ? <QuoteEditor key={q.updatedAt} q={q} catalog={catalog} banks={banks} onSaved={load} onCatalog={loadCatalog} /> : (
        <Section icon="list" title="Rincian">
          {q.lines.map((l: any) => (
            <div key={l.id} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
              <span>{l.name} <span className="text-xs text-slate-500">× {l.qty} {l.unit} @ {rupiah(l.unitPrice)}</span>{l.note && <span className="block text-xs text-slate-500">{l.note}</span>}</span>
              <span>{rupiah(l.qty * l.unitPrice)}</span>
            </div>
          ))}
          <div className="flex justify-between"><span>Subtotal</span><span>{rupiah(q.subtotal)}</span></div>
          {q.discount > 0 && <div className="flex justify-between"><span>Diskon</span><span>- {rupiah(q.discount)}</span></div>}
          <div className="flex justify-between"><span>PPN {q.taxRate}%</span><span>{rupiah(q.taxAmount)}</span></div>
          <div className="flex justify-between font-semibold"><span>Total</span><span>{rupiah(q.total)}</span></div>
          {q.approvedByName && <p className="text-xs text-slate-500">Disetujui oleh {q.approvedByName}{q.approvedAt ? `, ${fmtDate(q.approvedAt)}` : ""}</p>}
        </Section>
      )}

      {acts.length > 0 && (
        <div className="card space-y-2">
          <div className="flex flex-wrap gap-2">{acts.map((a) => <button key={a.key} className={a.cls} disabled={busy} onClick={() => go(a)}>{a.label}</button>)}</div>
          {ask && (
            <div className="flex gap-2">
              <input className="input" placeholder={ask.key === "revise" ? "Alasan revisi (wajib)" : "Alasan/catatan (wajib)"} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn" disabled={busy || !note.trim()} onClick={() => run(ask, note.trim())}>Kirim</button>
              <button className="btn-ghost" onClick={() => { setAsk(null); setNote(""); }}>Batal</button>
            </div>
          )}
        </div>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {q.revisions.length > 0 && (
        <div className="card space-y-1 text-sm"><b>Riwayat revisi</b>
          <p className="text-xs text-slate-500">Isi tiap revisi lama tersimpan apa adanya dan hanya bisa dibuka (tidak bisa diubah).</p>
          {q.revisions.map((r: any) => (
            <Link key={r.rev} href={`/quotations/${q.id}/print?rev=${r.rev}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5">
              <span><b>{r.rev === 1 ? "Awal (rev 1)" : `Rev ${r.rev}`}</b> · {rupiah(r.total)} · diganti {fmtDate(r.at)} oleh {r.actorName}{r.reason ? ` — alasan: ${r.reason}` : ""}</span>
              <span className="shrink-0 text-brand-700 underline dark:text-white">Buka</span>
            </Link>
          ))}
          <div className="px-2 text-xs text-slate-500">Rev {q.rev} = versi saat ini (di atas).</div></div>
      )}
      <div className="card space-y-1 text-sm"><b>Riwayat</b>
        <ul className="space-y-1">{[...q.events].reverse().map((e: any) => (
          <li key={e.id} className="text-xs text-slate-600"><span className="text-slate-500">{fmtDate(e.at)}</span> · {e.actorName ?? "otomatis"} · {e.type === "STATUS" || e.type === "REVISION" ? `${QSTATUS[e.fromStatus] ?? e.fromStatus} → ${QSTATUS[e.toStatus] ?? e.toStatus}` : e.type === "CREATED" ? "dibuat" : "diubah"}{e.note ? ` — ${e.note}` : ""}</li>
        ))}</ul></div>
    </div>
  );
}
