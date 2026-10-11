"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setToken } from "@/lib/api";

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  if (path === "/login") return null;
  return (
    <nav className="sticky top-0 z-[1000] flex items-center gap-4 border-b bg-white px-4 py-3 text-sm">
      <b>Maung CRM</b>
      <Link href="/">Riwayat</Link>
      <Link href="/new">Report Baru</Link>
      <Link href="/map">Peta</Link>
      <button className="ml-auto text-gray-600" onClick={() => { setToken(null); router.push("/login"); }}>Keluar</button>
    </nav>
  );
}
