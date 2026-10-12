"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Chips, Empty, PageHeader, SearchField } from "@/components/ui";
import { api } from "@/lib/api";
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
    <div className="space-y-4">
      <PageHeader icon="file" title="Penawaran" subtitle="Dibuat dari lead non-internet · berkop surat WO"
        action={<Link href="/catalog" className="btn-ghost"><Icon name="tag" size={16} />Katalog</Link>} />
      <SearchField value={q} onChange={setQ} placeholder="Cari nomor atau nama pelanggan" />
      <Chips value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ key: f.key, label: f.label }))} />
      {err && <p className="text-red-600">{err}</p>}
      {!rows && !err && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-white/5" />)}</div>}
      {rows?.length === 0 && <Empty icon="file" title="Belum ada penawaran" text="Buka sebuah lead non-internet lalu pilih “Buat penawaran”." href="/leads" cta="Ke daftar lead" />}
      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((x) => (
          <Link key={x.id} href={`/quotations/${x.id}`} className="list-card rise">
            <div className="flex items-start gap-3">
              <Avatar name={x.customerName} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <b className="truncate text-sm text-brand-900 dark:text-white">{x.number}{x.rev > 1 ? ` · rev ${x.rev}` : ""}</b>
                  <Badge tone={qTone(x.status)} dot>{QSTATUS[x.status]}</Badge>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{x.customerName}{x.subject ? ` — ${x.subject}` : ""}</div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-base font-semibold text-brand-900 dark:text-white">{rupiah(x.total)}</span>
                  <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Icon name="user" size={13} />{x.ownerName}</span>
                    {x.validUntil && <span className="inline-flex items-center gap-1"><Icon name="clock" size={13} />s.d. {x.validUntil}</span>}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
