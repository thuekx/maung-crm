// Uji integrasi: Postgres sungguhan + Maung WO tiruan (introspect/login).
process.env.DATABASE_URL ??= "postgresql://postgres@localhost:5432/maung_crm_test";
process.env.UPLOAD_DIR = "/tmp/maung-crm-test-uploads";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

const USERS: Record<string, any> = {
  tNurman: { active: true, sub: "u-nurman", name: "Nurman", role: "MKT", subRole: "STAFF" },
  tRasyad: { active: true, sub: "u-rasyad", name: "Rasyad", role: "MKT", subRole: "STAFF" },
  tMgr: { active: true, sub: "u-mgr", name: "Manajer", role: "MKT", subRole: "MANAGER" },
  tNoc: { active: true, sub: "u-noc", name: "Noc", role: "NOC", subRole: "STAFF" },
};
let wo: http.Server, api: http.Server, base = "";
const { pool } = await import("./db.js");

before(async () => {
  wo = http.createServer((req, res) => {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (req.url === "/api/auth/introspect") {
      const u = USERS[t];
      res.statusCode = u ? 200 : 401;
      return void res.end(JSON.stringify(u ?? { active: false }));
    }
    if (req.url === "/api/auth/login") return void res.end(JSON.stringify({ token: "tNurman" }));
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => wo.listen(0, r));
  process.env.WO_URL = `http://localhost:${(wo.address() as AddressInfo).port}`;
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  const { migrate } = await import("./migrate.js");
  await migrate();
  const { createApp } = await import("./app.js");
  api = createApp().listen(0);
  await new Promise((r) => api.once("listening", r));
  base = `http://localhost:${(api.address() as AddressInfo).port}`;
});
after(async () => { wo.close(); api.close(); await pool.end(); });

const call = (token: string | null, method: string, path: string, body?: unknown) =>
  fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const png = (c = "#336699") => sharp({ create: { width: 64, height: 48, channels: 3, background: c } }).png().toBuffer();
async function photo(token: string, id: number, fields: Record<string, string>, buf?: Buffer, wm = true) {
  const f = new FormData();
  f.set("original", new Blob([new Uint8Array(buf ?? (await png()))]), "o.png");
  if (wm) f.set("watermark", new Blob([new Uint8Array(await png("#993366"))]), "w.png");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return fetch(`${base}/api/reports/${id}/photos`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: f });
}

test("login diteruskan ke WO; tanpa token 401; divisi lain 403", async () => {
  const l = await call(null, "POST", "/api/auth/login", { username: "x", password: "y" });
  assert.equal((await l.json()).token, "tNurman");
  assert.equal((await call(null, "GET", "/api/me")).status, 401);
  assert.equal((await call("salah", "GET", "/api/me")).status, 401);
  assert.equal((await call("tNoc", "GET", "/api/me")).status, 403);
  const me = await (await call("tMgr", "GET", "/api/me")).json();
  assert.equal(me.reviewer, true);
  await call("tRasyad", "GET", "/api/me"); // mengisi cache PIC
});

let rid = 0;
test("report multi-PIC dengan banyak hasil diskusi", async () => {
  const r = await call("tNurman", "POST", "/api/reports", {
    activityType: "CANVASSING", counterpart: "Pengurus BUMDes", area: "Panundaan", summary: "Kunjungan BUMDes",
    picIds: ["u-nurman", "u-rasyad"],
    items: { discussion: ["a", "b", "c"], agreement: ["fee sampai Juni"], issues: [] },
  });
  assert.equal(r.status, 201);
  const d = await r.json();
  rid = d.id;
  assert.deepEqual(d.pics.map((p: any) => p.name), ["Nurman", "Rasyad"]);
  assert.equal(d.items.discussion.length, 3);
  assert.equal(d.checkin, null);
  assert.equal((await call("tNurman", "POST", "/api/reports", { activityType: "X" })).status, 400);
  assert.equal((await call("tNurman", "POST", "/api/reports", { activityType: "SURVEY", picIds: ["tidak-ada"] })).status, 400);
});

test("RBAC: staff lain tidak melihat; PIC & reviewer melihat", async () => {
  const solo = await (await call("tNurman", "POST", "/api/reports", { activityType: "SURVEY" })).json();
  assert.equal((await call("tRasyad", "GET", `/api/reports/${solo.id}`)).status, 403);
  assert.equal((await call("tRasyad", "GET", `/api/reports/${rid}`)).status, 200);
  assert.equal((await call("tMgr", "GET", `/api/reports/${solo.id}`)).status, 200);
  const list = await (await call("tRasyad", "GET", "/api/reports")).json();
  assert.ok(list.every((x: any) => x.id !== solo.id));
});

test("check-in LIVE → VERIFIED; MANUAL → UNVERIFIED; audit mencatat perubahan lokasi", async () => {
  const live = { lat: -7.1, lng: 107.4, accuracy: 8, at: new Date().toISOString(), source: "LIVE" };
  assert.equal((await (await call("tNurman", "POST", `/api/reports/${rid}/checkin`, live)).json()).locationStatus, "VERIFIED");
  assert.equal((await (await call("tNurman", "POST", `/api/reports/${rid}/checkin`, { ...live, source: "MANUAL" })).json()).locationStatus, "UNVERIFIED");
  assert.equal((await call("tNurman", "POST", `/api/reports/${rid}/checkin`, { ...live, lat: 999 })).status, 400);
  const a = await pool.query("SELECT * FROM audit_log WHERE entity='field_report' AND entity_id=$1 AND action='CHECKIN' ORDER BY id", [rid]);
  assert.equal(a.rowCount, 2);
  assert.equal(a.rows[1].before.source, "LIVE");
  await call("tNurman", "POST", `/api/reports/${rid}/checkin`, live);
});

test("foto: live tersimpan lengkap; galeri tanpa GPS UNVERIFIED; GPS dikarang ditolak; bukan gambar ditolak", async () => {
  const now = new Date().toISOString();
  const ok = await photo("tNurman", rid, { source: "LIVE", lat: "-7.1", lng: "107.4", accuracy: "8", gpsAt: now, takenAt: now, caption: "BUMDes" });
  assert.equal((await ok.json()).locationStatus, "VERIFIED");
  const gal = await photo("tNurman", rid, { takenAt: now });
  assert.equal((await gal.json()).locationStatus, "UNVERIFIED");
  const exif = await photo("tNurman", rid, { source: "EXIF", lat: "-7.2", lng: "107.5", takenAt: now });
  assert.equal((await exif.json()).locationStatus, "UNVERIFIED");
  assert.equal((await photo("tNurman", rid, { source: "LIVE", takenAt: now })).status, 400);
  assert.equal((await photo("tNurman", rid, { lat: "1", lng: "1" })).status, 400);
  assert.equal((await photo("tNurman", rid, { takenAt: now }, Buffer.from("<html>bukan gambar</html>"))).status, 400);

  const d = await (await call("tMgr", "GET", `/api/reports/${rid}`)).json();
  assert.equal(d.photos.length, 3);
  const p = d.photos.find((x: any) => x.caption === "BUMDes");
  assert.equal(p.lat, -7.1); assert.equal(p.accuracy, 8); assert.equal(p.source, "LIVE");
  const o = await fetch(base + p.originalUrl), w = await fetch(base + p.watermarkUrl);
  assert.equal(o.status, 200); assert.equal(w.status, 200);
  assert.equal(w.headers.get("content-type"), "image/jpeg");
  assert.notDeepEqual(Buffer.from(await o.arrayBuffer()), Buffer.from(await w.arrayBuffer()));
  assert.equal((await fetch(base + p.originalUrl.replace(/sig=.{4}/, "sig=0000"))).status, 403);
  assert.equal((await fetch(base + `/api/photos/${p.id}/file?variant=original`)).status, 403);
});

test("Map View hanya koordinat valid; staff hanya miliknya", async () => {
  const m = await (await call("tRasyad", "GET", "/api/map")).json();
  assert.equal(m.reports.length, 1);
  assert.equal(m.photos.length, 2); // galeri tanpa GPS tidak muncul
  assert.ok(m.photos.every((p: any) => typeof p.lat === "number"));
});

test("follow-up task wajib PIC & due date; overdue; status", async () => {
  assert.equal((await call("tNurman", "POST", `/api/reports/${rid}/tasks`, { title: "Hitung fee" })).status, 400);
  const t = await call("tNurman", "POST", `/api/reports/${rid}/tasks`, { title: "Kirim proposal", picUserId: "u-rasyad", dueDate: "2020-01-01" });
  assert.equal(t.status, 201);
  const mine = await (await call("tRasyad", "GET", "/api/tasks")).json();
  assert.equal(mine.length, 1); assert.equal(mine[0].overdue, true);
  const id = mine[0].id;
  assert.equal((await call("tRasyad", "PATCH", `/api/tasks/${id}`, { status: "DONE" })).status, 200);
  assert.equal((await (await call("tRasyad", "GET", "/api/tasks")).json())[0].overdue, false);
});

test("submit: wajib summary, lalu terkunci", async () => {
  const empty = await (await call("tNurman", "POST", "/api/reports", { activityType: "MEETING" })).json();
  assert.equal((await call("tNurman", "POST", `/api/reports/${empty.id}/submit`)).status, 400);
  const s = await call("tNurman", "POST", `/api/reports/${rid}/submit`);
  assert.equal((await s.json()).status, "SUBMITTED");
  assert.equal((await call("tNurman", "PUT", `/api/reports/${rid}`, { activityType: "MEETING" })).status, 409);
  assert.equal((await call("tNurman", "POST", `/api/reports/${rid}/checkin`, { lat: 1, lng: 1, at: new Date().toISOString(), source: "LIVE" })).status, 409);
});

test("soft delete", async () => {
  const d = await (await call("tNurman", "POST", "/api/reports", { activityType: "SURVEY" })).json();
  assert.equal((await call("tNurman", "DELETE", `/api/reports/${d.id}`)).status, 204);
  assert.equal((await call("tNurman", "GET", `/api/reports/${d.id}`)).status, 404);
  assert.equal((await pool.query("SELECT 1 FROM field_reports WHERE id=$1", [d.id])).rowCount, 1);
});
