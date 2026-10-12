"use client";
import { useEffect, useState } from "react";
import { cssVars } from "./brandColors";

// Branding dibaca dari Maung WO (GET /api/branding, publik, satu domain): warna brand/aksen, nama, logo ikon.
export interface Branding { companyName: string; logoMarkUrl: string | null; colors: { primary: string; accent: string } }
export const DEFAULT_BRAND: Branding = { companyName: "MAUNG by LIV", logoMarkUrl: "/brand/logo-mark.webp", colors: { primary: "#0B1F3B", accent: "#F59E0B" } };
const CACHE = "maung_brand"; // kunci sama dengan WO → warna terakhir langsung terpasang (public/theme-init.js)

const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);

export function applyBrand(colors: Branding["colors"]) {
  for (const [k, v] of Object.entries(cssVars(colors.primary, colors.accent))) document.documentElement.style.setProperty(k, v);
  try { localStorage.setItem(CACHE, JSON.stringify({ p: colors.primary, a: colors.accent })); } catch { /* abaikan */ }
}

export function useBranding() {
  const [b, setB] = useState<Branding>(DEFAULT_BRAND);
  useEffect(() => {
    let live = true;
    fetch("/api/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        const next: Branding = {
          companyName: typeof d.companyName === "string" && d.companyName ? d.companyName : DEFAULT_BRAND.companyName,
          logoMarkUrl: typeof d.logoMarkUrl === "string" && d.logoMarkUrl.startsWith("/") ? d.logoMarkUrl : DEFAULT_BRAND.logoMarkUrl,
          colors: { primary: hex(d.colors?.primary, DEFAULT_BRAND.colors.primary), accent: hex(d.colors?.accent, DEFAULT_BRAND.colors.accent) },
        };
        applyBrand(next.colors);
        setB(next);
      })
      .catch(() => { /* WO tak terjangkau: tetap pakai bawaan */ });
    return () => { live = false; };
  }, []);
  return b;
}
