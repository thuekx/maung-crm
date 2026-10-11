import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { storage } from "./storage.js";
import { API_BASE } from "./config.js";
import sharp from "sharp";

const SECRET = () => process.env.FILE_SIGN_SECRET ?? "dev-only-secret-ubah-di-produksi";
export const MAX_BYTES = 15 * 1024 * 1024;
const FORMATS = new Set(["jpeg", "png", "webp"]);

export function sign(id: number, variant: string, ttlSec = 600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac("sha256", SECRET()).update(`${id}.${variant}.${exp}`).digest("hex");
  return `${API_BASE}/photos/${id}/file?variant=${variant}&exp=${exp}&sig=${sig}`;
}

export function verifySig(id: number, variant: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const want = createHmac("sha256", SECRET()).update(`${id}.${variant}.${exp}`).digest();
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Validasi isi berkas sebenarnya (bukan header MIME klien). */
export async function validateImage(buf: Buffer) {
  if (buf.length > MAX_BYTES) throw Object.assign(new Error("Ukuran foto melebihi 15 MB"), { status: 400 });
  const m = await sharp(buf).metadata().catch(() => null);
  if (!m?.format || !FORMATS.has(m.format)) throw Object.assign(new Error("Format foto harus JPEG/PNG/WebP"), { status: 400 });
  return { mime: `image/${m.format}`, ext: m.format === "jpeg" ? "jpg" : m.format };
}

export async function saveFile(buf: Buffer, ext: string, mime: string) {
  const d = new Date();
  const key = [String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, "0"), `${randomUUID()}.${ext}`].join("/");
  await storage().put(key, buf, mime);
  return key;
}

/** Versi watermark dikompres (maks 2400px, JPEG q82); original disimpan apa adanya. */
export const compress = (buf: Buffer) =>
  sharp(buf).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
