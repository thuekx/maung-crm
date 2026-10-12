"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api";
import { KIND, STAGE, stageTone } from "@/lib/leads";

const FILTERS: { key: string; label: string; qs: string }[] = [
  { key: "open", label: "Terbuka", qs: "open=1" },
  { key: "WON", label: "Won", qs: "stage=WON" },
  { key: "LOST", label: "Lost", qs: "stage=LOST" },
  { key: "all", label: "Semua", qs: "" },
];

export default function Leads() {
  const [filter, setFilter] = useState("open");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(FILTERS.find((x) => x.key === filter)!.qs);
      if (kind) p.set("kind", kind);
      if (q.trim()) p.set("q", q.trim());
      api(`/leads?${p}`).then((r) => { setRows(r); setErr(""); }).catch((e) => setErr(e.message));
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [filter, kind, q]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Lead</h1>
        <Link href="/leads/new" className="btn">+ Lead Baru</Link>
      </div>
      <input className="input" placeholder="Cari nama, minat, atau nomor telepon (format apa pun)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={filter === f.key ? "menu-item menu-item-active" : "menu-item"}>{f.label}</button>
        ))}
        <select className="input w-auto" aria-label="Jenis" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Semua jenis</option>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {err && <p className="text-red-600">{err}</p>}
      {!rows && !err && <p>Memuat…</p>}
      {rows?.length === 0 && <p className="text-slate-500">Belum ada lead.</p>}
      {rows?.map((l) => (
        <Link key={l.id} href={`/leads/${l.id}`} className="card block">
          <div className="flex items-start justify-between gap-2 text-sm">
            <b>{l.name}</b>
            <span className={`rounded px-2 py-0.5 text-xs ${stageTone(l.stage)}`}>{STAGE[l.stage] ?? l.stage}</span>
          </div>
          <div className="text-xs text-slate-500">{l.phone} · {l.interest ?? "—"}{l.area ? ` · ${l.area}` : ""}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
            <span>{l.kind === "INTERNET" ? "Internet" : "Non-internet"}</span>
            <span>{l.ownerName}</span>
            <span>{fmtDate(l.updatedAt)}</span>
            {l.customerCode && <span>🔗 {l.customerCode}{l.linkState === "AUTO" ? " (otomatis)" : ""}</span>}
            {l.existingCustomer && <span className="text-amber-700">sudah pelanggan</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
