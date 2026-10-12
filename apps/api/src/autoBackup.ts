import fs from "node:fs";
import { backupDir, createBackup, pruneAuto } from "./backup.js";
import { getSetting } from "./settings.js";

/** Backup otomatis harian (bawaan 02:30 waktu server; simpan 7 terakhir). Dapat dimatikan di Admin → Data & Backup. */
const AT_MIN = 2 * 60 + 30;
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

export async function autoBackupTick(now = new Date()): Promise<string | null> {
  if (!(await getSetting("backup")).autoDaily) return null;
  if (now.getHours() * 60 + now.getMinutes() < AT_MIN) return null;
  const done = fs.existsSync(backupDir()) && fs.readdirSync(backupDir()).some((n) => n.startsWith(`crm-auto-${today()}`));
  if (done) return null;
  const m = await createBackup({ kind: "auto", note: "otomatis harian" });
  pruneAuto(7);
  return m.name;
}

export function startAutoBackup() {
  const tick = () => autoBackupTick().then((n) => { if (n) console.log("[backup] otomatis dibuat:", n); }).catch((e) => console.error("[backup] otomatis gagal:", (e as Error).message));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}
