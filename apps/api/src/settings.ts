import { pool } from "./db.js";

/** Pengaturan CRM (tabel crm_settings). Tidak ikut terhapus oleh purge; ikut backup/restore bila dipilih. */
export interface QuotationSettings { taxRate: number; validDays: number; terms: string }
export const DEFAULT_TERMS = "Harga dalam Rupiah. Penawaran berlaku sampai tanggal yang tertera. Pekerjaan dimulai setelah penawaran disetujui dan pembayaran sesuai kesepakatan. Berita Acara ditandatangani setelah pekerjaan selesai.";
export const DEFAULTS = {
  quotation: { taxRate: 11, validDays: 14, terms: DEFAULT_TERMS } as QuotationSettings,
  woSync: { paused: false },
  backup: { autoDaily: true },
};
type Key = keyof typeof DEFAULTS;

export async function getSetting<K extends Key>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const r = await pool.query("SELECT value FROM crm_settings WHERE key=$1", [key]);
  return { ...DEFAULTS[key], ...(r.rows[0]?.value ?? {}) } as (typeof DEFAULTS)[K];
}
export async function putSetting<K extends Key>(key: K, value: (typeof DEFAULTS)[K], by: string) {
  await pool.query(`INSERT INTO crm_settings (key,value,updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now(), updated_by=$3`, [key, JSON.stringify(value), by]);
}
