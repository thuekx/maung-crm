/** Turunan skala warna dari satu warna dasar (dipakai Tailwind lewat CSS variable). Algoritma sama dipakai skrip init di <head>. */
export const TINT: Record<'brand' | 'accent', { tints: Record<number, number>; shades: Record<number, number> }> = {
  brand: { tints: { 50: 0.95, 100: 0.88, 200: 0.75, 300: 0.58, 400: 0.4, 500: 0.24, 600: 0.12, 700: 0.06, 800: 0.02 }, shades: { 950: 0.35 } },
  accent: { tints: { 50: 0.92, 100: 0.84, 200: 0.66, 300: 0.45, 400: 0.22 }, shades: { 600: 0.12, 700: 0.28, 800: 0.42, 900: 0.54, 950: 0.68 } },
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

/** { '50': '236 243 255', ..., '900': base } — format channel untuk `rgb(var(--x) / alpha)`. */
export function colorScale(hex: string, kind: 'brand' | 'accent'): Record<string, string> {
  const base = rgb(hex), t = TINT[kind], out: Record<string, string> = {};
  for (const n of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
    const c = n in t.tints ? mix(base, [255, 255, 255], t.tints[n]) : n in t.shades ? mix(base, [0, 0, 0], t.shades[n]) : base;
    out[String(n)] = c.join(' ');
  }
  return out;
}

export function cssVars(primary: string, accent: string) {
  const v: Record<string, string> = {};
  for (const [k, hex] of [['brand', primary], ['accent', accent]] as const) for (const [n, c] of Object.entries(colorScale(hex, k))) v[`--${k}-${n}`] = c;
  v['--brand-hex'] = primary; v['--accent-hex'] = accent;
  return v;
}
