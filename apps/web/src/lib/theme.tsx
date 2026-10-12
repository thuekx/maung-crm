"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Pilihan tema sama dengan WO: terang / sistem / gelap, kunci `maung_theme` (lama: `l1v_theme`).
export type ThemeChoice = "light" | "system" | "dark";
const KEY = "maung_theme";

const read = (): ThemeChoice => {
  try { const v = localStorage.getItem(KEY) ?? localStorage.getItem("l1v_theme"); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
};
const paint = (c: ThemeChoice) => {
  const dark = c === "dark" || (c === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
};

const Ctx = createContext<{ choice: ThemeChoice; set: (c: ThemeChoice) => void }>({ choice: "system", set: () => {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => { setChoice(read()); }, []);
  useEffect(() => {
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => paint("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  const set = useCallback((c: ThemeChoice) => {
    setChoice(c);
    try { localStorage.setItem(KEY, c); } catch { /* abaikan */ }
    paint(c);
  }, []);
  return <Ctx.Provider value={{ choice, set }}>{children}</Ctx.Provider>;
}
