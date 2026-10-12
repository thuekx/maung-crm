"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { calc, num, rupiah } from "@/lib/money";

interface Line { catalogId: string; qty: string; unitPrice: string; note: string }

export default function QuoteEditor({ q, catalog, onSaved }: { q: any; catalog: any[]; onSaved: () => Promise<void> }) {
  const [h, setH] = useState({
    customerName: q.customerName ?? "", customerPhone: q.customerPhone ?? "", customerEmail: q.customerEmail ?? "", customerAddress: q.customerAddress ?? "", picName: q.picName ?? "",
    subject: q.subject ?? "", validUntil: q.validUntil ?? "", terms: q.terms ?? "", notes: q.notes ?? "", taxRate: String(q.taxRate ?? 11), discount: String(q.discount ?? 0),
  });
  const [lines, setLines] = useState<Line[]>(q.lines.map((l: any) => ({ catalogId: String(l.catalogId), qty: String(l.qty), unitPrice: String(l.unitPrice), note: l.note ?? "" })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const byId = new Map(catalog.map((c) => [String(c.id), c]));
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const pick = (i: number, id: string) => setLine(i, { catalogId: id, unitPrice: String(byId.get(id)?.price ?? 0) });
  const t = calc(lines.filter((l) => l.catalogId).map((l) => ({ qty: num(l.qty), unitPrice: num(l.unitPrice) })), num(h.discount), num(h.taxRate));

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api(`/quotations/${q.id}`, { method: "PUT", json: {
        ...h, taxRate: num(h.taxRate), discount: num(h.discount), validUntil: h.validUntil || undefined,
        lines: lines.filter((l) => l.catalogId).map((l) => ({ catalogId: Number(l.catalogId), qty: num(l.qty), unitPrice: num(l.unitPrice), note: l.note.trim() || undefined })),
      } });
      await onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const field = (k: keyof typeof h, label: string, type = "text") => (
    <div><label className="lbl">{label}</label><input className="input" type={type} value={h[k]} onChange={(e) => setH({ ...h, [k]: e.target.value })} /></div>
  );
  return (
    <div className="card space-y-3">
      <b className="text-sm">Isi penawaran</b>
      <div className="grid gap-2 sm:grid-cols-2">
        {field("customerName", "Kepada (nama pelanggan)")}{field("picName", "Up. / PIC")}
        {field("customerPhone", "Telepon")}{field("customerEmail", "Email")}
      </div>
      {field("customerAddress", "Alamat")}
      <div className="grid gap-2 sm:grid-cols-2">{field("subject", "Perihal")}{field("validUntil", "Berlaku sampai", "date")}</div>

      <div className="space-y-2">
        <label className="lbl">Baris penawaran</label>
        {lines.map((l, i) => (
          <div key={i} className="space-y-1 rounded-lg border border-slate-200 p-2">
            <select className="input" aria-label="Item" value={l.catalogId} onChange={(e) => pick(i, e.target.value)}>
              <option value="">— pilih dari katalog —</option>
              {catalog.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === "SERVICE" ? "Jasa" : "Produk"}, per {c.unit})</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="lbl">Jumlah</label><input className="input" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></div>
              <div><label className="lbl">Harga satuan</label><input className="input" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></div>
              <div><label className="lbl">Jumlah (Rp)</label><div className="input bg-slate-50">{rupiah(num(l.qty) * num(l.unitPrice))}</div></div>
            </div>
            <div className="flex gap-2"><input className="input" placeholder="Catatan baris (opsional)" value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} />
              <button type="button" className="btn-ghost" aria-label="Hapus baris" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></div>
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={() => setLines([...lines, { catalogId: "", qty: "1", unitPrice: "0", note: "" }])}>+ Tambah baris</button>
        {catalog.length === 0 && <p className="text-xs text-amber-700">Katalog kosong — minta reviewer menambahkan item di menu Katalog.</p>}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {field("discount", "Diskon (Rp)")}{field("taxRate", "PPN (%)")}
      </div>
      <div className="rounded-lg bg-slate-50 p-2 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{rupiah(t.subtotal)}</span></div>
        <div className="flex justify-between"><span>Diskon</span><span>- {rupiah(num(h.discount))}</span></div>
        <div className="flex justify-between"><span>PPN {num(h.taxRate)}%</span><span>{rupiah(t.tax)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total</span><span>{rupiah(t.total)}</span></div>
        <p className="text-xs text-slate-500">Angka resmi dihitung ulang oleh server saat disimpan.</p>
      </div>
      <div><label className="lbl">Syarat &amp; ketentuan</label><textarea className="input" rows={4} value={h.terms} onChange={(e) => setH({ ...h, terms: e.target.value })} /></div>
      <div><label className="lbl">Catatan</label><textarea className="input" rows={2} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn w-full" disabled={busy} onClick={save}>{busy ? "Menyimpan…" : "Simpan draft"}</button>
    </div>
  );
}
