"use client";
import { useRouter } from "next/navigation";
import LeadForm from "@/components/LeadForm";
import { api } from "@/lib/api";

export default function NewLead() {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Lead Baru</h1>
      <LeadForm submitLabel="Simpan Lead" onSubmit={async (f) => {
        const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([k, v]) => k === "kind" || k === "name" || k === "phone" || v !== ""));
        const l = await api("/leads", { method: "POST", json: body });
        router.push(`/leads/${l.id}`);
      }} />
    </div>
  );
}
