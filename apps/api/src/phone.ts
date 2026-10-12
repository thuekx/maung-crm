import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Normalisasi nomor telepon ke E.164 TANPA "+" (mis. 628123456789, 60123456789, 6581234567) — kunci pencocokan Lead ↔ pelanggan WO.
 * Awalan "+" atau "00" = internasional apa adanya; awalan "0" = nasional negara bawaan (PHONE_DEFAULT_REGION, bawaan ID);
 * digit lain: bila diawali kode negara bawaan (62…) = internasional, selain itu nasional dulu lalu internasional.
 * Nomor luar negeri hanya andal bila ditulis dengan "+" atau "00" (tanpa itu bisa ambigu dengan nomor lokal); tidak pernah menebak negara.
 */
export interface Phone {
  /** E.164 tanpa "+", atau null bila tidak dapat ditafsirkan sebagai nomor valid. */
  e164: string | null;
  /** Hanya digit dari masukan (kunci cadangan: tetap bisa dicocokkan persis walau tidak valid). */
  digits: string;
  valid: boolean;
}

const callingCode = () => { try { return getCountryCallingCode(region()); } catch { return ""; } };
const region = () => ((process.env.PHONE_DEFAULT_REGION ?? "ID").toUpperCase() as CountryCode);

export function normalizePhone(raw: unknown): Phone {
  const s = typeof raw === "string" ? raw.trim() : "";
  const digits = s.replace(/\D/g, "");
  if (digits.length < 5) return { e164: null, digits, valid: false };
  const intl = s.startsWith("+") ? `+${digits}` : digits.startsWith("00") ? `+${digits.slice(2)}` : null;
  const tries: (() => ReturnType<typeof parsePhoneNumberFromString>)[] = [];
  if (intl) tries.push(() => parsePhoneNumberFromString(intl));
  else if (digits.startsWith("0")) tries.push(() => parsePhoneNumberFromString(digits, region()));
  else {
    // Tanpa "+"/"00"/"0": kode negara bawaan di depan (62…) = internasional; selain itu nasional dulu (staf mengetik 812…), lalu internasional.
    const cc = callingCode();
    const asIntl = () => parsePhoneNumberFromString(`+${digits}`);
    const asNational = () => parsePhoneNumberFromString(digits, region());
    tries.push(...(cc && digits.startsWith(cc) ? [asIntl, asNational] : [asNational, asIntl]));
  }
  for (const t of tries) {
    const p = t();
    if (p?.isValid()) return { e164: p.number.slice(1), digits, valid: true };
  }
  return { e164: null, digits, valid: false };
}

/** Kunci pembanding sebuah nomor: E.164 bila valid, jika tidak digit apa adanya. */
export const phoneKey = (p: Phone) => p.e164 ?? p.digits;

/** Sufiks 9 digit terakhir (kecocokan LEMAH, hanya untuk saran): menangkap nomor luar negeri di WO yang tersimpan tanpa kode negara. */
export const phoneSuffix = (p: Phone) => (p.digits.length >= 9 ? p.digits.slice(-9) : null);
