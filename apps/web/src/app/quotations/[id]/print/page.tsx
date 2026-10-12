"use client";
import { use, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useBranding } from "@/lib/brand";
import { longDate, QSTATUS, rupiah } from "@/lib/money";
import { token } from "@/lib/session";

/** Penawaran A4 berkop WO. Kop = gambar latar penuh (Admin WO → Branding; bawaan /kop-surat-a4.jpg), ruang isi di antara logo dan alamat. */
const PAGE = { width: "210mm", height: "296mm", padding: "44mm 22mm 44mm", backgroundSize: "210mm 297mm", backgroundRepeat: "no-repeat" } as const;
// Perkiraan tinggi (mm) agar tabel tidak menembus area alamat kop. Ruang isi A4 = 296 − 44 − 44 = 208 mm.
const BODY = 208, HEAD_P1 = 78, TH = 6, TOTALS_MIN = 82;
const lines = (text: string, per: number) => String(text ?? "").split("\n").reduce((n, t) => n + Math.max(1, Math.ceil(t.length / per)), 0);
const rowMm = (l: any) => lines(l.name, 50) * 4.6 + (l.note ? lines(l.note, 60) * 4 : 0) + 1.6;

function chunk(rows: any[], tailMm: number) {
  const pages: any[][] = [[]]; let free = BODY - HEAD_P1 - TH;
  for (const l of rows) {
    const h = rowMm(l);
    if (h > free && pages.at(-1)!.length) { pages.push([]); free = BODY - TH; }
    pages.at(-1)!.push(l); free -= h;
  }
  return { pages, fitsTail: free >= tailMm };
}

export default function QuotationPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const brand = useBranding();
  const [q, setQ] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [kop, setKop] = useState("/kop-surat-a4.jpg");
  const [sign, setSign] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api(`/quotations/${id}`).then(setQ).catch((e) => setErr(e.message));
    const h = { authorization: `Bearer ${token() ?? ""}` };
    fetch("/api/subscription-settings", { headers: h }).then((r) => (r.ok ? r.json() : null)).then(setCfg).catch(() => {});
    fetch("/api/branding").then((r) => (r.ok ? r.json() : null)).then((b) => {
      const ok = (u: unknown) => (typeof u === "string" && u.startsWith("/") ? u : null);
      if (ok(b?.kopUrl)) setKop(b.kopUrl);
      setSign(ok(b?.mgrSignUrl));
    }).catch(() => {});
  }, [id]);
  useEffect(() => { document.body.classList.add("free-print"); return () => document.body.classList.remove("free-print"); }, []);
  useEffect(() => { if (q) { const prev = document.title; document.title = q.number.replace(/[\\/:*?"<>|]+/g, "-"); return () => { document.title = prev; }; } }, [q]);

  const layout = useMemo(() => (q ? chunk(q.lines, TOTALS_MIN + (lines(q.terms ?? "", 95) + lines(q.notes ?? "", 95)) * 4.2) : null), [q]);
  if (err) return <p className="p-6 text-red-600">{err}</p>;
  if (!q || !layout) return <p className="p-6 text-slate-500">Memuat…</p>;

  const official = ["APPROVED", "SENT", "ACCEPTED"].includes(q.status);
  const mark = official ? null : (QSTATUS[q.status] ?? q.status).toUpperCase();
  const pages = layout.pages;
  const all = layout.fitsTail ? pages : [...pages, []]; // ringkasan/syarat pindah ke halaman baru bila tidak muat
  let no = 0;
  const city = cfg?.city ?? "";
  return (
    <div className="min-h-screen bg-slate-200 py-4 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 0 } @media print { body { background: #fff !important } .qt-page:last-of-type { page-break-after: auto !important; break-after: auto !important } }`}</style>
      <div className="mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-2 print:hidden">
        <button className="btn-ghost" onClick={() => history.back()}>← Kembali</button>
        <span className="text-sm font-medium text-slate-600">{q.number}{q.rev > 1 ? ` rev ${q.rev}` : ""}</span>
        <button className="btn" onClick={() => window.print()}>🖨 Cetak / Simpan PDF</button>
      </div>
      <p className="mx-auto mb-3 max-w-[210mm] px-2 text-xs text-slate-500 print:hidden">Di jendela cetak: pilih <b>Simpan sebagai PDF</b>, ukuran <b>A4</b>, margin <b>Tidak ada</b>, dan centang <b>Grafik latar belakang</b> agar kop surat ikut tercetak.{!official && " Penawaran belum disetujui — halaman diberi tanda air."}</p>
      {all.map((rows, pi) => {
        const isFirst = pi === 0, isLast = pi === all.length - 1;
        return (
          <section key={pi} className="qt-page relative mx-auto mb-6 box-border bg-white text-[10.5pt] leading-snug text-black shadow-lg print:mb-0 print:shadow-none"
            style={{ ...PAGE, backgroundImage: `url(${kop})`, pageBreakAfter: "always", breakAfter: "page" }}>
            {mark && <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-[64pt] font-black uppercase text-slate-400/25" style={{ transform: "rotate(-30deg)" }}>{mark}</div>}
            {isFirst && (
              <div className="mb-3">
                <div className="text-center text-[14pt] font-bold tracking-wide">PENAWARAN HARGA</div>
                <div className="text-center text-[10pt]">No. {q.number}{q.rev > 1 ? ` (rev ${q.rev})` : ""}</div>
                <div className="mt-3 flex justify-between gap-4 text-[10pt]">
                  <div className="space-y-px">
                    <div>Kepada Yth.</div><div className="font-semibold">{q.customerName}</div>
                    {q.picName && <div>Up. {q.picName}</div>}
                    {q.customerAddress && <div className="max-w-[85mm]">{q.customerAddress}</div>}
                  </div>
                  <div className="text-right"><div>{city ? `${city}, ` : ""}{longDate(q.approvedAt ?? q.createdAt)}</div>{q.validUntil && <div>Berlaku s.d. {longDate(q.validUntil)}</div>}</div>
                </div>
                {q.subject && <div className="mt-2">Perihal: <b>{q.subject}</b></div>}
                <p className="mt-2">Dengan hormat, bersama ini kami sampaikan penawaran sebagai berikut:</p>
              </div>
            )}
            {rows.length > 0 && (
              <table className="w-full border-collapse text-[9.5pt]">
                <thead><tr className="bg-black text-white">
                  <th className="w-[8mm] border border-black px-1 py-0.5 text-center">No</th><th className="border border-black px-1 py-0.5 text-left">Deskripsi</th>
                  <th className="w-[16mm] border border-black px-1 py-0.5">Qty</th><th className="w-[28mm] border border-black px-1 py-0.5 text-right">Harga Satuan</th><th className="w-[30mm] border border-black px-1 py-0.5 text-right">Jumlah</th></tr></thead>
                <tbody>{rows.map((l: any) => (
                  <tr key={l.id} className="align-top">
                    <td className="border border-black px-1 py-0.5 text-center">{++no}</td>
                    <td className="border border-black px-1 py-0.5">{l.name}{l.note && <div className="text-[8.5pt] text-slate-700">{l.note}</div>}</td>
                    <td className="border border-black px-1 py-0.5 text-center">{l.qty} {l.unit}</td>
                    <td className="border border-black px-1 py-0.5 text-right">{rupiah(l.unitPrice)}</td>
                    <td className="border border-black px-1 py-0.5 text-right">{rupiah(l.qty * l.unitPrice)}</td></tr>))}</tbody>
              </table>
            )}
            {isLast && (
              <div className="mt-2 space-y-3 text-[10pt]">
                <div className="ml-auto w-[75mm] space-y-px">
                  <div className="flex justify-between"><span>Subtotal</span><span>{rupiah(q.subtotal)}</span></div>
                  {q.discount > 0 && <div className="flex justify-between"><span>Diskon</span><span>- {rupiah(q.discount)}</span></div>}
                  <div className="flex justify-between"><span>PPN {q.taxRate}%</span><span>{rupiah(q.taxAmount)}</span></div>
                  <div className="flex justify-between border-t border-black pt-px text-[11pt] font-bold"><span>TOTAL</span><span>{rupiah(q.total)}</span></div>
                </div>
                {q.terms && <div><b>Syarat &amp; Ketentuan</b><p className="whitespace-pre-wrap text-[9.5pt]">{q.terms}</p></div>}
                {q.notes && <div><b>Catatan</b><p className="whitespace-pre-wrap text-[9.5pt]">{q.notes}</p></div>}
                {cfg?.bankName && <div className="text-[9.5pt]">Pembayaran melalui transfer: <b>{cfg.bankName}</b> a.n. <b>{cfg.accName}</b>, No. Rek. <b>{cfg.accNo}</b></div>}
                <div className="flex justify-between pt-2 text-[10pt]">
                  <div className="w-[60mm] text-center"><div>Hormat kami,</div>
                    <div className="flex h-[22mm] items-center justify-center">{official && sign && <img src={sign} alt="" className="max-h-[20mm]" />}</div>
                    <div className="font-semibold underline">{cfg?.managerName ?? q.approvedByName ?? q.ownerName}</div><div className="text-[9pt]">{brand.companyName}</div></div>
                  <div className="w-[60mm] text-center"><div>Disetujui oleh pelanggan,</div><div className="h-[22mm]" /><div className="border-t border-black pt-px">{q.customerName}</div></div>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
