"use client";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Empty, IconChip, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { num, rupiah } from "@/lib/money";

const EMPTY = { name: "", sku: "", kind: "SERVICE", unit: "unit", price: "0", description: "" };

export default function Catalog() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [reviewer, setReviewer] = useState(false);
  const [f, setF] = useState<any>(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const me = await api("/me").catch(() => null);
    setReviewer(!!me?.reviewer);
    setRows(await api(`/catalog${me?.reviewer ? "?all=1" : ""}`).catch((e) => { setMsg(e.message); return []; }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const json = { name: f.name.trim(), sku: f.sku.trim(), kind: f.kind, unit: f.unit.trim() || "unit", price: num(f.price), description: f.description.trim() || undefined };
      if (editId) await api(`/catalog/${editId}`, { method: "PATCH", json }); else await api("/catalog", { method: "POST", json });
      setF(EMPTY); setEditId(null); await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const toggle = async (c: any) => { try { await api(`/catalog/${c.id}`, { method: "PATCH", json: { active: !c.active } }); await load(); } catch (e: any) { setMsg(e.message); } };
  return (
    <div className="space-y-4">
      <PageHeader icon="tag" title="Katalog Jasa & Produk" subtitle="Layanan non-internet untuk penawaran · paket internet dikelola di WO" />
      {reviewer && (
        <div className="card rise space-y-3">
          <b className="flex items-center gap-2 text-sm"><IconChip name={editId ? "edit" : "plus"} tone="slate" size={16} />{editId ? "Ubah item" : "Item baru"}</b>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="lbl">Nama</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label className="lbl">SKU (opsional — kosong = dipetakan manual oleh Marketing di WO)</label><input className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></div>
            <div><label className="lbl">Jenis</label>
              <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="SERVICE">Jasa</option><option value="PRODUCT">Produk</option></select></div>
            <div><label className="lbl">Satuan (bulan, unit, titik…)</label><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
            <div><label className="lbl">Harga jual bawaan (Rp, opsional)</label><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
            <div><label className="lbl">Keterangan</label><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          </div>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <div className="flex gap-2">
            <button className="btn" disabled={busy || f.name.trim().length < 2} onClick={save}>{editId ? "Simpan" : "Tambah"}</button>
            {editId && <button className="btn-ghost" onClick={() => { setEditId(null); setF(EMPTY); }}>Batal</button>}
          </div>
        </div>
      )}
      {!reviewer && msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows && <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200/60 dark:bg-white/5" />)}</div>}
      {rows?.length === 0 && <Empty icon="tag" title="Katalog masih kosong" text={reviewer ? "Tambahkan jasa atau produk pertama di atas." : "Minta reviewer menambahkan item."} />}
      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((c) => (
          <div key={c.id} className={`list-card rise !p-3.5 ${c.active ? "" : "opacity-60"}`}>
            <div className="flex items-start gap-3">
              <IconChip name={c.kind === "SERVICE" ? "settings" : "box"} tone={c.kind === "SERVICE" ? "blue" : "accent"} size={19} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2"><b className="truncate text-sm text-brand-900 dark:text-white">{c.name}</b>{!c.active && <Badge tone="slate">nonaktif</Badge>}</div>
                <div className="font-display text-lg font-semibold text-brand-900 dark:text-white">{rupiah(c.price)} <span className="text-xs font-normal text-slate-500">/ {c.unit}</span></div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500"><span>{c.kind === "SERVICE" ? "Jasa" : "Produk"}</span>{c.sku && <span>SKU {c.sku}</span>}{c.description && <span>{c.description}</span>}</div>
                {reviewer && <div className={`mt-1 inline-flex items-center gap-1 text-xs ${c.woSyncError ? "text-red-600" : "text-slate-500"}`}><Icon name="sync" size={12} />{c.woSyncError ? `Sinkron WO gagal: ${c.woSyncError}` : c.woSyncedAt ? "Tersinkron ke WO" : "Belum disinkron ke WO"}</div>}
              </div>
            </div>
            {reviewer && (
              <div className="mt-2 flex gap-2">
                <button className="btn-ghost" onClick={() => { setEditId(c.id); setF({ name: c.name, sku: c.sku ?? "", kind: c.kind, unit: c.unit, price: String(c.price), description: c.description ?? "" }); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Icon name="edit" size={14} />Ubah</button>
                <button className="btn-ghost" onClick={() => toggle(c)}>{c.active ? "Nonaktifkan" : "Aktifkan"}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
