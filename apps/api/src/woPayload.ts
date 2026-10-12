import { detail } from "./quotations.js";
import { normalizePhone } from "./phone.js";

type Q = Awaited<ReturnType<typeof detail>>;

/** Status CRM → status di WO (hanya yang berarti bagi WO; selain itu tidak dikirim). */
export const WO_STATUS: Record<string, "QUOTED" | "WON" | "LOST"> = {
  SENT: "QUOTED", ACCEPTED: "WON", REJECTED: "LOST", EXPIRED: "LOST", CANCELLED: "LOST",
};

/**
 * Badan `PUT /api/integrations/crm/quotations/:crmId` (kontrak: docs/PERMINTAAN-PERUBAHAN-WO.md bagian B).
 * ATURAN JEJAK: `marketingUserId` (id pengguna WO) dan `marketingName` (snapshot nama saat dibuat) WAJIB ada di SETIAP permintaan —
 * diambil dari kolom permanen penawaran, bukan dari data pengguna WO saat ini (yang bisa nonaktif/berganti peran/dihapus).
 * Mengembalikan null bila status tidak perlu dikirim ke WO.
 */
export const PHONE_RE = /^[0-9+][0-9 +()-]*$/;
/** Telepon sesuai syarat WO (6–24 karakter; angka, spasi, + ( ) -). Mengembalikan teks yang dikirim atau null bila tidak memenuhi. */
export function woPhone(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (t.length >= 6 && t.length <= 24 && PHONE_RE.test(t)) return t;
  const p = normalizePhone(t);
  return p.e164 && `+${p.e164}`.length <= 24 ? `+${p.e164}` : null;
}
/** Syarat minimal WO atas data pelanggan penawaran — diperiksa di CRM (saat diajukan) agar tidak ditolak belakangan. */
export function woCustomerProblems(q: { customerName?: string | null; customerPhone?: string | null; customerAddress?: string | null; customerEmail?: string | null }): string[] {
  const out: string[] = [];
  if ((q.customerName ?? "").trim().length < 2) out.push("nama pelanggan (min. 2 huruf)");
  if (!woPhone(q.customerPhone)) out.push("nomor telepon yang valid");
  if ((q.customerAddress ?? "").trim().length < 5) out.push("alamat (min. 5 karakter)");
  if (q.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.customerEmail.trim())) out.push("email yang valid atau kosongkan");
  return out;
}

/**
 * Badan `PUT /api/integrations/crm/quotations/:crmId` (kontrak: docs/API.md repo WO, "Integrasi CRM → WO").
 * ATURAN JEJAK: `marketingUserId` (id pengguna WO) dan `marketingName` (snapshot nama saat dibuat) WAJIB ada di SETIAP permintaan —
 * diambil dari kolom permanen penawaran, bukan dari data pengguna WO saat ini (yang bisa nonaktif/berganti peran/dihapus).
 * Mengembalikan null bila status tidak perlu dikirim ke WO. `crmId` ada di URL (bukan badan).
 */
export function quotationWoPayload(q: Q, extra: { areaCode?: string | null } = {}) {
  const status = WO_STATUS[q.status];
  if (!status) return null;
  if (!q.marketingUserId || !q.marketingName) throw new Error(`Penawaran ${q.number}: jejak marketing (id + nama) hilang — tidak dikirim`);
  const phone = woPhone(q.customerPhone);
  if (!phone) throw new Error(`Penawaran ${q.number}: nomor telepon pelanggan tidak memenuhi syarat WO`);
  const email = q.customerEmail?.trim() || undefined;
  return {
    number: q.number, rev: q.rev, status,
    validUntil: q.validUntil ?? undefined, sentAt: q.sentAt ?? undefined, decidedAt: q.decidedAt ?? undefined,
    lostReason: status === "LOST" ? (q.decisionNote ?? (q.status === "EXPIRED" ? "Masa berlaku berakhir" : undefined)) : undefined,
    marketingUserId: q.marketingUserId, marketingName: q.marketingName,
    customer: { code: q.customerCode ?? undefined, name: q.customerName, phone, email, address: q.customerAddress ?? "", areaCode: extra.areaCode ?? undefined, picName: q.picName ?? undefined },
    lines: q.lines.map((l) => ({ catalogCrmId: `catalog-${l.catalogId}`, sku: l.sku ?? undefined, name: l.name, kind: l.kind, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, note: l.note ?? undefined })),
    total: q.total,
    taxNote: `PPN ${q.taxRate}%${q.discount > 0 ? `; diskon Rp ${Math.round(q.discount).toLocaleString("id-ID")}` : ""}`.slice(0, 200),
    terms: q.terms ? q.terms.slice(0, 2000) : undefined,
  };
}
