export interface GpsFix { lat: number; lng: number; accuracy: number; at: Date }

/** Baca GPS (high accuracy) tepat saat dibutuhkan. Mengembalikan null + alasan bila gagal — tidak pernah mengarang koordinat. */
export function readGps(timeoutMs = 15000): Promise<{ fix: GpsFix | null; error?: string }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ fix: null, error: "Perangkat tidak mendukung GPS" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date(p.timestamp) } }),
      (e) => resolve({ fix: null, error: e.code === 1 ? "Izin lokasi ditolak" : e.code === 3 ? "GPS timeout" : "Lokasi tidak tersedia" }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export interface WatermarkInfo { takenAt: Date; fix: GpsFix | null; area?: string; pics: string; activity: string }

/** Tempel panel watermark (tanggal/jam, area, PIC, GPS+accuracy) ke foto; hasil JPEG. Original tidak diubah. */
export async function watermark(file: File, info: WatermarkInfo): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0, w, h);
  const fs = Math.max(14, Math.round(w / 38));
  const lines = [
    `Marketing Field Activity · ${info.activity}`,
    info.takenAt.toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" }),
    ...(info.area ? [info.area] : []),
    `PIC: ${info.pics}`,
    info.fix
      ? `GPS: ${info.fix.lat.toFixed(6)}, ${info.fix.lng.toFixed(6)} · Accuracy: ±${Math.round(info.fix.accuracy)} m`
      : "GPS: tidak tersedia · Location Unverified",
  ];
  const pad = fs * 0.6, lh = fs * 1.3;
  const ph = lines.length * lh + pad * 2;
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(0, h - ph, w, ph);
  g.fillStyle = "#fff";
  g.font = `${fs}px sans-serif`;
  g.textBaseline = "top";
  lines.forEach((l, i) => g.fillText(l, pad, h - ph + pad + i * lh, w - pad * 2));
  if (info.fix) {
    g.fillStyle = "#16a34a";
    const tag = "GPS Verified";
    const tw = g.measureText(tag).width + pad * 2;
    g.fillRect(w - tw - pad, h - ph + pad * 0.6, tw, fs * 1.4);
    g.fillStyle = "#fff";
    g.fillText(tag, w - tw, h - ph + pad * 0.6 + fs * 0.2);
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Gagal membuat watermark"))), "image/jpeg", 0.85));
}
