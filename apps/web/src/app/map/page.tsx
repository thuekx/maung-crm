"use client";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { api } from "@/lib/api";

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState("Memuat…");
  useEffect(() => {
    let map: any;
    (async () => {
      const [L, data] = await Promise.all([import("leaflet"), api("/map")]);
      if (!el.current) return;
      map = L.map(el.current).setView([-6.9, 107.6], 9);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      const pts: [number, number][] = [];
      const color = (s: string) => (s === "VERIFIED" ? "#16a34a" : "#d97706");
      for (const r of data.reports) {
        pts.push([r.lat, r.lng]);
        L.circleMarker([r.lat, r.lng], { radius: 9, color: color(r.locationStatus), fillOpacity: 0.7 }).addTo(map)
          .bindPopup(`<b>${r.activityType}</b> ${r.area ?? ""}<br>${r.pics}<br>${r.locationStatus === "VERIFIED" ? "GPS Verified" : "Location Unverified"}<br><a href="/reports/${r.id}">Buka report</a>`);
      }
      for (const p of data.photos) {
        pts.push([p.lat, p.lng]);
        L.circleMarker([p.lat, p.lng], { radius: 5, color: color(p.locationStatus), fillOpacity: 0.9 }).addTo(map)
          .bindPopup(`<img src="${p.thumbUrl}" width="160"><br>${p.caption ?? ""}<br><a href="/reports/${p.reportId}">Buka report</a>`);
      }
      if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
      setInfo(`${data.reports.length} report · ${data.photos.length} foto dengan koordinat`);
    })().catch((e) => setInfo(e.message));
    return () => map?.remove();
  }, []);
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold">Map View</h1>
      <p className="text-xs text-gray-600">{info} · hijau = GPS Verified, oranye = Unverified</p>
      <div ref={el} className="h-[70vh] w-full rounded-xl" />
    </div>
  );
}
