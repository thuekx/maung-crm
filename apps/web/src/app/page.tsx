"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Chips, Empty, PageHeader, type Tone } from "@/components/ui";
import { ACTIVITY_TYPES, api, fmtDate } from "@/lib/api";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "slate" }, SUBMITTED: { label: "Perlu review", tone: "amber" }, REVIEWED: { label: "Reviewed", tone: "blue" },
  REVISION_REQUIRED: { label: "Revisi", tone: "red" }, COMPLETED: { label: "Completed", tone: "green" },
};
const FILTERS = [["", "Semua"], ["SUBMITTED", "Perlu review"], ["REVISION_REQUIRED", "Revisi"], ["REVIEWED", "Reviewed"], ["COMPLETED", "Completed"], ["DRAFT", "Draft"]] as const;

function History() {
  const status = useSearchParams().get("status") ?? "";
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    setRows(null);
    api(`/reports${status ? `?status=${status}` : ""}`).then(setRows).catch((e) => setErr(e.message));
    api("/tasks").then(setTasks).catch(() => {});
  }, [status]);
  const overdue = tasks.filter((t) => t.overdue);
  return (
    <div className="space-y-4">
      <PageHeader icon="clipboard" title="Aktivitas Lapangan" subtitle="Riwayat report canvassing, meeting, dan survey"
        action={<Link href="/new" className="btn hidden sm:inline-flex"><Icon name="plus" size={16} />Report Baru</Link>} />
      {overdue.length > 0 && (
        <div className="rise flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert" size={20} /><span><b>{overdue.length} follow-up terlambat.</b> Selesaikan atau jadwalkan ulang.</span>
        </div>
      )}
      <Chips value={status} onChange={(k) => router.push(k ? `/?status=${k}` : "/")}
        options={FILTERS.map(([k, l]) => ({ key: k, label: l }))} />
      {err && <p className="text-red-600">{err}</p>}
      {!rows && !err && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-white/5" />)}</div>}
      {rows?.length === 0 && <Empty icon="clipboard" title="Belum ada report" text="Catat kunjungan pertama Anda lengkap dengan foto dan GPS." href="/new" cta="Buat report" />}
      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((r) => {
          const st = STATUS[r.status] ?? { label: r.status, tone: "slate" as Tone };
          return (
            <Link key={r.id} href={`/reports/${r.id}`} className="list-card rise">
              <div className="flex items-start gap-3">
                <Avatar name={String(r.pics ?? "?").split(",")[0]} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <b className="truncate text-sm text-brand-900 dark:text-white">{ACTIVITY_TYPES[r.activityType]}{r.area ? ` · ${r.area}` : ""}</b>
                    <Badge tone={st.tone} dot>{st.label}</Badge>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{r.accountName ? `${r.accountName} · ` : ""}{r.pics}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Icon name="calendar" size={13} />{fmtDate(r.activityAt)}</span>
                    <span className="inline-flex items-center gap-1"><Icon name="camera" size={13} />{r.photoCount}</span>
                    {r.locationStatus === "VERIFIED"
                      ? <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><Icon name="shield" size={13} />GPS Verified</span>
                      : <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><Icon name="pin" size={13} />Unverified</span>}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <Link href="/new" className="fab sm:hidden" aria-label="Report baru"><Icon name="plus" size={26} /></Link>
    </div>
  );
}

export default function Page() { return <Suspense fallback={<p>Memuat…</p>}><History /></Suspense>; }
