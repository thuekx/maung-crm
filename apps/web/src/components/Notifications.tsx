"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { token } from "@/lib/session";
import { Icon } from "./icons";

export interface Notif { id: number; type: string; title: string; body: string | null; href: string | null; createdAt: string; readAt: string | null }
const POLL_MS = 60_000;

/** Status lonceng bersama (satu sumber untuk tombol desktop & mobile): polling ringan, juga saat tab kembali aktif. */
export function useNotifs() {
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    if (!token()) return;
    api("/notifications").then((d: any) => { setUnread(d.unread); setItems(d.items); }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    const vis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const markRead = async (ids?: number[]) => {
    await api("/notifications/read", { method: "POST", json: ids ? { ids } : {} }).catch(() => {});
    load();
  };
  return { unread, items, open, setOpen, markRead };
}
export type NotifState = ReturnType<typeof useNotifs>;

export function BellButton({ nf, cls }: { nf: NotifState; cls: string }) {
  return (
    <button className={`relative ${cls}`} aria-label={nf.unread ? `Notifikasi, ${nf.unread} belum dibaca` : "Notifikasi"} title="Notifikasi" aria-expanded={nf.open} onClick={() => nf.setOpen(!nf.open)}>
      <Icon name="bell" size={18} />
      {nf.unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{nf.unread > 99 ? "99+" : nf.unread}</span>}
    </button>
  );
}

const ago = (s: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 60_000));
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  if (m < 1440) return `${Math.round(m / 60)} jam lalu`;
  return `${Math.round(m / 1440)} hari lalu`;
};
const TONE: Record<string, string> = { TASK_OVERDUE: "text-red-500", WO_BLOCKED: "text-red-500", QUOTATION_RETURNED: "text-amber-500", QUOTATION_EXPIRING: "text-amber-500", REPORT_REVISION_REQUIRED: "text-amber-500" };

export function NotifPanel({ nf }: { nf: NotifState }) {
  const router = useRouter();
  if (!nf.open) return null;
  const go = (n: Notif) => { nf.setOpen(false); if (!n.readAt) void nf.markRead([n.id]); if (n.href) router.push(n.href); };
  return (
    <>
      <div className="fixed inset-0 z-[1100]" onClick={() => nf.setOpen(false)} />
      <div role="dialog" aria-label="Notifikasi" className="fixed inset-x-2 top-14 z-[1200] overflow-hidden rounded-xl bg-white text-sm text-slate-800 shadow-2xl ring-1 ring-black/5 md:inset-x-auto md:left-64 md:top-3 md:ml-2 md:w-96 dark:bg-brand-900 dark:text-slate-100 dark:ring-white/10">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-white/10">
          <span className="font-semibold">Notifikasi</span>
          <button className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-40 dark:text-accent-400" disabled={!nf.unread} onClick={() => nf.markRead()}>Tandai semua dibaca</button>
        </div>
        <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto dark:divide-white/10">
          {nf.items.length === 0 && <li className="px-4 py-8 text-center text-slate-500">Belum ada notifikasi.</li>}
          {nf.items.map((n) => (
            <li key={n.id}>
              <button className={`flex w-full gap-2.5 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/5 ${n.readAt ? "opacity-60" : ""}`} onClick={() => go(n)}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium ${TONE[n.type] ?? ""}`}>{n.title}</span>
                  {n.body && <span className="mt-0.5 block truncate text-xs text-slate-500">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-slate-400">{ago(n.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
