"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout, token } from "@/lib/session";
import { useBranding } from "@/lib/brand";
import { useTheme, type ThemeChoice } from "@/lib/theme";

const TABS = [
  { href: "/", label: "Riwayat" },
  { href: "/new", label: "Report Baru" },
  { href: "/leads", label: "Lead" },
  { href: "/quotations", label: "Penawaran" },
  { href: "/catalog", label: "Katalog" },
  { href: "/map", label: "Peta" },
];
const THEMES: { v: ThemeChoice; label: string }[] = [
  { v: "light", label: "Terang" },
  { v: "system", label: "Sistem" },
  { v: "dark", label: "Gelap" },
];

export default function Nav() {
  const brand = useBranding();
  const path = usePathname() || "/";
  const { choice, set } = useTheme();
  const [back, setBack] = useState("Menu Utama");
  const [initial, setInitial] = useState("");

  useEffect(() => {
    const t = token();
    if (!t) return;
    const h = { authorization: `Bearer ${t}` };
    fetch("/api/launcher", { headers: h })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const l = d?.home?.backLabel; if (typeof l === "string" && l.trim()) setBack(l.trim().slice(0, 40)); })
      .catch(() => {});
    fetch("/api/auth/me", { headers: h })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const n = d?.user?.name ?? d?.name; if (typeof n === "string" && n) setInitial(n.trim().charAt(0).toUpperCase()); })
      .catch(() => {});
  }, []);

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-[1000] print:hidden">
      <div className="flex items-center gap-3 border-b-2 border-accent-500 bg-brand-900 px-4 py-2.5 text-white dark:bg-brand-950">
        {/* /apps milik WO (di luar basePath) → pakai <a>, bukan next/link */}
        <a href="/apps" className="text-sm text-white/80 hover:text-white">← {back}</a>
        <span className="flex items-center gap-2 font-display text-lg font-semibold">
          {brand.logoMarkUrl && <img src={brand.logoMarkUrl} alt="" className="h-6 w-6 rounded" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
          CRM
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select aria-label="Tema" className="rounded-md border border-white/20 bg-transparent px-1.5 py-1 text-xs text-white" value={choice} onChange={(e) => set(e.target.value as ThemeChoice)}>
            {THEMES.map((t) => <option key={t.v} value={t.v} className="text-slate-800">{t.label}</option>)}
          </select>
          {initial && <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500 text-xs font-bold text-brand-900">{initial}</span>}
          <button className="text-sm text-white/80 hover:text-white" onClick={logout}>Keluar</button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={active(t.href) ? "menu-item menu-item-active" : "menu-item"}>{t.label}</Link>
        ))}
      </nav>
    </header>
  );
}
