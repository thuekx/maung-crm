"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ACTIVITY_TYPES, api, fmtDate } from "@/lib/api";

const STATUS: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Submitted", REVIEWED: "Reviewed", REVISION_REQUIRED: "Revision Required", COMPLETED: "Completed" };

export default function History() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/reports").then(setRows).catch((e) => setErr(e.message));
    api("/tasks").then(setTasks).catch(() => {});
  }, []);
  if (err) return <p className="text-red-600">{err}</p>;
  if (!rows) return <p>Memuat…</p>;
  const overdue = tasks.filter((t) => t.overdue);
  return (
    <div className="space-y-3">
      {overdue.length > 0 && <div className="card border-red-300 text-sm text-red-700">{overdue.length} follow-up terlambat</div>}
      <h1 className="text-lg font-semibold">Activity History</h1>
      {rows.length === 0 && <p className="text-slate-500">Belum ada report.</p>}
      {rows.map((r) => (
        <Link key={r.id} href={`/reports/${r.id}`} className="card block">
          <div className="flex justify-between text-sm"><b>{ACTIVITY_TYPES[r.activityType]}{r.area ? ` · ${r.area}` : ""}</b><span>{STATUS[r.status]}</span></div>
          <div className="text-xs text-slate-500">{fmtDate(r.activityAt)} · {r.pics}</div>
          <div className="mt-1 text-xs">📷 {r.photoCount} · {r.locationStatus === "VERIFIED" ? "✅ GPS Verified" : "⚠ Location Unverified"}</div>
        </Link>
      ))}
    </div>
  );
}
