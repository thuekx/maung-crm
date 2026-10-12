import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, phoneKey, phoneSuffix } from "./phone.js";

const e = (x: string) => normalizePhone(x).e164;

test("nomor Indonesia: semua bentuk menjadi 62…", () => {
  for (const x of ["0812-3456-7890", "+62 812 3456 7890", "62812 3456 7890", "0062 812 3456 7890", "(0812) 3456 7890", "81234567890"]) assert.equal(e(x), "6281234567890", x);
});

test("nomor luar negeri: kode negara apa pun tetap valid dan konsisten", () => {
  assert.equal(e("+60 12-345 6789"), "60123456789"); // Malaysia
  assert.equal(e("0060123456789"), "60123456789");
  assert.equal(e("60123456789"), "60123456789");
  assert.equal(e("+65 8123 4567"), "6581234567"); // Singapura
  assert.equal(e("+1 (415) 555-2671"), "14155552671"); // AS
  assert.equal(e("+44 20 7946 0958"), "442079460958"); // Inggris
  assert.equal(e("+81 90-1234-5678"), "819012345678"); // Jepang
});

test("wilayah bawaan dapat diubah lewat env; +/00 tetap menang", () => {
  process.env.PHONE_DEFAULT_REGION = "MY";
  try {
    assert.equal(e("012-345 6789"), "60123456789");
    assert.equal(e("+62 812 3456 7890"), "6281234567890");
  } finally { delete process.env.PHONE_DEFAULT_REGION; }
});

test("tidak valid: tidak dikarang; digit tetap tersedia untuk pencocokan persis", () => {
  const p = normalizePhone("0812");
  assert.equal(p.e164, null); assert.equal(p.valid, false);
  const q = normalizePhone("12345-ABC-678");
  assert.equal(q.valid, false); assert.equal(phoneKey(q), "12345678");
  assert.equal(normalizePhone(null).digits, "");
  assert.equal(normalizePhone("").valid, false);
});

test("sufiks 9 digit untuk saran lemah (nomor luar negeri tersimpan tanpa kode negara)", () => {
  assert.equal(phoneSuffix(normalizePhone("+60 12-345 6789")), "123456789");
  assert.equal(phoneSuffix(normalizePhone("012-3456789")), "123456789".length === 9 ? "123456789" : null);
});
