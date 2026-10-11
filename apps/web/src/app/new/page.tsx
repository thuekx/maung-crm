"use client";
import { useRouter } from "next/navigation";
import ReportForm from "@/components/ReportForm";

export default function NewReport() {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">New Field Report</h1>
      <ReportForm onSaved={(r) => router.push(`/reports/${r.id}`)} />
    </div>
  );
}
