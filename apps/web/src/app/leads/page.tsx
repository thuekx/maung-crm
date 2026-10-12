"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Chips, Empty, PageHeader, SearchField, type Tone } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { STAGE } from "@/lib/leads";

const FILTERS = [{ key: "open", label: "Terbuka", qs: "open=1" }, { key: "WON", label: "Won", qs: "stage=WON" }, { key: "LOST", label: "Lost", qs: "stage=LOST" }, { key: "all", label: "Semua", qs: "" }];
const stageTone = (s: string): Tone => (s === "WON" ? "green" : s === "LOST" ? "red" : s === "NEW" ? "slate" : "amber");

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
    <div className="space-y-4">
      <PageHeader icon="target" title="Lead" subtitle="Calon pelanggan internet dan layanan tambahan"
        action={<Link href="/leads/new" className="btn hidden sm:inline-flex"><Icon name="plus" size={16} />Lead Baru</Link>} />
      <SearchField value={q} onChange={setQ} placeholder="Cari nama, minat, atau nomor telepon (format apa pun)" />
      <Chips value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ key: f.key, label: f.label }))} />
      <Chips value={kind} onChange={setKind} options={[{ key: "", label: "Semua jenis" }, { key: "INTERNET", label: "Internet", icon: "wifi" }, { key: "NON_INTERNET", label: "Non-internet", icon: "box" }]} />
      {err && <p className="text-red-600">{err}</p>}
      {!rows && !err && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-white/5" />)}</div>}
      {rows?.length === 0 && <Empty icon="target" title="Belum ada lead" text="Tambahkan calon pelanggan dari kunjungan atau rekomendasi." href="/leads/new" cta="Lead baru" />}
      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((l) => (
          <Link key={l.id} href={`/leads/${l.id}`} className="list-card rise">
            <div className="flex items-start gap-3">
              <Avatar name={l.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <b className="truncate text-sm text-brand-900 dark:text-white">{l.name}</b>
                  <Badge tone={stageTone(l.stage)} dot>{STAGE[l.stage] ?? l.stage}</Badge>
                </div>
                <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500"><Icon name={l.kind === "INTERNET" ? "wifi" : "box"} size={13} />{l.interest ?? (l.kind === "INTERNET" ? "Internet" : "Non-internet")}{l.area ? ` · ${l.area}` : ""}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><Icon name="phone" size={13} />{l.phone}</span>
                  <span className="inline-flex items-center gap-1"><Icon name="user" size={13} />{l.ownerName}</span>
                  <span>{fmtDate(l.updatedAt)}</span>
                  {l.customerCode && <span className="inline-flex items-center gap-1 text-brand-800 dark:text-accent-300"><Icon name="link" size={13} />{l.customerCode}</span>}
                  {l.existingCustomer && <Badge tone="amber">sudah pelanggan</Badge>}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
      <Link href="/leads/new" className="fab sm:hidden" aria-label="Lead baru"><Icon name="plus" size={26} /></Link>
    </div>
  );
}
