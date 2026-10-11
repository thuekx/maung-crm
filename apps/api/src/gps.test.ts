import test from "node:test";
import assert from "node:assert/strict";
import { locationStatus, validCoords } from "./gps.js";

const t = new Date("2026-10-09T03:35:00Z");
test("LIVE valid → VERIFIED", () => {
  assert.equal(locationStatus({ lat: -7.1, lng: 107.4, accuracy: 8, at: t, source: "LIVE" }, t), "VERIFIED");
});
test("MANUAL/EXIF/UPLOAD tidak pernah VERIFIED", () => {
  for (const source of ["MANUAL", "EXIF", "UPLOAD"] as const)
    assert.equal(locationStatus({ lat: -7.1, lng: 107.4, accuracy: 8, at: t, source }, t), "UNVERIFIED");
});
test("tanpa koordinat / accuracy / waktu → UNVERIFIED", () => {
  assert.equal(locationStatus({ source: "LIVE", at: t }, t), "UNVERIFIED");
  assert.equal(locationStatus({ lat: 1, lng: 1, source: "LIVE", at: t }, t), "UNVERIFIED");
  assert.equal(locationStatus({ lat: 1, lng: 1, accuracy: 5, source: "LIVE" }, t), "UNVERIFIED");
});
test("GPS basi (jauh dari waktu jepret) → UNVERIFIED", () => {
  assert.equal(locationStatus({ lat: 1, lng: 1, accuracy: 5, at: new Date(t.getTime() - 600_000), source: "LIVE" }, t), "UNVERIFIED");
});
test("validCoords menolak di luar rentang", () => {
  assert.equal(validCoords(91, 0), false);
  assert.equal(validCoords(0, 181), false);
  assert.equal(validCoords(NaN, 0), false);
  assert.equal(validCoords(-6.9, 107.6), true);
});
