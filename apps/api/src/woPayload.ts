import { detail } from "./quotations.js";

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
export function quotationWoPayload(q: Q) {
  const status = WO_STATUS[q.status];
  if (!status) return null;
  if (!q.marketingUserId || !q.marketingName) throw new Error(`Penawaran ${q.number}: jejak marketing (id + nama) hilang — tidak dikirim`);
  return {
    crmId: String(q.id), number: q.number, rev: q.rev, status,
    validUntil: q.validUntil, sentAt: q.sentAt, decidedAt: q.decidedAt, lostReason: status === "LOST" ? q.decisionNote ?? null : null,
    marketingUserId: q.marketingUserId, marketingName: q.marketingName,
    customer: { code: q.customerCode ?? null, name: q.customerName, phone: q.customerPhone, email: q.customerEmail, address: q.customerAddress, picName: q.picName },
    lines: q.lines.map((l) => ({ catalogCrmId: String(l.catalogId), sku: l.sku ?? null, name: l.name, kind: l.kind, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, note: l.note ?? null })),
    subtotal: q.subtotal, discount: q.discount, taxRate: q.taxRate, taxAmount: q.taxAmount, total: q.total, terms: q.terms,
  };
}
