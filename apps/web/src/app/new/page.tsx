"use client";
import { useRouter } from "next/navigation";
import ReportForm from "@/components/ReportForm";
import { PageHeader } from "@/components/ui";

export default function NewReport() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader icon="plus" title="Report Baru" subtitle="Catat kunjungan, hasil diskusi, dan tindak lanjut" />
      <ReportForm onSaved={(r) => router.push(`/reports/${r.id}`)} />
    </div>
  );
}
