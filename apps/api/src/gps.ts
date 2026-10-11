export type GpsSource = "LIVE" | "EXIF" | "UPLOAD" | "MANUAL";
export interface GpsInput { lat?: number | null; lng?: number | null; accuracy?: number | null; at?: Date | null; source?: GpsSource | null }

export const validCoords = (lat?: number | null, lng?: number | null) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * VERIFIED hanya untuk GPS LIVE (dibaca saat aksi, bukan saat submit) dengan koordinat valid, accuracy,
 * dan waktu baca dekat waktu pengambilan. EXIF/UPLOAD/MANUAL tidak pernah VERIFIED.
 * Catatan: server tidak dapat membuktikan klaim LIVE dari klien; ini kontrol kebijakan, bukan anti-spoof.
 */
export function locationStatus(g: GpsInput, takenAt: Date, maxSkewMs = 120_000): "VERIFIED" | "UNVERIFIED" {
  if (g.source !== "LIVE") return "UNVERIFIED";
  if (!validCoords(g.lat, g.lng)) return "UNVERIFIED";
  if (typeof g.accuracy !== "number" || !Number.isFinite(g.accuracy) || g.accuracy < 0) return "UNVERIFIED";
  if (!g.at || Math.abs(takenAt.getTime() - g.at.getTime()) > maxSkewMs) return "UNVERIFIED";
  return "VERIFIED";
}
