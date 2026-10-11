// Menjaga aturan "tanpa HTML mentah" di frontend CRM: token Maung WO berbagi satu origin dengan CRM,
// jadi celah XSS di CRM = token WO bocor. Tes ini GAGAL bila ada API penyisip HTML mentah di apps/web/src.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN = [
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["innerHTML", /innerHTML/],
  ["outerHTML", /outerHTML/],
  ["insertAdjacentHTML", /insertAdjacentHTML/],
  ["document.write", /document\s*\.\s*write(ln)?\s*\(/],
];

/** Mengembalikan daftar { rule, line } pelanggaran pada sebuah teks sumber. */
export function scan(text) {
  const found = [];
  text.split("\n").forEach((ln, i) => FORBIDDEN.forEach(([rule, re]) => { if (re.test(ln)) found.push({ rule, line: i + 1 }); }));
  return found;
}

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?|mjs|cjs)$/.test(f) ? [p] : [];
});

test("pemindai mendeteksi pola terlarang (uji pemindai itu sendiri)", () => {
  assert.equal(scan("<div dangerouslySetInnerHTML={{ __html: x }} />")[0].rule, "dangerouslySetInnerHTML");
  assert.ok(scan("el.innerHTML = s").some((f) => f.rule === "innerHTML"));
  assert.ok(scan("el.outerHTML = s").some((f) => f.rule === "outerHTML"));
  assert.ok(scan("el.insertAdjacentHTML('beforeend', s)").some((f) => f.rule === "insertAdjacentHTML"));
  assert.ok(scan("document.write('<b>x</b>')").some((f) => f.rule === "document.write"));
  assert.deepEqual(scan("const t = node('div'); t.textContent = s;"), []);
});

test("apps/web/src tidak memakai API penyisip HTML mentah", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const files = walk(root);
  assert.ok(files.length > 5, "pemindaian harus menemukan berkas sumber");
  const bad = files.flatMap((f) => scan(readFileSync(f, "utf8")).map((x) => `${path.relative(root, f)}:${x.line} ${x.rule}`));
  assert.deepEqual(bad, [], "HTML mentah terlarang di frontend CRM:\n" + bad.join("\n"));
});
