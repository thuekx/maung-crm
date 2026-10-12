"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { num, rupiah } from "@/lib/money";

const EMPTY = { name: "", kind: "SERVICE", unit: "unit", price: "0", description: "" };

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
      const json = { name: f.name.trim(), kind: f.kind, unit: f.unit.trim() || "unit", price: num(f.price), description: f.description.trim() || undefined };
      if (editId) await api(`/catalog/${editId}`, { method: "PATCH", json }); else await api("/catalog", { method: "POST", json });
      setF(EMPTY); setEditId(null); await load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const toggle = async (c: any) => { try { await api(`/catalog/${c.id}`, { method: "PATCH", json: { active: !c.active } }); await load(); } catch (e: any) { setMsg(e.message); } };
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Katalog Jasa &amp; Produk</h1>
      <p className="text-xs text-slate-500">Layanan non-internet untuk penawaran. Paket internet dikelola di WO (MSRadius). Perubahan harga tidak mengubah penawaran yang sudah dibuat.</p>
      {reviewer && (
        <div className="card space-y-2">
          <b className="text-sm">{editId ? "Ubah item" : "Item baru"}</b>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><label className="lbl">Nama</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label className="lbl">Jenis</label>
              <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="SERVICE">Jasa</option><option value="PRODUCT">Produk</option></select></div>
            <div><label className="lbl">Satuan (bulan, unit, titik…)</label><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
            <div><label className="lbl">Harga (Rp)</label><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
          </div>
          <div><label className="lbl">Keterangan</label><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <div className="flex gap-2">
            <button className="btn" disabled={busy || f.name.trim().length < 2} onClick={save}>{editId ? "Simpan" : "Tambah"}</button>
            {editId && <button className="btn-ghost" onClick={() => { setEditId(null); setF(EMPTY); }}>Batal</button>}
          </div>
        </div>
      )}
      {!reviewer && msg && <p className="text-sm text-red-600">{msg}</p>}
      {!rows && <p>Memuat…</p>}
      {rows?.length === 0 && <p className="text-slate-500">Katalog masih kosong{reviewer ? "." : " — minta reviewer menambahkan item."}</p>}
      {rows?.map((c) => (
        <div key={c.id} className={`card flex items-start justify-between gap-2 text-sm ${c.active ? "" : "opacity-60"}`}>
          <div>
            <b>{c.name}</b> <span className="text-xs text-slate-500">· {c.kind === "SERVICE" ? "Jasa" : "Produk"} · per {c.unit}</span>
            <div>{rupiah(c.price)}</div>
            {c.description && <div className="text-xs text-slate-500">{c.description}</div>}
            {reviewer && <div className="text-xs text-slate-500">{c.woSyncError ? `Sinkron WO gagal: ${c.woSyncError}` : c.woSyncedAt ? "Tersinkron ke WO" : "Belum disinkron ke WO"}{c.active ? "" : " · nonaktif"}</div>}
          </div>
          {reviewer && (
            <div className="flex shrink-0 gap-2">
              <button className="btn-ghost" onClick={() => { setEditId(c.id); setF({ name: c.name, kind: c.kind, unit: c.unit, price: String(c.price), description: c.description ?? "" }); window.scrollTo({ top: 0 }); }}>Ubah</button>
              <button className="btn-ghost" onClick={() => toggle(c)}>{c.active ? "Nonaktifkan" : "Aktifkan"}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
