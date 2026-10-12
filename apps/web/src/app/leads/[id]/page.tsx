"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import LeadForm from "@/components/LeadForm";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Section } from "@/components/ui";
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
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="font-display text-xl font-semibold">Ubah Lead</h1>
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
  const line = (icon: any, text: React.ReactNode) => text ? <div className="flex items-start gap-2 text-sm"><Icon name={icon} size={15} className="mt-0.5 shrink-0 text-slate-400" /><span className="min-w-0 break-words">{text}</span></div> : null;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/leads" className="btn-link"><Icon name="chevronLeft" size={16} />Semua lead</Link>
      <div className="card hero rise space-y-3 !border-0 text-white">
        <div className="flex items-start gap-3">
          <Avatar name={l.name} size={52} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold leading-6">{l.name}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone={stageTone(l.stage)} dot>{STAGE[l.stage] ?? l.stage}</Badge>
              <Badge tone="blue"><Icon name={l.kind === "INTERNET" ? "wifi" : "box"} size={11} />{KIND[l.kind]}</Badge>
            </div>
          </div>
          {open && <button className="rounded-lg bg-white/10 p-2 hover:bg-white/20" onClick={() => setEdit(true)} aria-label="Ubah lead" title="Ubah"><Icon name="edit" size={17} /></button>}
        </div>
        <div className="grid gap-1.5 text-white/90 [&_svg]:!text-white/60">
          {line("phone", <>{l.phone}{l.phoneNorm ? <span className="text-xs text-white/60"> · +{l.phoneNorm}</span> : <span className="text-xs text-amber-300"> · nomor tidak valid</span>}</>)}
          {line("home", [l.address, l.area].filter(Boolean).join(" · "))}
          {line("tag", l.interest && <>Minat: <b>{l.interest}</b></>)}
          {line("user", <>Pemilik: {l.ownerName} <span className="text-xs text-white/60">· dibuat oleh {l.createdByName}</span></>)}
        </div>
        {l.notes && <p className="whitespace-pre-wrap rounded-xl bg-white/10 p-2.5 text-sm">{l.notes}</p>}
        {l.lostReason && <p className="rounded-xl bg-red-500/20 p-2.5 text-sm text-red-100">Alasan Lost: {l.lostReason}{l.lostAuto ? " (otomatis)" : ""}</p>}
      </div>

      <Section icon="link" title="Pelanggan di WO">
        {l.customer ? (
          <>
            <div className="flex items-center gap-3"><Avatar name={l.customer.name} size={38} />
              <div className="min-w-0 text-sm"><b className="text-brand-900 dark:text-white">{l.customer.name}</b> <span className="text-slate-500">· {l.customer.code}</span>
                <div className="text-xs text-slate-500">{CUST_STATUS[l.customer.status] ?? l.customer.status}{l.customer.packageName ? ` · ${l.customer.packageName}` : ""}{l.customer.areaName ? ` · ${l.customer.areaName}` : ""}</div></div></div>
            <p className="text-xs text-slate-500">Tautan {l.linkState === "AUTO" ? "otomatis (nomor telepon cocok)" : "manual"}.{l.kind === "INTERNET" ? " Tahap lead mengikuti status pelanggan di WO." : " Layanan tambahan: status pelanggan di WO tidak diubah."}</p>
            {open && <button className="btn-ghost" disabled={busy} onClick={() => link(null)}>Lepas tautan</button>}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">Belum tertaut. {l.kind === "INTERNET" ? "Setelah pelanggan didaftarkan di MSRadius dan tersinkron ke WO, tautan dibuat otomatis lewat nomor telepon." : "Bila pelanggan sudah ada di WO, tautkan agar layanan tambahan masuk ke pelanggan yang sama."}</p>
            {open && cand && [...cand.exact.map((c: any) => ({ ...c, w: false })), ...cand.weak.map((c: any) => ({ ...c, w: true }))].map((c: any) => (
              <div key={c.code} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-white/10">
                <span className="min-w-0 text-sm">{c.name} <span className="text-xs text-slate-500">({c.code} · {CUST_STATUS[c.status] ?? c.status}){c.w ? " · kemungkinan (9 digit terakhir)" : ""}</span></span>
                <button className="btn-ghost shrink-0" disabled={busy} onClick={() => link(c.code)}>Tautkan</button>
              </div>
            ))}
          </>
        )}
      </Section>

      {open && (
        <Section icon="flag" title="Pindah tahap">
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
        </Section>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {l.kind === "NON_INTERNET" && (
        <Section icon="file" title="Penawaran">
          {quotes.length === 0 && <p className="text-sm text-slate-500">Belum ada penawaran.</p>}
          {quotes.map((x) => (
            <Link key={x.id} href={`/quotations/${x.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5 transition hover:border-accent-300 dark:border-white/10">
              <span className="text-sm"><b className="text-brand-900 dark:text-white">{x.number}{x.rev > 1 ? ` rev ${x.rev}` : ""}</b> <span className="text-xs text-slate-500">{rupiah(x.total)}</span></span>
              <Badge tone={qTone(x.status)} dot>{QSTATUS[x.status]}</Badge>
            </Link>
          ))}
          {open && <button className="btn" disabled={busy} onClick={() => run(async () => { const q = await api("/quotations", { method: "POST", json: { leadId: l.id } }); router.push(`/quotations/${q.id}`); })}><Icon name="plus" size={16} />Buat penawaran</button>}
        </Section>
      )}

      <Section icon="clock" title="Riwayat">
        <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-white/10">
          {[...l.events].reverse().map((e: any) => (
            <li key={e.id} className="text-xs text-slate-600 dark:text-slate-300">
              <span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-accent-500" />
              <div className="text-slate-500">{fmtDate(e.at)} · {e.actorName ?? "otomatis (sinkron WO)"}</div>
              <div>{e.type === "STAGE" ? `${STAGE[e.fromStage] ?? e.fromStage} → ${STAGE[e.toStage] ?? e.toStage}` : e.type === "CREATED" ? "Lead dibuat" : e.type === "LINKED" ? "Tertaut ke pelanggan" : e.type === "UNLINKED" ? "Tautan dilepas" : e.type === "OWNER" ? "Ganti pemilik" : "Diubah"}{e.note ? ` — ${e.note}` : ""}</div>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
