"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import LeadForm from "@/components/LeadForm";
import { api, fmtDate } from "@/lib/api";
import { CUST_STATUS, KIND, STAGE, stageTone } from "@/lib/leads";
import { QSTATUS, qTone, rupiah } from "@/lib/money";

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [l, setL] = useState<any>(null);
  const [cand, setCand] = useState<any>(null);
  const [edit, setEdit] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [quotes, setQuotes] = useState<any[]>([]);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const d = await api(`/leads/${id}`);
      setL(d);
      setCand(d.customerCode ? null : await api(`/leads/${id}/candidates`).catch(() => null));
      setQuotes(d.kind === "NON_INTERNET" ? await api(`/quotations?leadId=${id}`).catch(() => []) : []);
    } catch (e: any) { setMsg(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!l) return <p>{msg || "Memuat…"}</p>;

  const open = !["WON", "LOST"].includes(l.stage);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg("");
    try { await fn(); await load(); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const move = (stage: string, reason?: string) => run(() => api(`/leads/${id}/stage`, { method: "POST", json: { stage, reason } }));
  const link = (customerCode: string | null) => run(() => api(`/leads/${id}/link`, { method: "POST", json: { customerCode } }));

  if (edit) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Ubah Lead</h1>
        <LeadForm initial={{ name: l.name, phone: l.phone ?? "", email: l.email ?? "", address: l.address ?? "", area: l.area ?? "", interest: l.interest ?? "", source: l.source ?? "", notes: l.notes ?? "" }}
          submitLabel="Simpan perubahan" onSubmit={async (f) => {
            const { kind: _k, ...rest } = f;
            await api(`/leads/${id}`, { method: "PATCH", json: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v.trim()])) });
            setEdit(false); await load();
          }} />
        <button className="btn-ghost" onClick={() => setEdit(false)}>Batal</button>
      </div>
    );
  }
  const next = (l.manualStages as string[]).filter((s) => s !== l.stage && s !== "LOST" && (open || s !== "WON"));
  return (
    <div className="space-y-3">
      <div className="card space-y-1 text-sm">
        <div className="flex items-start justify-between gap-2">
          <b className="text-base">{l.name}</b>
          <span className={`rounded px-2 py-0.5 text-xs ${stageTone(l.stage)}`}>{STAGE[l.stage] ?? l.stage}</span>
        </div>
        <div className="text-slate-500">{KIND[l.kind]} · pemilik: {l.ownerName} · dibuat oleh {l.createdByName}</div>
        <div>{l.phone}{l.phoneNorm ? <span className="text-xs text-slate-500"> · E.164 +{l.phoneNorm}</span> : <span className="text-xs text-amber-700"> · nomor tidak valid</span>}</div>
        {l.email && <div>{l.email}</div>}
        {l.address && <div>{l.address}{l.area ? ` · ${l.area}` : ""}</div>}
        {!l.address && l.area && <div>{l.area}</div>}
        {l.interest && <div>Minat: <b>{l.interest}</b></div>}
        {l.source && <div className="text-slate-500">Sumber: {l.source}</div>}
        {l.notes && <p className="whitespace-pre-wrap">{l.notes}</p>}
        {l.lostReason && <p className="text-red-700">Alasan Lost: {l.lostReason}{l.lostAuto ? " (otomatis)" : ""}</p>}
        {open && <button className="btn-ghost mt-1" onClick={() => setEdit(true)}>Ubah</button>}
      </div>

      <div className="card space-y-2 text-sm">
        <b>Pelanggan di WO</b>
        {l.customer ? (
          <>
            <div>{l.customer.name} · <span className="text-slate-500">{l.customer.code}</span></div>
            <div className="text-slate-500">{CUST_STATUS[l.customer.status] ?? l.customer.status}{l.customer.packageName ? ` · ${l.customer.packageName}` : ""}{l.customer.areaName ? ` · ${l.customer.areaName}` : ""}</div>
            <div className="text-xs text-slate-500">Tautan {l.linkState === "AUTO" ? "otomatis (nomor telepon cocok)" : "manual"}.{l.kind === "INTERNET" ? " Tahap lead mengikuti status pelanggan di WO." : " Layanan tambahan: status pelanggan di WO tidak diubah."}</div>
            {open && <button className="btn-ghost" disabled={busy} onClick={() => link(null)}>Lepas tautan</button>}
          </>
        ) : (
          <>
            <p className="text-slate-500">Belum tertaut. {l.kind === "INTERNET" ? "Setelah pelanggan didaftarkan di MSRadius dan tersinkron ke WO, tautan dibuat otomatis lewat nomor telepon." : "Bila pelanggan sudah ada di WO, tautkan agar layanan tambahan masuk ke pelanggan yang sama."}</p>
            {open && cand && [...cand.exact.map((c: any) => ({ ...c, w: false })), ...cand.weak.map((c: any) => ({ ...c, w: true }))].map((c: any) => (
              <div key={c.code} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2">
                <span>{c.name} <span className="text-xs text-slate-500">({c.code} · {CUST_STATUS[c.status] ?? c.status}){c.w ? " · kemungkinan (9 digit terakhir)" : ""}</span></span>
                <button className="btn-ghost" disabled={busy} onClick={() => link(c.code)}>Tautkan</button>
              </div>
            ))}
          </>
        )}
      </div>

      {open && (
        <div className="card space-y-2 text-sm">
          <b>Pindah tahap</b>
          <div className="flex flex-wrap gap-2">
            {next.map((s) => <button key={s} className="btn-ghost" disabled={busy} onClick={() => move(s)}>{STAGE[s]}</button>)}
            <button className="btn-danger" disabled={busy} onClick={() => setAsking(true)}>Lost</button>
          </div>
          {l.kind === "INTERNET" && <p className="text-xs text-slate-500">Terdaftar, Instalasi, dan Won mengikuti status pelanggan di WO (otomatis).</p>}
          {asking && (
            <div className="flex gap-2">
              <input className="input" placeholder="Alasan Lost (wajib)" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
              <button className="btn-danger" disabled={busy || !lostReason.trim()} onClick={() => move("LOST", lostReason.trim()).then(() => setAsking(false))}>Tutup</button>
            </div>
          )}
        </div>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {l.kind === "NON_INTERNET" && (
        <div className="card space-y-2 text-sm">
          <b>Penawaran</b>
          {quotes.length === 0 && <p className="text-slate-500">Belum ada penawaran.</p>}
          {quotes.map((x) => (
            <Link key={x.id} href={`/quotations/${x.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2">
              <span><b>{x.number}{x.rev > 1 ? ` rev ${x.rev}` : ""}</b> <span className="text-xs text-slate-500">{rupiah(x.total)}</span></span>
              <span className={`rounded px-2 py-0.5 text-xs ${qTone(x.status)}`}>{QSTATUS[x.status]}</span>
            </Link>
          ))}
          {open && <button className="btn" disabled={busy} onClick={() => run(async () => { const q = await api("/quotations", { method: "POST", json: { leadId: l.id } }); router.push(`/quotations/${q.id}`); })}>+ Buat penawaran</button>}
        </div>
      )}

      <div className="card space-y-1 text-sm">
        <b>Riwayat</b>
        <ul className="space-y-1">
          {[...l.events].reverse().map((e: any) => (
            <li key={e.id} className="text-xs text-slate-600">
              <span className="text-slate-500">{fmtDate(e.at)}</span> · {e.actorName ?? "otomatis (sinkron WO)"} ·{" "}
              {e.type === "STAGE" ? `${STAGE[e.fromStage] ?? e.fromStage} → ${STAGE[e.toStage] ?? e.toStage}` : e.type === "CREATED" ? "dibuat" : e.type === "LINKED" ? "tertaut" : e.type === "UNLINKED" ? "tautan dilepas" : e.type === "OWNER" ? "ganti pemilik" : "diubah"}
              {e.note ? ` — ${e.note}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
