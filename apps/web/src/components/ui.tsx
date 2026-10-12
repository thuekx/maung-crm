"use client";
import Link from "next/link";
import { Icon, type IconName } from "./icons";

export type Tone = "slate" | "amber" | "green" | "red" | "blue";

export function Badge({ tone = "slate", children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return <span className={`badge badge-${tone}`}>{dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{children}</span>;
}

/** Ikon bulat berwarna untuk ubin & judul bagian. */
export function IconChip({ name, tone = "blue", size = 18 }: { name: IconName; tone?: Tone | "accent"; size?: number }) {
  const cls: Record<string, string> = {
    blue: "bg-brand-900/10 text-brand-800 dark:bg-white/10 dark:text-white", accent: "bg-accent-100 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300",
    green: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400", amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400", slate: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
  };
  return <span className={`tile-ico ${cls[tone]}`}><Icon name={name} size={size} /></span>;
}

const AV = ["bg-brand-800 text-white", "bg-accent-500 text-brand-900", "bg-emerald-600 text-white", "bg-sky-600 text-white", "bg-violet-600 text-white", "bg-rose-600 text-white"];
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const t = (name || "?").trim();
  const ini = t.split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join("").toUpperCase() || "?";
  const h = [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % AV.length;
  return <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${AV[h]}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>{ini}</span>;
}

export function PageHeader({ icon, title, subtitle, action }: { icon: IconName; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="rise flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <IconChip name={icon} tone="accent" size={20} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-semibold text-brand-900 dark:text-white">{title}</h1>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function Section({ icon, title, aside, children, className = "" }: { icon?: IconName; title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card rise space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-900 dark:text-white">{icon && <IconChip name={icon} tone="slate" size={16} />}{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Empty({ icon, title, text, href, cta }: { icon: IconName; title: string; text?: string; href?: string; cta?: string }) {
  return (
    <div className="rise flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-white/15">
      <IconChip name={icon} tone="slate" size={22} />
      <b className="text-sm text-brand-900 dark:text-white">{title}</b>
      {text && <p className="max-w-xs text-xs text-slate-500">{text}</p>}
      {href && cta && <Link href={href} className="btn mt-1">{cta}</Link>}
    </div>
  );
}

/** Ubin angka KPI: ikon, nilai besar, keterangan; sorotan hanya bila perlu perhatian. */
export function Stat({ icon, label, value, sub, tone = "blue", href }: { icon: IconName; label: string; value: React.ReactNode; sub?: string; tone?: Tone | "accent"; href?: string }) {
  const body = (
    <div className={`card rise h-full ${tone === "amber" || tone === "red" ? "border-amber-300 dark:border-amber-400/40" : ""}`}>
      <div className="flex items-start justify-between gap-2"><span className="subheader leading-4">{label}</span><IconChip name={icon} tone={tone} size={16} /></div>
      <div className={`mt-1.5 font-display font-semibold text-brand-900 dark:text-white ${String(value).length > 10 ? "text-xl" : "text-2xl"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full transition active:scale-[.99]">{body}</Link> : body;
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string; icon?: IconName; count?: number }[] }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="tablist">
      {options.map((o) => (
        <button key={o.key} role="tab" aria-selected={value === o.key} onClick={() => onChange(o.key)} className={value === o.key ? "chip chip-active" : "chip"}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}{o.count != null && <span className="rounded-full bg-black/5 px-1.5 text-[10px] dark:bg-white/10">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const SearchField = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
  <div className="relative">
    <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
    <input className="input pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);
