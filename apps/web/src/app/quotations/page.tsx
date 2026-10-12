"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api";
import { QSTATUS, qTone, rupiah } from "@/lib/money";

const FILTERS = [{ key: "open", label: "Berjalan", qs: "open=1" }, { key: "ACCEPTED", label: "Diterima", qs: "status=ACCEPTED" }, { key: "all", label: "Semua", qs: "" }];

export default function Quotations() {
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(FILTERS.find((x) => x.key === filter)!.qs);
      if (q.trim()) p.set("q", q.trim());
      api(`/quotations?${p}`).then((r) => { setRows(r); setErr(""); }).catch((e) => setErr(e.message));
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [filter, q]);
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Penawaran</h1>
      <p className="text-xs text-slate-500">Penawaran dibuat dari halaman Lead non-internet (tombol “Buat penawaran”).</p>
      <input className="input" placeholder="Cari nomor atau nama pelanggan" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-wrap gap-2">{FILTERS.map((f) => <button key={f.key} onClick={() => setFilter(f.key)} className={filter === f.key ? "menu-item menu-item-active" : "menu-item"}>{f.label}</button>)}</div>
      {err && <p className="text-red-600">{err}</p>}
      {!rows && !err && <p>Memuat…</p>}
      {rows?.length === 0 && <p className="text-slate-500">Belum ada penawaran.</p>}
      {rows?.map((x) => (
        <Link key={x.id} href={`/quotations/${x.id}`} className="card block text-sm">
          <div className="flex items-start justify-between gap-2"><b>{x.number}{x.rev > 1 ? ` rev ${x.rev}` : ""}</b><span className={`rounded px-2 py-0.5 text-xs ${qTone(x.status)}`}>{QSTATUS[x.status]}</span></div>
          <div>{x.customerName}{x.subject ? ` — ${x.subject}` : ""}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500"><span>{rupiah(x.total)}</span><span>{x.ownerName}</span>{x.validUntil && <span>berlaku s.d. {x.validUntil}</span>}<span>{fmtDate(x.updatedAt)}</span></div>
        </Link>
      ))}
    </div>
  );
}
