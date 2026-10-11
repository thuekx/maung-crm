"use client";
import { useEffect } from "react";
import { keepAlive, toLogin, token } from "@/lib/session";

const EVERY_MS = 5 * 60_000; // perpanjang paling sering tiap ±5 menit, hanya bila pengguna aktif

/** Tanpa token → ke login WO. Selama pengguna aktif → keepAlive berkala (sesi diam WO 30 menit). */
export default function SessionGuard() {
  useEffect(() => {
    if (!token()) { toLogin(); return; }
    let lastActive = Date.now(), lastRefresh = Date.now();
    const mark = () => { lastActive = Date.now(); };
    const evs = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const tick = () => {
      const now = Date.now();
      if (now - lastRefresh >= EVERY_MS && now - lastActive < EVERY_MS) { lastRefresh = now; void keepAlive(); }
    };
    const iv = setInterval(tick, 30_000);
    const vis = () => { if (document.visibilityState === "visible") { mark(); tick(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { evs.forEach((e) => window.removeEventListener(e, mark)); clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return null;
}
