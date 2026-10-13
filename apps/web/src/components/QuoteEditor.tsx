"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { calc, num, rupiah } from "@/lib/money";

interface Line { catalogId: string; qty: string; unitPrice: string; note: string }

const NEW_ITEM = { name: "", kind: "PRODUCT", unit: "unit" };

export default function QuoteEditor({ q, catalog, banks, onSaved, onCatalog }: { q: any; catalog: any[]; banks: any[]; onSaved: () => Promise<void>; onCatalog: () => Promise<any[]> }) {
  const [h, setH] = useState({
    customerName: q.customerName ?? "", customerPhone: q.customerPhone ?? "", customerEmail: q.customerEmail ?? "", customerAddress: q.customerAddress ?? "", picName: q.picName ?? "",
    subject: q.subject ?? "", validUntil: q.validUntil ?? "", terms: q.terms ?? "", notes: q.notes ?? "", taxRate: String(q.taxRate ?? 11), discount: String(q.discount ?? 0),
  });
  const [lines, setLines] = useState<Line[]>(q.lines.map((l: any) => ({ catalogId: String(l.catalogId), qty: String(l.qty), unitPrice: String(l.unitPrice), note: l.note ?? "" })));
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(q.seq != null ? String(q.seq) : "");
  const [bankId, setBankId] = useState<string>(q.bankAccount?.id ?? "");
  const [ni, setNi] = useState<{ line: number; f: typeof NEW_ITEM } | null>(null); // item katalog baru untuk baris ke-n
  const [err, setErr] = useState("");
  const byId = new Map(catalog.map((c) => [String(c.id), c]));
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const pick = (i: number, id: string) => setLine(i, { catalogId: id, unitPrice: String(byId.get(id)?.price ?? 0) });
  const t = calc(lines.filter((l) => l.catalogId).map((l) => ({ qty: num(l.qty), unitPrice: num(l.unitPrice) })), num(h.discount), num(h.taxRate));

  // Simpan; bila `submit`, langsung ajukan untuk persetujuan (tanpa langkah "simpan draft" terpisah).
  const save = async (submit = false) => {
    setBusy(true); setErr("");
    try {
      const filled = lines.filter((l) => l.catalogId);
      if (submit && !filled.length) throw new Error("Tambahkan minimal satu baris (pilih item katalog atau buat item baru) sebelum diajukan");
      if (seq.trim() && !/^\d+$/.test(seq.trim())) throw new Error("Nomor urut hanya angka (kosongkan untuk otomatis)");
      await api(`/quotations/${q.id}`, { method: "PUT", json: {
        ...h, taxRate: num(h.taxRate), discount: num(h.discount), validUntil: h.validUntil || undefined,
        lines: filled.map((l) => ({ catalogId: Number(l.catalogId), qty: num(l.qty), unitPrice: num(l.unitPrice), note: l.note.trim() || undefined })),
        ...(bankId === "" || banks.some((b) => b.id === bankId) ? { bankAccountId: bankId } : {}), ...(q.numberEditable && seq.trim() ? { seq: Number(seq.trim()) } : {}),
      } });
      if (submit) await api(`/quotations/${q.id}/submit`, { method: "POST", json: {} });
      await onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const createItem = async () => {
    if (!ni) return;
    setBusy(true); setErr("");
    try {
      // Item baru hanya nama/jenis/satuan; harga diisi di "Harga satuan" baris (harga jual/sewa setelah konsultasi Procurement).
      const r = await api<{ id: number }>("/catalog", { method: "POST", json: { name: ni.f.name.trim(), kind: ni.f.kind, unit: ni.f.unit.trim() || "unit", price: 0 } });
      await onCatalog();
      setLine(ni.line, { catalogId: String(r.id) });
      setNi(null);
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
      {q.numberEditable && (
        <div><label className="lbl">Nomor urut penawaran (kosongkan = otomatis)</label>
          <input className="input" inputMode="numeric" placeholder="otomatis" value={seq} onChange={(e) => setSeq(e.target.value)} />
          <p className="mt-0.5 text-xs text-slate-500">Nomor saat ini {q.number}. Diubah hanya sebelum penawaran pertama kali dikirim; nomor yang sudah dipakai ditolak.</p></div>
      )}

      <div className="space-y-2">
        <label className="lbl">Baris penawaran</label>
        {lines.map((l, i) => (
          <div key={i} className="space-y-1 rounded-lg border border-slate-200 p-2">
            <div className="flex gap-2">
              <select className="input" aria-label="Item" value={l.catalogId} onChange={(e) => pick(i, e.target.value)}>
                <option value="">— pilih dari katalog —</option>
                {catalog.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind === "SERVICE" ? "Jasa" : "Produk"}, per {c.unit})</option>)}
              </select>
              <button type="button" className="btn-ghost shrink-0 !px-2 text-xs" onClick={() => setNi({ line: i, f: { ...NEW_ITEM } })}>+ Item baru</button>
            </div>
            {ni?.line === i && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-white/5">
                <p className="text-xs text-slate-500">Belum ada di katalog? Buat di sini (cukup nama, jenis, satuan); item langsung tercatat di Katalog. Harga jual/sewa diisi di "Harga satuan" baris ini setelah konsultasi dengan Procurement.</p>
                <input className="input" placeholder="Nama item (mis. Access Point EW1200)" value={ni.f.name} onChange={(e) => setNi({ ...ni, f: { ...ni.f, name: e.target.value } })} />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" aria-label="Jenis" value={ni.f.kind} onChange={(e) => setNi({ ...ni, f: { ...ni.f, kind: e.target.value } })}><option value="PRODUCT">Produk</option><option value="SERVICE">Jasa</option></select>
                  <input className="input" placeholder="Satuan" value={ni.f.unit} onChange={(e) => setNi({ ...ni, f: { ...ni.f, unit: e.target.value } })} />
                </div>
                <div className="flex gap-2"><button type="button" className="btn" disabled={busy || ni.f.name.trim().length < 2} onClick={createItem}>Simpan ke katalog &amp; pakai</button>
                  <button type="button" className="btn-ghost" onClick={() => setNi(null)}>Batal</button></div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div><label className="lbl">Jumlah</label><input className="input" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></div>
              <div><label className="lbl">Harga satuan (jual/sewa)</label><input className="input" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></div>
              <div><label className="lbl">Jumlah (Rp)</label><div className="input bg-slate-50">{rupiah(num(l.qty) * num(l.unitPrice))}</div></div>
            </div>
            <div className="flex gap-2"><input className="input" placeholder="Catatan baris (opsional)" value={l.note} onChange={(e) => setLine(i, { note: e.target.value })} />
              <button type="button" className="btn-ghost" aria-label="Hapus baris" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></div>
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={() => setLines([...lines, { catalogId: "", qty: "1", unitPrice: "0", note: "" }])}>+ Tambah baris</button>
        {catalog.length === 0 && <p className="text-xs text-amber-700">Katalog masih kosong — pakai tombol "+ Item baru" pada baris.</p>}
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
      <div><label className="lbl">Rekening pembayaran</label>
        <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value)}>
          <option value="">— tanpa rekening —</option>
          {banks.map((b) => <option key={b.id} value={b.id}>{b.bankName} · {b.accNo}{b.isDefault ? " (bawaan)" : ""}</option>)}
          {q.bankAccount && !banks.some((b) => b.id === q.bankAccount.id) && <option value={q.bankAccount.id}>{q.bankAccount.bankName} · {q.bankAccount.accNo} (sudah dihapus dari pengaturan)</option>}
        </select>
        {banks.length === 0 && <p className="mt-0.5 text-xs text-slate-500">Belum ada rekening di Pengaturan CRM (Admin).</p>}</div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <button className="btn-ghost w-full" disabled={busy} onClick={() => save(false)}>{busy ? "Menyimpan…" : "Simpan draft"}</button>
        <button className="btn w-full" disabled={busy} onClick={() => save(true)}>{busy ? "Memproses…" : "Ajukan untuk persetujuan"}</button>
      </div>
    </div>
  );
}
