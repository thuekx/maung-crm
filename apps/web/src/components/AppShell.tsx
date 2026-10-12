"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { logout, token } from "@/lib/session";
import { useBranding } from "@/lib/brand";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { Icon, MarkM, type IconName } from "./icons";
import { Avatar } from "./ui";

interface Item { href: string; label: string; icon: IconName; short?: string; mobile?: boolean }
const ITEMS: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", mobile: true },
  { href: "/", label: "Aktivitas", icon: "clipboard", mobile: true },
  { href: "/new", label: "Report Baru", icon: "plus" },
  { href: "/leads", label: "Lead", icon: "target", mobile: true },
  { href: "/quotations", label: "Penawaran", icon: "file", mobile: true },
  { href: "/catalog", label: "Katalog", icon: "tag" },
  { href: "/map", label: "Peta", icon: "map", mobile: true },
];
const ADMIN_ITEMS: Item[] = [
  { href: "/admin/settings", label: "Pengaturan CRM", icon: "settings" },
  { href: "/admin/data", label: "Data & Backup", icon: "layers" },
];
const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { light: "system", system: "dark", dark: "light" };
const THEME_ICON: Record<ThemeChoice, IconName> = { light: "sun", system: "monitor", dark: "moon" };
const THEME_LABEL: Record<ThemeChoice, string> = { light: "Tema: terang", system: "Tema: ikuti sistem", dark: "Tema: gelap" };

export default function AppShell({ children }: { children: React.ReactNode }) {
  const brand = useBranding();
  const path = usePathname() || "/";
  const { choice, set } = useTheme();
  const [back, setBack] = useState("Menu Utama");
  const [me, setMe] = useState<any>(null); // profil dari WO (/api/auth/me)
  const [menu, setMenu] = useState(false);
  const name = me?.name ?? "";
  const [logoOk, setLogoOk] = useState(true);
  const [admin, setAdmin] = useState(false); // menu Admin hanya untuk Admin ASLI (bukan peran lain / "bertindak sebagai")

  useEffect(() => {
    const t = token();
    if (!t) return;
    const h = { authorization: `Bearer ${t}` };
    api("/me").then((m: any) => setAdmin(m?.role === "ADMIN" && !m?.acting)).catch(() => setAdmin(false));
    fetch("/api/launcher", { headers: h }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { const l = d?.home?.backLabel; if (typeof l === "string" && l.trim()) setBack(l.trim().slice(0, 40)); }).catch(() => {});
    fetch("/api/auth/me", { headers: h }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { const u = d?.user ?? d; if (u && typeof u.name === "string") setMe(u); }).catch(() => {});
  }, []);

  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/reports") : path.startsWith(href));
  const Logo = ({ size }: { size: number }) => (brand.logoMarkUrl && logoOk
    ? <img src={brand.logoMarkUrl} alt="" width={size} height={size} className="rounded-lg" onError={() => setLogoOk(false)} />
    : <MarkM size={size} />);
  const themeBtn = (cls: string) => (
    <button className={cls} aria-label={THEME_LABEL[choice]} title={THEME_LABEL[choice]} onClick={() => set(THEME_NEXT[choice])}><Icon name={THEME_ICON[choice]} size={18} /></button>
  );

  return (
    <div className="app-shell min-h-screen md:pl-60 print:pl-0">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-[1000] hidden w-60 flex-col bg-brand-900 text-white md:flex dark:bg-brand-950 print:hidden">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <Logo size={34} />
          <div><div className="font-display text-lg font-semibold leading-5">CRM</div><div className="text-[11px] text-white/60">Sales &amp; Field Activities</div></div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {ITEMS.map((i) => (
            <Link key={i.href} href={i.href} className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active(i.href) ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}>
              {active(i.href) && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-accent-500" />}
              <Icon name={i.icon} size={19} className={active(i.href) ? "text-accent-400" : ""} />{i.label}
            </Link>
          ))}
          {admin && (
            <>
              <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-white/40">Admin</div>
              {ADMIN_ITEMS.map((i) => (
                <Link key={i.href} href={i.href} className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active(i.href) ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}>
                  {active(i.href) && <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-accent-500" />}
                  <Icon name={i.icon} size={19} className={active(i.href) ? "text-accent-400" : ""} />{i.label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="space-y-2 border-t border-white/10 p-3">
          <a href="/apps" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white"><Icon name="chevronLeft" size={16} />{back}</a>
          <div className="flex items-center gap-2 px-1">
            <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 hover:bg-white/5" title="Profil saya">
              <Avatar name={name || "?"} size={34} url={me?.avatarUrl} />
              <span className="min-w-0"><span className="block truncate text-sm">{name || "…"}</span><span className="block truncate text-[10px] text-white/50">Profil &amp; password</span></span>
            </Link>
            {themeBtn("rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white")}
            <button className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Keluar" title="Keluar" onClick={logout}><Icon name="logout" size={18} /></button>
          </div>
        </div>
      </aside>

      {/* Bilah atas (mobile) */}
      <header className="sticky top-0 z-[1000] flex items-center gap-2 border-b-2 border-accent-500 bg-brand-900 px-3 py-2.5 text-white md:hidden dark:bg-brand-950 print:hidden">
        <a href="/apps" aria-label={back} title={back} className="rounded-lg p-1.5 text-white/80 hover:bg-white/10"><Icon name="chevronLeft" size={20} /></a>
        <Logo size={26} />
        <span className="font-display text-lg font-semibold">CRM</span>
        <div className="ml-auto flex items-center gap-1">
          {themeBtn("rounded-lg p-2 text-white/80 hover:bg-white/10")}
          <div className="relative">
            <button className="flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 hover:bg-white/10" onClick={() => setMenu(!menu)} aria-label="Menu pengguna" aria-expanded={menu}>
              <Avatar name={name || "?"} size={28} url={me?.avatarUrl} /><Icon name="chevronDown" size={14} className="text-white/70" />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-[1100]" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full z-[1200] mt-2 w-56 overflow-hidden rounded-xl bg-white text-sm text-slate-800 shadow-xl dark:bg-brand-900 dark:text-slate-100">
                  <div className="border-b border-slate-100 px-3 py-2 dark:border-white/10"><div className="truncate font-semibold">{name || "…"}</div><div className="truncate text-xs text-slate-500">{me?.email}</div></div>
                  <Link href="/profile" onClick={() => setMenu(false)} className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5"><Icon name="user" size={16} />Profil &amp; ganti password</Link>
                  <button onClick={logout} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5"><Icon name="logout" size={16} />Keluar</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:px-8 md:pb-10 md:pt-8 print:max-w-none print:p-0">{children}</main>

      {/* Bilah bawah (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-[1000] grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-white/10 dark:bg-brand-900/95 print:hidden" aria-label="Menu utama">
        {ITEMS.filter((i) => i.mobile).map((i) => (
          <Link key={i.href} href={i.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${active(i.href) ? "text-brand-900 dark:text-accent-400" : "text-slate-500"}`}>
            {active(i.href) && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-accent-500" />}
            <Icon name={i.icon} size={21} />{i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
