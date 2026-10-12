"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, PageHeader, Section } from "@/components/ui";
import { api } from "@/lib/api";
import { num } from "@/lib/money";

export default function SettingsAdmin() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState({ taxRate: "11", validDays: "14", terms: "" });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api("/admin/settings").then((x) => { setS(x); setF({ taxRate: String(x.quotation.taxRate), validDays: String(x.quotation.validDays), terms: x.quotation.terms }); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="space-y-4"><PageHeader icon="settings" title="Pengaturan CRM" /><p className="card text-sm text-red-600">{err}</p></div>;
  if (!s) return <p>Memuat…</p>;
  const save = async (body: unknown, ok: string) => { setBusy(true); setMsg(null); try { await api("/admin/settings", { method: "PUT", json: body }); setMsg({ ok: true, text: ok }); await load(); } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); } };
  const i = s.integration;
  const row = (k: string, v: React.ReactNode) => <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-sm dark:border-white/10"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v}</span></div>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader icon="settings" title="Pengaturan CRM" subtitle="Admin" action={<Link href="/admin/data" className="btn-ghost"><Icon name="layers" size={16} />Data &amp; Backup</Link>} />
      {msg && <p className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"}`}>{msg.text}</p>}

      <Section icon="file" title="Bawaan penawaran">
        <p className="text-sm text-slate-500">Dipakai saat penawaran baru dibuat (bisa diubah per penawaran). Penawaran yang sudah ada tidak berubah.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="lbl">PPN bawaan (%)</label><input className="input" inputMode="decimal" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} /></div>
          <div><label className="lbl">Masa berlaku bawaan (hari)</label><input className="input" inputMode="numeric" value={f.validDays} onChange={(e) => setF({ ...f, validDays: e.target.value })} /></div>
        </div>
        <div><label className="lbl">Syarat &amp; ketentuan bawaan (maks. 2000 karakter)</label><textarea className="input" rows={5} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></div>
        <button className="btn" disabled={busy || !f.terms.trim()} onClick={() => save({ quotation: { taxRate: num(f.taxRate), validDays: Math.round(num(f.validDays)), terms: f.terms.trim() } }, "Bawaan penawaran disimpan")}>Simpan</button>
      </Section>

      <Section icon="sync" title="Kirim ke WO" aside={<Badge tone={i.wo.enabled ? "green" : "amber"} dot>{i.wo.enabled ? "aktif" : i.wo.paused ? "dijeda" : "nonaktif"}</Badge>}>
        <p className="text-sm text-slate-500">Katalog dan penawaran dikirim ke WO lewat antrean. Data demo tidak pernah dikirim. Jeda ini tidak menghapus antrean — pengiriman berlanjut saat diaktifkan lagi.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!s.woSync.paused} disabled={busy} onChange={(e) => save({ woSync: { paused: e.target.checked } }, e.target.checked ? "Pengiriman ke WO dijeda" : "Pengiriman ke WO dilanjutkan")} />Jeda pengiriman ke WO</label>
        <div>
          {row("Menunggu / ditolak WO", `${i.wo.pending} / ${i.wo.blocked}`)}
          {row("Kunci integrasi (CRM → WO)", <Badge tone={i.integrationKeySet ? "green" : "amber"}>{i.integrationKeySet ? "terisi" : "kosong"}</Badge>)}
          {i.envSwitchOff && row("Sakelar server", <Badge tone="amber">WO_SYNC_ENABLED=0</Badge>)}
        </div>
      </Section>

      <Section icon="link" title="Integrasi & server (hanya baca)">
        <p className="text-xs text-slate-500">Nilai ini diatur di server (<code>.env</code> CRM). Kunci tidak pernah ditampilkan.</p>
        <div>
          {row("Alamat WO", i.woUrl ?? "—")}
          {row("Kunci Export (WO → CRM)", <Badge tone={i.exportKeySet ? "green" : "amber"}>{i.exportKeySet ? "terisi" : "kosong"}</Badge>)}
          {row("Interval tarik cermin", `${i.syncIntervalMin} menit`)}
          {row("Negara bawaan nomor telepon", i.phoneRegion)}
          {row("Penyimpanan foto", i.storage === "s3" ? `Garage/S3 (${i.s3Endpoint ?? "?"})` : "folder lokal")}
        </div>
      </Section>
    </div>
  );
}
