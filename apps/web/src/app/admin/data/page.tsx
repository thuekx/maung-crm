"use client";
import { useCallback, useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { Icon } from "@/components/icons";
import { Badge, PageHeader, Section } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { bytes, download, upload } from "@/lib/admin";

const KIND: Record<string, string> = { manual: "Manual", auto: "Otomatis harian", "pre-purge": "Sebelum purge", "pre-restore": "Sebelum restore/demo", unknown: "?" };
const SCOPES = [
  { v: 1, t: "Transaksi saja", d: "Hapus semua lead, penawaran, field report (beserta foto, follow-up, komentar), antrean kirim ke WO, log audit, dan penomoran. Katalog dan cermin data WO tetap." },
  { v: 2, t: "Transaksi + cermin data WO", d: "Seperti di atas, ditambah cermin pelanggan, langganan, paket, area, dan WO Pasang Baru (ditarik ulang otomatis dari WO). Katalog tetap." },
  { v: 3, t: "Semua data operasional", d: "Semuanya kecuali akun Admin dan pengaturan: termasuk katalog jasa/produk." },
];

export default function DataAdmin() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [restore, setRestore] = useState<any>(null);
  const [purge, setPurge] = useState({ onlyDemo: false, scope: 1, deleteUsers: false, deleteFiles: false, backupFirst: true, confirm: "" });
  const [demoConfirm, setDemoConfirm] = useState("");
  const [dq, setDq] = useState<any[]>([]);
  const [pick, setPick] = useState<number[]>([]);
  const [testConfirm, setTestConfirm] = useState("");
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => Promise.all([api("/admin/data/overview"), api("/admin/data/demo-quotations")]).then(([x, y]) => { setD(x); setDq(y.items); setPick((p) => p.filter((id) => y.items.some((i: any) => i.id === id))); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err) return <div className="space-y-4"><PageHeader icon="layers" title="Data & Backup CRM" /><p className="card text-sm text-red-600">{err}</p></div>;
  if (!d) return <p>Memuat…</p>;

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setOut(null);
    try { setOut({ ok: true, text: await fn() }); await load(); } catch (e: any) { setOut({ ok: false, text: e.message }); } finally { setBusy(""); }
  };
  const c = d.counts, demoTotal = d.demo.leads + d.demo.quotations + d.demo.reports + d.demo.catalog;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader icon="layers" title="Data & Backup CRM" subtitle="Admin · sama dengan menu di Maung WO" />

      <Section icon="list" title="Ringkasan data">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          {[["Lead", c.leads], ["Penawaran", c.quotations], ["Katalog", c.catalog], ["Field report", c.reports], ["Foto", c.photos], ["Follow-up", c.tasks], ["Pelanggan (cermin WO)", c.customersMirror], ["Identitas WO (cache)", c.users], ["Antrean kirim ke WO", c.outboxPending]].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between gap-2 border-b border-slate-100 py-1 dark:border-white/10"><dt className="text-slate-500">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
        </dl>
        <p className="text-xs text-slate-500">Folder backup <code>{d.backupDir}</code>{d.disk && <> · ruang disk kosong {bytes(d.disk.freeBytes)} dari {bytes(d.disk.totalBytes)}</>}{demoTotal > 0 && <> · <b>data demo aktif</b>: {d.demo.leads} lead, {d.demo.quotations} penawaran, {d.demo.reports} report, {d.demo.catalog} item katalog</>}</p>
      </Section>

      {out && <p className={`rounded-xl px-3 py-2 text-sm ${out.ok ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"}`}>{out.text}</p>}

      <Section icon="download" title="Backup & restore data" aside={
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={d.autoDaily} onChange={(e) => run("auto", async () => { await api("/admin/data/auto", { method: "PUT", json: { autoDaily: e.target.checked } }); return e.target.checked ? "Backup otomatis harian diaktifkan" : "Backup otomatis dimatikan"; })} />Otomatis harian (02:30, simpan 7)</label>
      }>
        <p className="text-sm text-slate-500">Backup berisi seluruh data database CRM (lead, penawaran, katalog, field report, cermin WO, pengaturan, jejak). Disimpan di server dan bisa diunduh/diunggah (<code>.json.gz</code>). Foto ada di Garage dan dicadangkan terpisah (kartu di bawah). <b>Simpan salinan di luar server secara berkala.</b></p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-64" placeholder="catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn" disabled={!!busy} onClick={() => run("backup", async () => { const m = await api("/admin/data/backup", { method: "POST", json: { note } }); setNote(""); return `Backup dibuat: ${m.name} (${bytes(m.size)})`; })}>{busy === "backup" ? "Membuat…" : "Buat backup sekarang"}</button>
          <label className="btn-ghost cursor-pointer">Unggah backup (.json.gz)<input type="file" accept=".gz,.json.gz" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run("up", async () => { const m = await upload("/admin/data/backups/upload", f); return `Backup diunggah: ${m.name}`; }); }} /></label>
        </div>
        {!d.backups.length ? <p className="text-sm text-slate-400">Belum ada backup.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Waktu</th><th className="pr-3">Jenis</th><th className="pr-3">Ukuran</th><th className="pr-3">Berkas</th><th /></tr></thead>
              <tbody>{d.backups.map((b: any) => (
                <tr key={b.name} className="border-t border-slate-100 align-top dark:border-white/10">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-xs">{fmtDate(b.createdAt)}</td>
                  <td className="pr-3"><Badge tone={b.kind === "manual" ? "green" : "slate"}>{KIND[b.kind] ?? b.kind}</Badge></td>
                  <td className="whitespace-nowrap pr-3 text-xs">{bytes(b.size)}</td>
                  <td className="max-w-[12rem] pr-3 text-xs"><code className="block truncate" title={b.name}>{b.name}</code>{b.note && <div className="text-slate-500">{b.note}</div>}{!b.valid && <div className="text-red-600">{b.error}</div>}</td>
                  <td className="whitespace-nowrap text-xs">
                    {b.valid && <><button className="btn-link !text-xs" onClick={() => download(`/admin/data/backups/${b.name}/download`, b.name).catch((e) => setOut({ ok: false, text: e.message }))}>Unduh</button> · <button className="btn-link !text-xs" onClick={() => setRestore({ name: b.name, includeSettings: false, confirm: "" })}>Restore</button> · </>}
                    <button className="text-xs font-semibold text-red-600 hover:underline" onClick={() => { if (confirm(`Hapus backup ${b.name}?`)) run("del", async () => { await api(`/admin/data/backups/${b.name}`, { method: "DELETE" }); return "Backup dihapus"; }); }}>Hapus</button>
                  </td>
                </tr>))}</tbody></table>
          </div>
        )}
      </Section>

      <Section icon="camera" title="Foto & berkas">
        <p className="text-sm text-slate-500">Foto laporan lapangan tersimpan di <b>Garage</b> (penyimpanan objek bersama), bukan di database, sehingga tidak ada unduh/unggah di sini. Cadangkan dengan skrip milik WO di server:</p>
        <pre className="overflow-x-auto rounded-xl bg-slate-100 p-3 text-xs dark:bg-white/5">cd ~/Maung-Wo-Inv &amp;&amp; bash scripts/garage-backup.sh</pre>
        <p className="text-xs text-slate-500">Backup database di atas tidak memuat isi foto; restore database memulihkan catatan fotonya, sedangkan berkasnya dipulihkan dari backup Garage.</p>
      </Section>

      <section className="card rise space-y-3 !border-red-200 dark:!border-red-400/30">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400"><Icon name="trash" size={16} />Purge data (hapus data uji)</h2>
        <p className="text-sm text-slate-500">Untuk membersihkan data percobaan. <b>Akun Admin Anda dan pengaturan CRM tidak pernah terhapus.</b> Sebelum menghapus, backup otomatis dibuat (bisa di-restore dari daftar di atas).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[{ v: true, t: "Hanya data demo", d: "Hapus baris bertanda demo saja. Data nyata tidak tersentuh." }, { v: false, t: "Semua data (menurut cakupan)", d: "Hapus data nyata dan demo sesuai cakupan di bawah." }].map((m) => (
            <label key={String(m.v)} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${purge.onlyDemo === m.v ? "border-red-300 bg-red-50 dark:border-red-400/40 dark:bg-red-500/10" : "border-slate-200 dark:border-white/10"}`}>
              <input type="radio" className="mt-1" checked={purge.onlyDemo === m.v} onChange={() => setPurge({ ...purge, onlyDemo: m.v })} /><span><b>{m.t}</b><br /><span className="text-xs text-slate-500">{m.d}</span></span>
            </label>))}
        </div>
        {!purge.onlyDemo && (
          <div className="space-y-2">{SCOPES.map((sc) => (
            <label key={sc.v} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 text-sm ${purge.scope === sc.v ? "border-red-300 bg-red-50 dark:border-red-400/40 dark:bg-red-500/10" : "border-slate-200 dark:border-white/10"}`}>
              <input type="radio" className="mt-1" checked={purge.scope === sc.v} onChange={() => setPurge({ ...purge, scope: sc.v })} /><span><b>{sc.t}</b><br /><span className="text-xs text-slate-500">{sc.d}</span></span>
            </label>))}</div>
        )}
        <div className="grid gap-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={purge.deleteFiles} onChange={(e) => setPurge({ ...purge, deleteFiles: e.target.checked })} />Hapus juga <b>berkas foto di Garage</b> milik data yang dihapus <span className="text-xs text-slate-500">(tidak bisa dibatalkan oleh restore database)</span></label>
          {!purge.onlyDemo && <label className="flex items-center gap-2"><input type="checkbox" checked={purge.deleteUsers} onChange={(e) => setPurge({ ...purge, deleteUsers: e.target.checked })} />Bersihkan cache identitas pengguna WO selain akun Admin Anda</label>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={purge.backupFirst} onChange={(e) => setPurge({ ...purge, backupFirst: e.target.checked })} />Buat backup dulu <span className="text-xs text-slate-500">(sangat disarankan)</span></label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-56" placeholder="ketik: HAPUS DATA" value={purge.confirm} onChange={(e) => setPurge({ ...purge, confirm: e.target.value })} />
          <button className="btn-danger" disabled={!!busy || purge.confirm !== "HAPUS DATA"} onClick={() => run("purge", async () => {
            const r = await api("/admin/data/purge", { method: "POST", json: purge });
            setPurge({ ...purge, confirm: "" });
            return `Selesai: ${Object.values(r.deleted as Record<string, number>).reduce((a, b) => a + b, 0)} baris dihapus${r.removedFiles ? `, ${r.removedFiles} berkas foto` : ""}${r.backup ? ` · backup: ${r.backup}` : ""}`;
          })}>{busy === "purge" ? "Menghapus…" : purge.onlyDemo ? "Hapus data demo" : "Hapus data"}</button>
        </div>
      </section>

      <Section icon="sparkle" title="Data demo">
        <p className="text-sm text-slate-500">Memuat lead (internet & non-internet), penawaran dengan <b>semua status</b>, field report, follow-up, dan KPI contoh. Memakai <b>akun demo WO</b> (<code>mkt@…</code>) dan akun Admin Anda — <b>tidak membuat akun di CRM</b>. Setiap baris ditandai <b>demo</b>: <b>tidak pernah dikirim ke WO</b> (tidak membuat pelanggan atau order) dan tidak ditautkan otomatis ke pelanggan WO. Memuat ulang menggantikan data demo lama. Backup dibuat otomatis lebih dulu.</p>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-56" placeholder="ketik: MUAT DEMO" value={demoConfirm} onChange={(e) => setDemoConfirm(e.target.value)} />
          <button className="btn-ghost" disabled={!!busy || demoConfirm !== "MUAT DEMO"} onClick={() => run("demo", async () => {
            const r = await api("/admin/data/demo", { method: "POST", json: { confirm: demoConfirm } });
            setDemoConfirm("");
            return `Data demo dimuat: ${r.counts.leads} lead, ${r.counts.quotations} penawaran, ${r.counts.reports} report. Akun dipakai: ${r.people.map((p: any) => p.name).join(", ")}.${r.warnings.length ? ` Catatan: ${r.warnings.join(" ")}` : ""}`;
          })}>{busy === "demo" ? "Memuat…" : "Muat data demo"}</button>
        </div>
      </Section>

      {dq.length > 0 && (
        <Section icon="send" title="Uji sambung ke WO">
          <p className="text-sm text-slate-500">Penawaran demo <b>tidak pernah</b> dikirim ke WO kecuali lewat aksi ini. Yang dipilih dikirim dengan penanda <code>demo:true</code>: WO menandainya sebagai <b>uji sambung</b> (pelanggan/order/PR), menahan semua pengiriman keluarnya, dan menyediakan pembersihan terarah. Hanya penawaran berstatus Terkirim/Diterima/Ditolak/Kedaluwarsa/Batal yang bisa dikirim. Menghapus data demo CRM juga menghapus status uji ini — <b>bersihkan sisi WO lewat menu uji sambung di WO</b>.</p>
          <ul className="divide-y divide-slate-100 text-sm dark:divide-white/10">
            {dq.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
                <input type="checkbox" disabled={!x.sendable} checked={pick.includes(x.id)} onChange={(e) => setPick(e.target.checked ? [...pick, x.id] : pick.filter((i) => i !== x.id))} aria-label={`Pilih ${x.number}`} />
                <span className="font-medium">{x.number}</span><Badge>{x.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-slate-500">{x.customerName}</span>
                {x.testAt && !x.testError && <span className="text-xs text-emerald-600">terkirim {fmtDate(x.testAt)} sebagai {x.testStatus}{x.testNumber ? ` · ${x.testNumber}` : ""}{x.testRev !== x.rev ? " · revisi berubah sejak itu" : ""}</span>}
                {x.testError && <span className="text-xs text-red-600">gagal: {x.testError}</span>}
                {!x.sendable && <span className="text-xs text-slate-400">belum bisa dikirim</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-56" placeholder="ketik: KIRIM UJI" value={testConfirm} onChange={(e) => setTestConfirm(e.target.value)} />
            <button className="btn-ghost" disabled={!!busy || !pick.length || testConfirm !== "KIRIM UJI"} onClick={() => run("test", async () => {
              const r = await api("/admin/data/demo-quotations/send-test", { method: "POST", json: { ids: pick, confirm: testConfirm } });
              setTestConfirm(""); setPick([]);
              return r.results.map((x: any) => x.message).join(" · ");
            })}>{busy === "test" ? "Mengirim…" : `Kirim sebagai uji sambung (${pick.length})`}</button>
          </div>
        </Section>
      )}

      {restore && (
        <Modal title="Restore dari backup" onClose={() => setRestore(null)}>
          <div className="space-y-3 text-sm">
            <p><code className="break-all text-xs">{restore.name}</code></p>
            <p className="rounded-xl bg-amber-100 px-3 py-2 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Restore <b>mengganti seluruh data saat ini</b> dengan isi backup. Backup kondisi sekarang dibuat otomatis lebih dulu. Bila backup gagal dimuat, data tidak berubah (dibatalkan penuh). Akun Admin Anda tetap ada.</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={restore.includeSettings} onChange={(e) => setRestore({ ...restore, includeSettings: e.target.checked })} />Ikut pulihkan <b>pengaturan CRM</b></label>
            <input className="input" placeholder="ketik: RESTORE" value={restore.confirm} onChange={(e) => setRestore({ ...restore, confirm: e.target.value })} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setRestore(null)}>Batal</button>
              <button className="btn-danger" disabled={restore.confirm !== "RESTORE" || !!busy} onClick={() => { const r = restore; setRestore(null); run("restore", async () => { const x = await api(`/admin/data/backups/${r.name}/restore`, { method: "POST", json: { includeSettings: r.includeSettings, confirm: r.confirm } }); return `Restore selesai: ${x.rows} baris, ${x.tables} tabel. Backup kondisi sebelumnya: ${x.preBackup}`; }); }}>Restore sekarang</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
