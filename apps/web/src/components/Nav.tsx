"use client";
import Link from "next/link";
import { logout } from "@/lib/session";

export default function Nav() {
  return (
    <nav className="sticky top-0 z-[1000] flex items-center gap-4 border-b bg-white px-4 py-3 text-sm">
      {/* /apps milik WO (di luar basePath) → pakai <a>, bukan next/link */}
      <a href="/apps" className="text-gray-600">← Beranda Maung</a>
      <b>CRM</b>
      <Link href="/">Riwayat</Link>
      <Link href="/new">Report Baru</Link>
      <Link href="/map">Peta</Link>
      <button className="ml-auto text-gray-600" onClick={logout}>Keluar</button>
    </nav>
  );
}
