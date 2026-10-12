"use client";
import { useEffect } from "react";

/** Mode tanam: kirim tinggi konten ke halaman induk (se-origin) tiap berubah, agar iframe pas tanpa scroll ganda. */
export default function EmbedHeight() {
  useEffect(() => {
    if (!document.documentElement.classList.contains("embed") || window.parent === window) return;
    let last = -1;
    const send = () => {
      const h = Math.ceil(document.body.getBoundingClientRect().height);
      if (h !== last) { last = h; window.parent.postMessage({ type: "maung-embed-height", height: h }, location.origin); }
    };
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, []);
  return null;
}
