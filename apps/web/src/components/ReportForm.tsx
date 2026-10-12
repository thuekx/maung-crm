"use client";
import { useEffect, useState } from "react";
import { ACTIVITY_TYPES, api } from "@/lib/api";

type Items = { discussion: string[]; agreement: string[]; issues: string[] };
const LABELS: Record<keyof Items, string> = { discussion: "Hasil diskusi / update", agreement: "Agreement / kesepakatan", issues: "Issues / kendala" };

export default function ReportForm({ initial, onSaved }: { initial?: any; onSaved: (r: any) => void }) {
  const [pics, setPics] = useState<{ id: string; name: string }[]>([]);
  const [me, setMe] = useState<any>(null);
  const [f, setF] = useState({
    activityType: initial?.activityType ?? "CANVASSING", counterpart: initial?.counterpart ?? "", accountName: initial?.accountName ?? "",
    area: initial?.area ?? "", summary: initial?.summary ?? "", nextAction: initial?.nextAction ?? "",
  });
  const [picIds, setPicIds] = useState<string[]>(initial?.pics?.map((p: any) => p.userId) ?? []);
  const [items, setItems] = useState<Items>(initial?.items ?? { discussion: [""], agreement: [], issues: [] });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/pics").then(setPics).catch((e) => setErr(e.message));
    api("/me").then((m) => { setMe(m); setPicIds((p) => (p.length ? p : [m.id])); }).catch(() => {});
  }, []);

  const setItem = (k: keyof Items, i: number, v: string) => setItems({ ...items, [k]: items[k].map((x, j) => (j === i ? v : x)) });

  async function save() {
    setBusy(true); setErr("");
    try {
      const clean = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.map((s) => s.trim()).filter(Boolean)]));
      const body = { ...f, picIds, items: clean };
      const r = await api(initial ? `/reports/${initial.id}` : "/reports", { method: initial ? "PUT" : "POST", json: body });
      onSaved(r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card space-y-3">
      <div>
        <label className="lbl">Activity Type</label>
        <select className="input" value={f.activityType} onChange={(e) => setF({ ...f, activityType: e.target.value })}>
          {Object.entries(ACTIVITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="lbl">Marketing / PIC (bisa lebih dari satu)</label>
        <div className="flex flex-wrap gap-2">
          {pics.map((p) => (
            <label key={p.id} className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm">
              <input type="checkbox" checked={picIds.includes(p.id)} onChange={(e) => setPicIds(e.target.checked ? [...picIds, p.id] : picIds.filter((x) => x !== p.id))} />
              {p.name}{me?.id === p.id ? " (saya)" : ""}
            </label>
          ))}
        </div>
      </div>
      {(["counterpart", "accountName", "area"] as const).map((k) => (
        <div key={k}>
          <label className="lbl">{{ counterpart: "Counterpart", accountName: "Account / organisasi", area: "Area / wilayah" }[k]}</label>
          <input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </div>
      ))}
      <div><label className="lbl">Summary</label><textarea className="input" rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></div>
      {(Object.keys(LABELS) as (keyof Items)[]).map((k) => (
        <div key={k}>
          <label className="lbl">{LABELS[k]}</label>
          {items[k].map((t, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className="input" value={t} onChange={(e) => setItem(k, i, e.target.value)} />
              <button type="button" className="btn-ghost" aria-label="Hapus" onClick={() => setItems({ ...items, [k]: items[k].filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="btn-ghost" onClick={() => setItems({ ...items, [k]: [...items[k], ""] })}>+ Tambah</button>
        </div>
      ))}
      <div><label className="lbl">Next Action</label><input className="input" value={f.nextAction} onChange={(e) => setF({ ...f, nextAction: e.target.value })} /></div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button className="btn w-full" onClick={save} disabled={busy || picIds.length === 0}>{busy ? "Menyimpan…" : initial ? "Simpan perubahan" : "Simpan sebagai Draft"}</button>
    </div>
  );
}
