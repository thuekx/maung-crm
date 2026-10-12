"use client";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { Badge, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";

// Popup dirakit dari node DOM: data pengguna (area, nama PIC, caption) selalu menjadi teks, tidak pernah HTML.
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; };
const popup = (...parts: (Node | string)[]) => { const d = node("div"); parts.forEach((x) => d.append(x)); return d; };
const reportLink = (id: number) => { const a = node("a", "Buka report"); a.setAttribute("href", `/crm/reports/${Number(id)}`); return a; };
const safeImg = (src: string) => { const i = node("img"); if (src.startsWith("/crm/api/")) i.setAttribute("src", src); i.width = 160; return i; };

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState("Memuat…");
  useEffect(() => {
    let map: any;
    (async () => {
      const [L, data] = await Promise.all([import("leaflet"), api("/map")]);
      if (!el.current) return;
      map = L.map(el.current).setView([-6.9, 107.6], 9);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin" } as import("leaflet").TileLayerOptions).addTo(map);
      const pts: [number, number][] = [];
      const color = (s: string) => (s === "VERIFIED" ? "#16a34a" : "#d97706");
      for (const r of data.reports) {
        pts.push([r.lat, r.lng]);
        L.circleMarker([r.lat, r.lng], { radius: 9, color: color(r.locationStatus), fillOpacity: 0.7 }).addTo(map)
          .bindPopup(popup(node("b", String(r.activityType)), ` ${r.area ?? ""}`, node("br"), String(r.pics ?? ""), node("br"), r.locationStatus === "VERIFIED" ? "GPS Verified" : "Location Unverified", node("br"), reportLink(r.id)));
      }
      for (const p of data.photos) {
        pts.push([p.lat, p.lng]);
        L.circleMarker([p.lat, p.lng], { radius: 5, color: color(p.locationStatus), fillOpacity: 0.9 }).addTo(map)
          .bindPopup(popup(safeImg(String(p.thumbUrl)), node("br"), String(p.caption ?? ""), node("br"), reportLink(p.reportId)));
      }
      if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
      setInfo(`${data.reports.length} report · ${data.photos.length} foto dengan koordinat`);
    })().catch((e) => setInfo(e.message));
    return () => map?.remove();
  }, []);
  return (
    <div className="space-y-4">
      <PageHeader icon="map" title="Peta Aktivitas" subtitle={info} />
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="chip"><span className="h-2.5 w-2.5 rounded-full bg-green-600" />GPS Verified</span>
        <span className="chip"><span className="h-2.5 w-2.5 rounded-full bg-amber-600" />Unverified</span>
        <Badge tone="slate">titik besar = report · titik kecil = foto</Badge>
      </div>
      {/* isolate: z-index internal Leaflet tidak menimpa bilah navigasi */}
      <div className="isolate overflow-hidden rounded-2xl border border-slate-200 shadow-card dark:border-white/10"><div ref={el} className="h-[68vh] w-full md:h-[72vh]" /></div>
    </div>
  );
}
