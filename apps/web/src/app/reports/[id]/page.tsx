"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { ACTIVITY_TYPES, api, fmtDate, getToken } from "@/lib/api";
import { readGps, watermark } from "@/lib/photo";
import ReportForm from "@/components/ReportForm";

const SRC: Record<string, string> = { LIVE: "Live GPS", EXIF: "EXIF", UPLOAD: "Upload", MANUAL: "Manual" };

function Badge({ status, source }: { status: string; source?: string | null }) {
  return status === "VERIFIED"
    ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">GPS Verified{source ? ` · ${SRC[source]}` : ""}</span>
    : <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Location Unverified{source ? ` · ${SRC[source]}` : ""}</span>;
}

export default function ReportDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [r, setR] = useState<any>(null);
  const [pics, setPics] = useState<any[]>([]);
  const [edit, setEdit] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState({ title: "", picUserId: "", dueDate: "" });
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const tapFix = useRef<Awaited<ReturnType<typeof readGps>> | null>(null);

  const load = useCallback(() => api(`/reports/${id}`).then(setR).catch((e) => setMsg(e.message)), [id]);
  useEffect(() => { load(); api("/pics").then(setPics).catch(() => {}); }, [load]);
  if (!r) return <p>{msg || "Memuat…"}</p>;
  const locked = r.status !== "DRAFT" && r.status !== "REVISION_REQUIRED";

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMsg("");
    try { await fn(); await load(); } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  const checkin = () => run(async () => {
    const { fix, error } = await readGps();
    if (!fix) throw new Error(`Check-in GPS gagal: ${error}. Koordinat tidak diisi.`);
    await api(`/reports/${id}/checkin`, { method: "POST", json: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: fix.at, source: "LIVE" } });
  });

  // GPS dibaca saat tombol kamera ditekan dan lagi setelah foto kembali (saat jepret), bukan saat submit.
  const openCamera = async () => { tapFix.current = null; const p = readGps(); camRef.current?.click(); tapFix.current = await p; };

  const upload = (file: File, live: boolean) => run(async () => {
    const takenAt = new Date();
    let fix = null as Awaited<ReturnType<typeof readGps>>["fix"];
    if (live) {
      const after = await readGps(8000);
      fix = after.fix ?? tapFix.current?.fix ?? null;
      if (!fix) setMsg(`GPS tidak tersedia (${after.error ?? tapFix.current?.error}); foto disimpan sebagai Location Unverified.`);
    }
    const wm = await watermark(file, {
      takenAt, fix, area: r.area, activity: ACTIVITY_TYPES[r.activityType], pics: r.pics.map((p: any) => p.name).join(", "),
    });
    const f = new FormData();
    f.set("original", file); f.set("watermark", wm, "watermark.jpg"); f.set("takenAt", takenAt.toISOString());
    if (fix) {
      f.set("lat", String(fix.lat)); f.set("lng", String(fix.lng)); f.set("accuracy", String(fix.accuracy));
      f.set("gpsAt", fix.at.toISOString()); f.set("source", "LIVE");
    }
    await api(`/reports/${id}/photos`, { method: "POST", body: f });
  });

  if (edit) return <ReportForm initial={r} onSaved={(x) => { setR(x); setEdit(false); }} />;

  return (
    <div className="space-y-3">
      <div className="card space-y-1 text-sm">
        <div className="flex justify-between"><b>{ACTIVITY_TYPES[r.activityType]}{r.area ? ` · ${r.area}` : ""}</b><span>{r.status}</span></div>
        <div className="text-gray-600">{fmtDate(r.activityAt)} · PIC: {r.pics.map((p: any) => p.name).join(", ")}</div>
        {r.counterpart && <div>Counterpart: {r.counterpart}</div>}
        {r.accountName && <div>Account: {r.accountName}</div>}
        {r.summary && <p className="whitespace-pre-wrap">{r.summary}</p>}
        {(["discussion", "agreement", "issues"] as const).map((k) => r.items[k].length > 0 && (
          <div key={k}><b>{{ discussion: "Hasil diskusi", agreement: "Agreement", issues: "Issues" }[k]}</b>
            <ul className="list-disc pl-5">{r.items[k].map((t: string, i: number) => <li key={i}>{t}</li>)}</ul></div>
        ))}
        {r.nextAction && <div>Next action: {r.nextAction}</div>}
      </div>

      <div className="card space-y-2 text-sm">
        <b>GPS Check-in</b>
        {r.checkin ? (
          <div className="space-y-1">
            <Badge status={r.checkin.locationStatus} source={r.checkin.source} />
            <div>{r.checkin.lat.toFixed(6)}, {r.checkin.lng.toFixed(6)}{r.checkin.accuracy != null ? ` · ±${Math.round(r.checkin.accuracy)} m` : ""}</div>
          </div>
        ) : <div className="text-gray-600">Belum check-in.</div>}
        {!locked && <button className="btn-ghost" disabled={busy} onClick={checkin}>{r.checkin ? "Check-in ulang (tercatat di audit)" : "Check-in GPS"}</button>}
      </div>

      <div className="card space-y-2">
        <b className="text-sm">Dokumentasi</b>
        {!locked && (
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={busy} onClick={openCamera}>📷 Foto (kamera)</button>
            <button className="btn-ghost" disabled={busy} onClick={() => galRef.current?.click()}>Dari galeri</button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f, true); }} />
            <input ref={galRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f, false); }} />
          </div>
        )}
        <p className="text-xs text-gray-600">Foto galeri tidak dianggap diambil di lokasi (Location Unverified).</p>
        <div className="grid grid-cols-2 gap-2">
          {r.photos.map((p: any) => (
            <div key={p.id} className="space-y-1 text-xs">
              <img src={p.watermarkUrl ?? p.originalUrl} alt={p.caption ?? "foto"} className="w-full rounded-lg" />
              <Badge status={p.locationStatus} source={p.source} />
              <div className="flex gap-2">
                <a className="underline" href={p.originalUrl + "&download=1"}>Original</a>
                {p.watermarkUrl && <a className="underline" href={p.watermarkUrl + "&download=1"}>Watermark</a>}
                {!locked && <button className="text-red-600" onClick={() => run(() => api(`/reports/${id}/photos/${p.id}`, { method: "DELETE" }))}>Hapus</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-2 text-sm">
        <b>Follow-up Task</b>
        {r.tasks.map((t: any) => (
          <label key={t.id} className="flex items-center gap-2">
            <input type="checkbox" checked={t.status === "DONE"} onChange={(e) => run(() => api(`/tasks/${t.id}`, { method: "PATCH", json: { status: e.target.checked ? "DONE" : "OPEN" } }))} />
            <span className={t.status === "DONE" ? "line-through" : ""}>{t.title} — {t.picName}, {t.dueDate}</span>
          </label>
        ))}
        <div className="grid gap-2 sm:grid-cols-4">
          <input className="inp sm:col-span-2" placeholder="Tindak lanjut" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
          <select className="inp" value={task.picUserId} onChange={(e) => setTask({ ...task, picUserId: e.target.value })}>
            <option value="">PIC…</option>{pics.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="inp" type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} />
        </div>
        <button className="btn-ghost" disabled={busy || !task.title || !task.picUserId || !task.dueDate}
          onClick={() => run(async () => { await api(`/reports/${id}/tasks`, { method: "POST", json: task }); setTask({ title: "", picUserId: "", dueDate: "" }); })}>
          + Tambah task
        </button>
      </div>

      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {!locked && (
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setEdit(true)}>Ubah</button>
          <button className="btn flex-1" disabled={busy} onClick={() => run(() => api(`/reports/${id}/submit`, { method: "POST" }))}>Submit Report</button>
        </div>
      )}
    </div>
  );
}
