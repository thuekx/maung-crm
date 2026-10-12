export const rupiah = (n: number | string | null | undefined) => `Rp ${Math.round(Number(n ?? 0)).toLocaleString("id-ID")}`;
export const longDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "";
export const num = (v: string) => { const n = Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Pratinjau saja — angka resmi dihitung server. */
export function calc(lines: { qty: number; unitPrice: number }[], discount: number, taxRate: number) {
  const subtotal = r2(lines.reduce((s, l) => s + r2(l.qty * l.unitPrice), 0));
  const taxable = Math.max(0, r2(subtotal - discount)), tax = r2((taxable * taxRate) / 100);
  return { subtotal, tax, total: r2(taxable + tax) };
}
export const QSTATUS: Record<string, string> = {
  DRAFT: "Draft", PENDING_APPROVAL: "Menunggu persetujuan", APPROVED: "Disetujui", SENT: "Terkirim", ACCEPTED: "Diterima pelanggan", REJECTED: "Ditolak pelanggan", EXPIRED: "Kedaluwarsa", CANCELLED: "Dibatalkan",
};
export const qTone = (s: string) =>
  s === "ACCEPTED" ? "bg-green-100 text-green-700" : ["REJECTED", "CANCELLED", "EXPIRED"].includes(s) ? "bg-red-100 text-red-700" : s === "DRAFT" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700";
