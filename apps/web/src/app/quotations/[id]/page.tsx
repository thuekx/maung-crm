"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import QuoteEditor from "@/components/QuoteEditor";
import { api, fmtDate } from "@/lib/api";
import { QSTATUS, qTone, rupiah } from "@/lib/money";

type Act = { key: string; label: string; cls?: string; note?: "wajib" };

export default function QuotationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [q, setQ] = useState<any>(null);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [me, setMe] = useState<any>(null);
  const [ask, setAsk] = useState<Act | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setQ(await api(`/quotations/${id}`)); } catch (e: any) { setMsg(e.message); }
  }, [id]);
  useEffect(() => { load(); api("/catalog").then(setCatalog).catch(() => {}); api("/me").then(setMe).catch(() => {}); }, [load]);
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
  if (s === "DRAFT") acts.push({ key: "submit", label: "Ajukan untuk persetujuan", cls: "btn" });
  if (s === "PENDING_APPROVAL" && reviewer) acts.push({ key: "approve", label: "Setujui", cls: "btn" }, { key: "return", label: "Kembalikan ke draft", cls: "btn-ghost", note: "wajib" });
  if (s === "APPROVED") acts.push({ key: "send", label: "Tandai terkirim ke pelanggan", cls: "btn" });
  if (s === "SENT") acts.push({ key: "accept", label: "Pelanggan menyetujui", cls: "btn" }, { key: "reject", label: "Pelanggan menolak", cls: "btn-ghost", note: "wajib" });
  if (["APPROVED", "SENT", "REJECTED", "EXPIRED"].includes(s)) acts.push({ key: "revise", label: "Buat revisi", cls: "btn-ghost", note: "wajib" });
  if (["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT"].includes(s)) acts.push({ key: "cancel", label: "Batalkan", cls: "btn-danger", note: "wajib" });

  return (
    <div className="space-y-3">
      <div className="card space-y-1 text-sm">
        <div className="flex items-start justify-between gap-2">
          <b className="text-base">{q.number}{q.rev > 1 ? ` · rev ${q.rev}` : ""}</b>
          <span className={`rounded px-2 py-0.5 text-xs ${qTone(s)}`}>{QSTATUS[s]}</span>
        </div>
        <div>{q.customerName}{q.subject ? ` — ${q.subject}` : ""}</div>
        <div className="text-slate-500">Pemilik: {q.ownerName}{q.validUntil ? ` · berlaku s.d. ${q.validUntil}` : ""}</div>
        {q.lead && <div className="text-xs"><Link className="btn-link" href={`/leads/${q.lead.id}`}>Lead: {q.lead.name}</Link></div>}
        {q.decisionNote && <p className="text-slate-600">Catatan keputusan: {q.decisionNote}</p>}
        {s === "ACCEPTED" && <p className="text-xs text-green-700">Terkunci. Penawaran ini menjadi dasar pekerjaan; perubahan lingkup = penawaran baru.</p>}
        <div className="pt-1"><Link className="btn-secondary" href={`/quotations/${q.id}/print`}>🖨 Cetak / PDF (kop surat)</Link></div>
      </div>

      {s === "DRAFT" ? <QuoteEditor key={q.updatedAt} q={q} catalog={catalog} onSaved={load} /> : (
        <div className="card space-y-2 text-sm">
          <b>Rincian</b>
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
        </div>
      )}

      {acts.length > 0 && (
        <div className="card space-y-2">
          <div className="flex flex-wrap gap-2">{acts.map((a) => <button key={a.key} className={a.cls} disabled={busy} onClick={() => go(a)}>{a.label}</button>)}</div>
          {s === "DRAFT" && <p className="text-xs text-slate-500">Simpan draft dulu sebelum mengajukan.</p>}
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
        <div className="card space-y-1 text-sm"><b>Revisi sebelumnya</b>
          {q.revisions.map((r: any) => <div key={r.rev} className="text-xs text-slate-600">rev {r.rev} · {fmtDate(r.at)} · {r.actorName} · {rupiah(r.total)} · {r.reason}</div>)}</div>
      )}
      <div className="card space-y-1 text-sm"><b>Riwayat</b>
        <ul className="space-y-1">{[...q.events].reverse().map((e: any) => (
          <li key={e.id} className="text-xs text-slate-600"><span className="text-slate-500">{fmtDate(e.at)}</span> · {e.actorName ?? "otomatis"} · {e.type === "STATUS" || e.type === "REVISION" ? `${QSTATUS[e.fromStatus] ?? e.fromStatus} → ${QSTATUS[e.toStatus] ?? e.toStatus}` : e.type === "CREATED" ? "dibuat" : "diubah"}{e.note ? ` — ${e.note}` : ""}</li>
        ))}</ul></div>
    </div>
  );
}
