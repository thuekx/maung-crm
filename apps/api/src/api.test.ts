// Uji integrasi: Postgres sungguhan + Maung WO tiruan (GET /api/auth/me). API CRM di bawah /crm/api.
process.env.DATABASE_URL ??= "postgresql://postgres@localhost:5432/maung_crm_test";
process.env.UPLOAD_DIR = "/tmp/maung-crm-test-uploads";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

const USERS: Record<string, any> = {
  tNurman: { id: "u-nurman", name: "Nurman", email: "nurman@l1v.local", role: "MKT", subRole: "STAFF", features: ["app.crm", "wo.view"] },
  tRasyad: { id: "u-rasyad", name: "Rasyad", email: "rasyad@l1v.local", role: "MKT", subRole: "STAFF", features: ["app.crm"] },
  tMgr: { id: "u-mgr", name: "Manajer", email: "mgr@l1v.local", role: "MKT", subRole: "MANAGER", features: ["app.crm"] },
  tNoc: { id: "u-noc", name: "Noc", email: "noc@l1v.local", role: "NOC", subRole: "STAFF", features: ["wo.view"] },
  tMktTanpaAkses: { id: "u-mkt2", name: "Mkt Baru", email: "mkt2@l1v.local", role: "MKT", subRole: "STAFF", features: [] },
  tFin: { id: "u-fin", name: "Fin", email: "fin@l1v.local", role: "FIN", subRole: "STAFF", features: ["app.crm"] },
  tAdmin: { id: "u-admin", name: "Admin", email: "admin@l1v.local", role: "ADMIN", subRole: "STAFF", features: [] },
};
let wo: http.Server, api: http.Server, base = "";
// Export API WO tiruan: customers dibagi 2 halaman (cursor); packages/areas = 404 (belum ada di WO); kunci salah = 401.
const EXPORT_KEY = "k-test-export";
let exportData: Record<string, any[]> = {};
const exportMock = (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader("content-type", "application/json");
  if (req.headers["x-api-key"] !== EXPORT_KEY) { res.statusCode = 401; return void res.end("{}"); }
  const u = new URL(req.url!, "http://x");
  const rows = exportData[u.pathname.split("/").pop()!];
  if (!rows) { res.statusCode = 404; return void res.end("{}"); }
  const lim = Math.min(Number(u.searchParams.get("limit") ?? 1000), 2); // halaman kecil agar cursor teruji
  const start = Number(u.searchParams.get("cursor") ?? 0);
  const next = start + lim < rows.length ? String(start + lim) : null;
  res.end(JSON.stringify({ data: rows.slice(start, start + lim), nextCursor: next }));
};
const { pool } = await import("./db.js");

before(async () => {
  wo = http.createServer((req, res) => {
    const t = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (req.url === "/api/auth/me") {
      const u = USERS[t];
      res.statusCode = u ? 200 : 401;
      return void res.end(JSON.stringify(u ?? { error: "Belum login" }));
    }
    if (req.url?.startsWith("/api/export/")) return void exportMock(req, res);
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
  return fetch(`${base}/crm/api/reports/${id}/photos`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: f });
}

test("auth lewat /api/auth/me WO; gerbang app.crm; tanpa token 401", async () => {
  assert.equal((await call(null, "GET", "/crm/api/me")).status, 401);
  assert.equal((await call("salah", "GET", "/crm/api/me")).status, 401);
  assert.equal((await call("tNoc", "GET", "/crm/api/me")).status, 403); // tanpa fitur app.crm
  const gagal = await call("tMktTanpaAkses", "GET", "/crm/api/me"); // MKT tapi belum diberi hak "Aplikasi: CRM"
  assert.equal(gagal.status, 403);
  assert.match((await gagal.json()).error, /Hak Akses/);
  const me = await (await call("tMgr", "GET", "/crm/api/me")).json();
  assert.equal(me.reviewer, true); assert.ok(me.features.includes("app.crm"));
  assert.equal((await call("tAdmin", "GET", "/crm/api/me")).status, 200); // ADMIN selalu boleh
  assert.equal((await (await call("tFin", "GET", "/crm/api/me")).json()).reviewer, false); // fitur ada, bukan reviewer
  await call("tRasyad", "GET", "/crm/api/me"); // mengisi cache PIC
});

test("rute lama /api/* bukan milik CRM (milik WO) → 404", async () => {
  assert.equal((await call("tNurman", "GET", "/api/me")).status, 404);
  assert.equal((await call(null, "POST", "/api/auth/login", { email: "x", password: "y" })).status, 404);
  const h = await fetch(base + "/crm/api/health");
  assert.equal(h.status, 200);
  assert.equal(h.headers.get("x-content-type-options"), "nosniff");
});

let rid = 0;
test("report multi-PIC dengan banyak hasil diskusi", async () => {
  const r = await call("tNurman", "POST", "/crm/api/reports", {
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
  assert.equal((await call("tNurman", "POST", "/crm/api/reports", { activityType: "X" })).status, 400);
  assert.equal((await call("tNurman", "POST", "/crm/api/reports", { activityType: "SURVEY", picIds: ["tidak-ada"] })).status, 400);
});

test("RBAC: staff lain tidak melihat; PIC & reviewer melihat", async () => {
  const solo = await (await call("tNurman", "POST", "/crm/api/reports", { activityType: "SURVEY" })).json();
  assert.equal((await call("tRasyad", "GET", `/crm/api/reports/${solo.id}`)).status, 403);
  assert.equal((await call("tRasyad", "GET", `/crm/api/reports/${rid}`)).status, 200);
  assert.equal((await call("tMgr", "GET", `/crm/api/reports/${solo.id}`)).status, 200);
  const list = await (await call("tRasyad", "GET", "/crm/api/reports")).json();
  assert.ok(list.every((x: any) => x.id !== solo.id));
});

test("cakupan data: FIN ber-app.crm bukan reviewer → tidak melihat report orang lain; ADMIN melihat semua", async () => {
  const list = await (await call("tFin", "GET", "/crm/api/reports")).json();
  assert.equal(list.length, 0);
  assert.equal((await call("tFin", "GET", `/crm/api/reports/${rid}`)).status, 403);
  assert.ok((await (await call("tAdmin", "GET", "/crm/api/reports")).json()).length >= 1);
});

test("check-in LIVE → VERIFIED; MANUAL → UNVERIFIED; audit mencatat perubahan lokasi", async () => {
  const live = { lat: -7.1, lng: 107.4, accuracy: 8, at: new Date().toISOString(), source: "LIVE" };
  assert.equal((await (await call("tNurman", "POST", `/crm/api/reports/${rid}/checkin`, live)).json()).locationStatus, "VERIFIED");
  assert.equal((await (await call("tNurman", "POST", `/crm/api/reports/${rid}/checkin`, { ...live, source: "MANUAL" })).json()).locationStatus, "UNVERIFIED");
  assert.equal((await call("tNurman", "POST", `/crm/api/reports/${rid}/checkin`, { ...live, lat: 999 })).status, 400);
  const a = await pool.query("SELECT * FROM audit_log WHERE entity='field_report' AND entity_id=$1 AND action='CHECKIN' ORDER BY id", [rid]);
  assert.equal(a.rowCount, 2);
  assert.equal(a.rows[1].before.source, "LIVE");
  await call("tNurman", "POST", `/crm/api/reports/${rid}/checkin`, live);
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

  const d = await (await call("tMgr", "GET", `/crm/api/reports/${rid}`)).json();
  assert.equal(d.photos.length, 3);
  const p = d.photos.find((x: any) => x.caption === "BUMDes");
  assert.equal(p.lat, -7.1); assert.equal(p.accuracy, 8); assert.equal(p.source, "LIVE");
  const o = await fetch(base + p.originalUrl), w = await fetch(base + p.watermarkUrl);
  assert.equal(o.status, 200); assert.equal(w.status, 200);
  assert.equal(w.headers.get("content-type"), "image/jpeg");
  assert.notDeepEqual(Buffer.from(await o.arrayBuffer()), Buffer.from(await w.arrayBuffer()));
  assert.equal((await fetch(base + p.originalUrl.replace(/sig=.{4}/, "sig=0000"))).status, 403);
  assert.equal((await fetch(base + `/crm/api/photos/${p.id}/file?variant=original`)).status, 403);
});

test("Map View hanya koordinat valid; staff hanya miliknya", async () => {
  const m = await (await call("tRasyad", "GET", "/crm/api/map")).json();
  assert.equal(m.reports.length, 1);
  assert.equal(m.photos.length, 2); // galeri tanpa GPS tidak muncul
  assert.ok(m.photos.every((p: any) => typeof p.lat === "number"));
});

test("follow-up task wajib PIC & due date; overdue; status", async () => {
  assert.equal((await call("tNurman", "POST", `/crm/api/reports/${rid}/tasks`, { title: "Hitung fee" })).status, 400);
  const t = await call("tNurman", "POST", `/crm/api/reports/${rid}/tasks`, { title: "Kirim proposal", picUserId: "u-rasyad", dueDate: "2020-01-01" });
  assert.equal(t.status, 201);
  const mine = await (await call("tRasyad", "GET", "/crm/api/tasks")).json();
  assert.equal(mine.length, 1); assert.equal(mine[0].overdue, true);
  const id = mine[0].id;
  assert.equal((await call("tRasyad", "PATCH", `/crm/api/tasks/${id}`, { status: "DONE" })).status, 200);
  assert.equal((await (await call("tRasyad", "GET", "/crm/api/tasks")).json())[0].overdue, false);
});

test("submit: wajib summary, lalu terkunci", async () => {
  const empty = await (await call("tNurman", "POST", "/crm/api/reports", { activityType: "MEETING" })).json();
  assert.equal((await call("tNurman", "POST", `/crm/api/reports/${empty.id}/submit`)).status, 400);
  const s = await call("tNurman", "POST", `/crm/api/reports/${rid}/submit`);
  assert.equal((await s.json()).status, "SUBMITTED");
  assert.equal((await call("tNurman", "PUT", `/crm/api/reports/${rid}`, { activityType: "MEETING" })).status, 409);
  assert.equal((await call("tNurman", "POST", `/crm/api/reports/${rid}/checkin`, { lat: 1, lng: 1, at: new Date().toISOString(), source: "LIVE" })).status, 409);
});

test("soft delete", async () => {
  const d = await (await call("tNurman", "POST", "/crm/api/reports", { activityType: "SURVEY" })).json();
  assert.equal((await call("tNurman", "DELETE", `/crm/api/reports/${d.id}`)).status, 204);
  assert.equal((await call("tNurman", "GET", `/crm/api/reports/${d.id}`)).status, 404);
  assert.equal((await pool.query("SELECT 1 FROM field_reports WHERE id=$1", [d.id])).rowCount, 1);
});

test("cermin WO: tarik penuh berhalaman, paket/area turunan, pencocokan nomor (E.164 semua negara), baris hilang dihapus", async () => {
  const { runSync, syncStatus } = await import("./woSync.js");
  process.env.WO_EXPORT_API_KEY = "";
  assert.equal((await runSync()).skipped, "WO_EXPORT_API_KEY belum diisi"); // nonaktif tanpa kunci
  process.env.WO_EXPORT_API_KEY = "salah";
  const bad = await runSync();
  assert.equal(bad.ok, false); assert.match(bad.errors.customers, /401/);
  process.env.WO_EXPORT_API_KEY = EXPORT_KEY;
  exportData = {
    customers: [
      { code: "C1", name: "Budi", phone: "0812-3456-7890", status: "PROSPECT", radiusStatus: "WAITING", packageName: "Home 20", areaName: "Bekasi", salesName: "Nurman", createdAt: "2026-10-01T00:00:00Z", odp: "RAHASIA", ip: "10.0.0.1" },
      { code: "C2", name: "Siti", phone: "+62 812 3456 7890", status: "ACTIVE", radiusStatus: "ONLINE", packageName: "Home 20", areaName: "Bekasi", createdAt: "2026-01-01T00:00:00Z", activatedAt: "2026-01-05T00:00:00Z" },
      { code: "C3", name: "Lim", phone: "+65 8123 4567", status: "ACTIVE", packageName: "Biz 100", areaName: "Jakarta", createdAt: "2026-02-01T00:00:00Z" },
      { code: "C4", name: "Ahmad MY", phone: "012-3456789", status: "ACTIVE", packageName: "Biz 100", areaName: "Jakarta", createdAt: "2026-03-01T00:00:00Z" },
      { code: "C5", name: "Tanpa Nomor", phone: "", status: "ACTIVE", packageName: "Home 10", createdAt: "2026-03-01T00:00:00Z" },
    ],
    subscriptions: [{ regNo: "SM0260001", name: "Budi", phone: "081234567890", packageName: "Home 20", source: "RADIUS", marketingName: "Nurman", customerCode: "C1", woNumber: null, createdAt: "2026-10-01T00:00:00Z", installFee: 999999 }],
  };
  const r1 = await runSync();
  assert.deepEqual(r1, { ok: true, errors: {} });
  assert.equal((await pool.query("SELECT count(*)::int n FROM wo_customers")).rows[0].n, 5);
  assert.deepEqual((await pool.query("SELECT name FROM wo_packages ORDER BY name")).rows.map((x) => x.name), ["Biz 100", "Home 10", "Home 20"]);
  assert.deepEqual((await pool.query("SELECT name FROM wo_areas ORDER BY name")).rows.map((x) => x.name), ["Bekasi", "Jakarta"]);
  const st = await syncStatus();
  assert.equal(st.resources.find((x: any) => x.resource === "packages")!.mode, "derived");
  assert.ok(!JSON.stringify(st).includes(EXPORT_KEY)); // kunci tidak pernah keluar
  assert.equal((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='wo_customers' AND column_name IN ('odp','ip')")).rowCount, 0); // data jaringan tidak disalin

  // pencarian & pencocokan (butuh app.crm)
  assert.equal((await call("tMktTanpaAkses", "GET", "/crm/api/customers/lookup?phone=0812")).status, 403);
  const exact = await (await call("tNurman", "GET", "/crm/api/customers/lookup?phone=%2B62%20812-3456-7890")).json();
  assert.equal(exact.normalized, "6281234567890");
  assert.deepEqual(exact.exact.map((x: any) => x.code).sort(), ["C1", "C2"]); // 0812… dan +62812… = nomor yang sama
  const sg = await (await call("tNurman", "GET", "/crm/api/customers/lookup?phone=0065%208123%204567")).json();
  assert.deepEqual(sg.exact.map((x: any) => x.code), ["C3"]);
  const my = await (await call("tNurman", "GET", "/crm/api/customers/lookup?phone=%2B60%2012-345%206789")).json();
  assert.deepEqual(my.exact.map((x: any) => x.code), []); // C4 tersimpan tanpa kode negara → tidak otomatis
  assert.deepEqual(my.weak.map((x: any) => x.code), ["C4"]); // hanya saran lemah
  assert.equal((await call("tNurman", "GET", "/crm/api/customers/lookup?phone=12")).status, 400);
  const byName = await (await call("tNurman", "GET", "/crm/api/customers?q=sit")).json();
  assert.deepEqual(byName.map((x: any) => x.code), ["C2"]);
  assert.equal((await (await call("tNurman", "GET", "/crm/api/customers?q=%25")).json()).length, 0); // % tidak jadi wildcard
  const det = await (await call("tNurman", "GET", "/crm/api/customers/C1")).json();
  assert.equal(det.subscriptions[0].regNo, "SM0260001"); assert.ok(!("installFee" in det.subscriptions[0]));
  assert.equal((await call("tNurman", "GET", "/crm/api/customers/NOPE")).status, 404);
  assert.equal((await call("tNurman", "GET", "/crm/api/sync/status")).status, 403); // staf bukan reviewer
  assert.equal((await call("tMgr", "GET", "/crm/api/sync/status")).status, 200);
  assert.equal((await call("tMgr", "POST", "/crm/api/sync/run")).status, 403); // hanya Admin
  assert.equal((await call("tAdmin", "POST", "/crm/api/sync/run")).status, 200);

  // siklus berikutnya: C2 hilang & paket baru dari endpoint packages → cermin mengikuti WO (penuh)
  exportData.customers = exportData.customers.filter((c) => c.code !== "C2");
  exportData.packages = [{ name: "Home 20", kind: "INTERNET", speed: "20 Mbps", priceSell: 250000, active: true }, { name: "Sewa WiFi", kind: "SERVICE", unit: "bulan", priceSell: 100000, active: true }];
  exportData.areas = [{ id: "a1", code: null, name: "Pusat", active: false }, { id: "a2", code: null, name: "Cabang A", active: false }, { id: "a3", code: "BKS", name: "Bekasi", active: true }];
  exportData.packages.push({ name: "Home 10", description: null, speed: null, priceSell: null, active: true, source: "MANUAL" }); // paket manual lama: speed/harga null
  assert.equal((await runSync()).ok, true);
  assert.deepEqual((await pool.query("SELECT name, code FROM wo_areas ORDER BY name")).rows, [{ name: "Bekasi", code: "BKS" }]); // area nonaktif/contoh tidak masuk
  assert.deepEqual((await pool.query("SELECT kind, speed, price_sell FROM wo_packages WHERE name='Home 10'")).rows, [{ kind: "INTERNET", speed: null, price_sell: null }]);
  assert.equal((await pool.query("SELECT 1 FROM wo_customers WHERE code='C2'")).rowCount, 0);
  assert.deepEqual((await pool.query("SELECT name, kind, origin FROM wo_packages ORDER BY name")).rows, [{ name: "Home 10", kind: "INTERNET", origin: "EXPORT" }, { name: "Home 20", kind: "INTERNET", origin: "EXPORT" }, { name: "Sewa WiFi", kind: "SERVICE", origin: "EXPORT" }]);
  delete process.env.WO_EXPORT_API_KEY;
});

test("Lead: tautan otomatis (internet & layanan tambahan), ikut status WO, tahap manual, cakupan, E.164 luar negeri", async () => {
  const { runSync } = await import("./woSync.js");
  process.env.WO_EXPORT_API_KEY = EXPORT_KEY;
  const recent = new Date().toISOString(), old = "2026-01-01T00:00:00Z";
  const cust = (code: string, name: string, phone: string, status: string, createdAt: string, extra: any = {}) => ({ code, name, phone, status, createdAt, packageName: "Home 20", areaName: "Bekasi", ...extra });
  exportData = {
    customers: [
      cust("A1", "Baru Daftar", "0812-1110-0001", "PROSPECT", recent),
      cust("A2", "Lama Aktif", "0812-2220-0002", "ACTIVE", old, { activatedAt: old }),
      cust("A3", "Keluarga 1", "0812-3330-0003", "PROSPECT", recent),
      cust("A4", "Keluarga 2", "0812-3330-0003", "PROSPECT", recent),
      cust("A5", "Pelanggan CCTV", "+60 12-345 6789", "ACTIVE", old, { activatedAt: old }),
    ],
    subscriptions: [],
    "work-orders": [],
  };
  assert.equal((await runSync()).ok, true);
  const mk = (tok: string, b: any) => call(tok, "POST", "/crm/api/leads", b);

  // 1) internet, pendaftar baru → tertaut otomatis, tahap REGISTERED lalu mengikuti WO
  let r = await mk("tNurman", { kind: "INTERNET", name: "Pak Baru", phone: "+62 812 1110 0001", interest: "Home 20" });
  assert.equal(r.status, 201);
  let l1 = await r.json();
  assert.equal(l1.customerCode, "A1"); assert.equal(l1.linkState, "AUTO"); assert.equal(l1.stage, "REGISTERED");
  exportData.customers[0].status = "INSTALLING"; await runSync();
  assert.equal((await (await call("tNurman", "GET", `/crm/api/leads/${l1.id}`)).json()).stage, "INSTALLING");
  exportData.customers[0] = { ...exportData.customers[0], status: "ACTIVE", activatedAt: new Date().toISOString() }; await runSync();
  const won = await (await call("tNurman", "GET", `/crm/api/leads/${l1.id}`)).json();
  assert.equal(won.stage, "WON"); assert.ok(won.wonAt);
  assert.equal(won.events.at(-1).actorName, null); // otomatis (sinkron WO)

  // 2) internet tetapi nomor milik pelanggan LAMA yang aktif → bukan Won; ditandai existing; tidak tertaut otomatis
  l1 = await (await mk("tNurman", { kind: "INTERNET", name: "Sudah Pelanggan", phone: "081222200002" })).json();
  assert.equal(l1.existingCustomer, true); assert.equal(l1.customerCode, null); assert.equal(l1.stage, "NEW");
  assert.equal((await (await call("tNurman", "GET", `/crm/api/leads/${l1.id}/candidates`)).json()).exact[0].code, "A2");
  await call("tNurman", "POST", `/crm/api/leads/${l1.id}/link`, { customerCode: "A2" }); await runSync();
  const still = await (await call("tNurman", "GET", `/crm/api/leads/${l1.id}`)).json();
  assert.equal(still.linkState, "MANUAL"); assert.equal(still.stage, "NEW"); // pelanggan lama aktif ≠ kemenangan
  assert.equal((await call("tNurman", "POST", `/crm/api/leads/${l1.id}/stage`, { stage: "WON" })).status, 409); // won internet hanya mengikuti WO

  // 2b) WO Pasang Baru ditolak validasi teknis → lead internet Lost otomatis (alasan dari WO)
  exportData.customers.push(cust("A6", "Ditolak FOC", "0812-6660-0006", "PROSPECT", recent));
  await runSync();
  const rej = await (await mk("tNurman", { kind: "INTERNET", name: "Pak Tolak", phone: "081266600006" })).json();
  assert.equal(rej.customerCode, "A6"); assert.equal(rej.stage, "REGISTERED");
  exportData["work-orders"] = [{ number: "WO-NI-1", type: "NEW_INSTALL", status: "REJECTED", customerCode: "A6", createdAt: recent, updatedAt: recent, data: { rahasia: "x" } },
    { number: "WO-TS-1", type: "TROUBLE", status: "REJECTED", customerCode: "A6", createdAt: recent, updatedAt: recent }];
  await runSync();
  const lost = await (await call("tNurman", "GET", `/crm/api/leads/${rej.id}`)).json();
  assert.equal(lost.stage, "LOST"); assert.equal(lost.lostAuto, true); assert.match(lost.lostReason, /WO-NI-1 ditolak/);
  assert.equal((await pool.query("SELECT count(*)::int n FROM wo_work_orders")).rows[0].n, 1); // hanya NEW_INSTALL; data JSON WO tidak disalin

  // 3) nomor dipakai >1 pelanggan → tidak menebak, kandidat ditampilkan
  const amb = await (await mk("tNurman", { kind: "INTERNET", name: "Anak", phone: "0812 3330 0003" })).json();
  assert.equal(amb.customerCode, null); assert.equal(amb.candidates.exact.length, 2);

  // 4) layanan tambahan (non-internet) untuk pelanggan existing LUAR NEGERI → tertaut sejak awal, status pelanggan tak disentuh
  const cctv = await (await mk("tNurman", { kind: "NON_INTERNET", name: "Toko Ahmad", phone: "0060 12-345 6789", interest: "CCTV 4 titik" })).json();
  assert.equal(cctv.customerCode, "A5"); assert.equal(cctv.linkState, "AUTO"); assert.equal(cctv.stage, "NEW"); assert.equal(cctv.customer.status, "ACTIVE");
  for (const st of ["CONTACTED", "QUOTING", "NEGOTIATION"]) assert.equal((await call("tNurman", "POST", `/crm/api/leads/${cctv.id}/stage`, { stage: st })).status, 200);
  assert.equal((await call("tNurman", "POST", `/crm/api/leads/${cctv.id}/stage`, { stage: "LOST" })).status, 400); // alasan wajib
  assert.equal((await call("tNurman", "POST", `/crm/api/leads/${cctv.id}/stage`, { stage: "REGISTERED" })).status, 400); // bukan tahap non-internet

  // 5) duplikat nomor terbuka → peringatan (tetap dibuat)
  const dup = await (await mk("tRasyad", { kind: "NON_INTERNET", name: "Toko Ahmad 2", phone: "+60123456789" })).json();
  assert.ok(dup.duplicates.some((d: any) => d.id === cctv.id));

  // 6) cakupan: staf lain tak melihat; reviewer melihat; menutup & membuka kembali
  assert.equal((await call("tRasyad", "GET", `/crm/api/leads/${cctv.id}`)).status, 404);
  assert.ok((await (await call("tMgr", "GET", "/crm/api/leads")).json()).some((x: any) => x.id === cctv.id));
  assert.ok(!(await (await call("tRasyad", "GET", "/crm/api/leads")).json()).some((x: any) => x.id === cctv.id));
  assert.equal((await call("tNurman", "POST", `/crm/api/leads/${cctv.id}/stage`, { stage: "WON" })).status, 200);
  assert.equal((await call("tNurman", "POST", `/crm/api/leads/${cctv.id}/stage`, { stage: "QUOTING" })).status, 403); // buka kembali = reviewer
  assert.equal((await call("tMgr", "POST", `/crm/api/leads/${cctv.id}/stage`, { stage: "QUOTING" })).status, 200);
  assert.equal((await call("tNurman", "POST", `/crm/api/leads/${cctv.id}/stage`, { stage: "LOST", reason: "Harga" })).status, 200);

  // 7) validasi & akses
  assert.equal((await mk("tNurman", { kind: "INTERNET", name: "Tanpa Nomor" })).status, 400);
  assert.equal((await mk("tMktTanpaAkses", { kind: "INTERNET", name: "X", phone: "081234567890" })).status, 403);
  assert.equal((await call("tNurman", "DELETE", `/crm/api/leads/${cctv.id}`)).status, 403);
  const list = await (await call("tNurman", "GET", "/crm/api/leads?q=%2B62%20812%201110%200001")).json();
  assert.equal(list.length, 1); // cari lewat nomor (format apa pun)
  delete process.env.WO_EXPORT_API_KEY;
});

test("Katalog & penawaran: hitung total di server, alur status, revisi, kunci setelah diterima, lead ikut, cakupan", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);

  // katalog: hanya reviewer; nama tak boleh sama dengan paket INTERNET WO / duplikat
  assert.equal((await rq("tNurman", "POST", "/catalog", { name: "Sewa WiFi", kind: "SERVICE", unit: "bulan", price: 100000 })).s, 403);
  const wifi = (await rq("tMgr", "POST", "/catalog", { name: "Sewa WiFi", kind: "SERVICE", unit: "bulan", price: 100000 })).d.id;
  const cctv = (await rq("tMgr", "POST", "/catalog", { name: "CCTV Dome 2MP", kind: "PRODUCT", unit: "unit", price: 850000 })).d.id;
  const pasang = (await rq("tMgr", "POST", "/catalog", { name: "Jasa Instalasi CCTV", kind: "SERVICE", unit: "titik", price: 150000 })).d.id;
  assert.ok(wifi && cctv && pasang);
  // SKU opsional: tanpa SKU tetap sah; SKU unik (tak peka huruf) bila diisi; "" = hapus
  const sk = (await rq("tMgr", "POST", "/catalog", { name: "Router AX", sku: "RTR-AX-01", kind: "PRODUCT", unit: "unit", price: 500000 })).d.id;
  assert.equal((await rq("tMgr", "POST", "/catalog", { name: "Router AX2", sku: "rtr-ax-01", kind: "PRODUCT" })).s, 409);
  assert.equal((await rq("tMgr", "POST", "/catalog", { name: "Router Bad", sku: "bad sku!", kind: "PRODUCT" })).s, 400);
  const nosku = (await rq("tMgr", "GET", "/catalog?all=1")).d;
  assert.equal(nosku.find((c: any) => c.id === sk).sku, "RTR-AX-01"); assert.equal(nosku.find((c: any) => c.id === cctv).sku, null);
  assert.equal((await rq("tMgr", "PATCH", `/catalog/${sk}`, { sku: "" })).s, 200);
  assert.equal((await rq("tMgr", "GET", "/catalog?all=1")).d.find((c: any) => c.id === sk).sku, null);
  assert.equal((await rq("tMgr", "PATCH", `/catalog/${cctv}`, { sku: "CCTV-DOME-2MP" })).s, 200);
  const keep = (await rq("tMgr", "GET", "/catalog?all=1")).d.find((c: any) => c.id === cctv);
  assert.deepEqual([keep.price, keep.unit], [850000, "unit"]); // PATCH sebagian tidak mereset harga/satuan
  await rq("tMgr", "PATCH", `/catalog/${pasang}`, { active: true });
  assert.deepEqual((await rq("tMgr", "GET", "/catalog?all=1")).d.filter((c: any) => c.id === pasang).map((c: any) => [c.price, c.unit]), [[150000, "titik"]]);
  assert.equal((await rq("tMgr", "POST", "/catalog", { name: "home 20", kind: "SERVICE" })).s, 409); // = paket internet WO
  assert.equal((await rq("tMgr", "POST", "/catalog", { name: "SEWA wifi", kind: "SERVICE" })).s, 409); // duplikat (tak peka huruf)
  assert.equal((await rq("tNurman", "GET", "/catalog")).d.length >= 3, true);

  // lead non-internet (+ lead internet ditolak untuk penawaran)
  const lead = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Toko Maju", phone: "081377770001", interest: "CCTV 4 titik" })).d;
  const inet = (await rq("tNurman", "POST", "/leads", { kind: "INTERNET", name: "Pak Net", phone: "081377770002" })).d;
  assert.equal((await rq("tNurman", "POST", "/quotations", { leadId: inet.id })).s, 409);

  // buat penawaran: total dihitung server (klien tak dipercaya), nomor QT-yyy-0001
  const created = await rq("tNurman", "POST", "/quotations", {
    leadId: lead.id, taxRate: 11, discount: 50000,
    lines: [{ catalogId: cctv, qty: 4 }, { catalogId: pasang, qty: 4, unitPrice: 125000 }, { catalogId: wifi, qty: 12 }],
  });
  assert.equal(created.s, 201);
  const q = created.d;
  assert.match(q.number, /^QT-\d{3}-0001$/);
  // subtotal = 4*850000 + 4*125000 + 12*100000 = 3.400.000+500.000+1.200.000 = 5.100.000; −50.000; PPN 11% = 555.500; total 5.605.500
  assert.deepEqual([q.subtotal, q.taxAmount, q.total], [5100000, 555500, 5605500]);
  assert.equal(q.lines[0].sku, "CCTV-DOME-2MP"); assert.equal(q.lines[1].sku, null); // salinan SKU di baris (null = dipetakan manual)
  assert.equal(q.lines[1].unitPrice, 125000); assert.equal(q.lines[0].name, "CCTV Dome 2MP");
  assert.equal(q.lead.stage, "QUOTING"); // lead maju otomatis
  assert.equal((await rq("tNurman", "POST", "/quotations", { leadId: lead.id, discount: 1, lines: [{ catalogId: wifi, qty: 0 }] })).s, 400);
  assert.equal((await rq("tNurman", "POST", "/quotations", { leadId: lead.id, discount: 9e9, lines: [{ catalogId: wifi, qty: 1 }] })).s, 400); // diskon > subtotal

  // ubah (DRAFT), cakupan, harga katalog berubah tidak mengubah baris lama
  const upd = await rq("tNurman", "PUT", `/quotations/${q.id}`, { subject: "Paket CCTV 4 titik", picName: "Pak Haji", discount: 0 });
  assert.equal(upd.d.total, 5661000); // 5.100.000 × 1,11
  await rq("tMgr", "PATCH", `/catalog/${cctv}`, { price: 900000 });
  assert.equal((await rq("tNurman", "GET", `/quotations/${q.id}`)).d.lines[0].unitPrice, 850000);
  assert.equal((await rq("tRasyad", "GET", `/quotations/${q.id}`)).s, 404);
  assert.equal((await rq("tMgr", "POST", `/quotations/${q.id}/approve`)).s, 409); // belum diajukan
  assert.equal((await rq("tNurman", "POST", `/quotations/${q.id}/send`)).s, 409); // belum disetujui

  // alur persetujuan
  assert.equal((await rq("tNurman", "POST", `/quotations/${q.id}/submit`)).d.status, "PENDING_APPROVAL");
  assert.equal((await rq("tNurman", "PUT", `/quotations/${q.id}`, { subject: "x" })).s, 409); // terkunci selama menunggu
  assert.equal((await rq("tNurman", "POST", `/quotations/${q.id}/approve`)).s, 403); // staf bukan reviewer
  assert.equal((await rq("tMgr", "POST", `/quotations/${q.id}/return`)).s, 400); // alasan wajib
  assert.equal((await rq("tMgr", "POST", `/quotations/${q.id}/return`, { note: "Diskon terlalu besar" })).d.status, "DRAFT");
  await rq("tNurman", "POST", `/quotations/${q.id}/submit`);
  const ap = (await rq("tMgr", "POST", `/quotations/${q.id}/approve`)).d;
  assert.equal(ap.status, "APPROVED"); assert.equal(ap.approvedByName, "Manajer");
  const sent = (await rq("tNurman", "POST", `/quotations/${q.id}/send`)).d;
  assert.equal(sent.status, "SENT"); assert.ok(sent.sentAt); assert.equal(sent.lead.stage, "NEGOTIATION");

  // revisi: salinan tersimpan, kembali DRAFT, rev naik; tanpa alasan ditolak
  assert.equal((await rq("tNurman", "POST", `/quotations/${q.id}/revise`)).s, 400);
  const rev = (await rq("tNurman", "POST", `/quotations/${q.id}/revise`, { note: "Tambah 2 titik" })).d;
  assert.equal(rev.rev, 2); assert.equal(rev.status, "DRAFT"); assert.equal(rev.revisions.length, 1); assert.equal(rev.revisions[0].total, 5661000);
  await rq("tNurman", "PUT", `/quotations/${q.id}`, { lines: [{ catalogId: cctv, qty: 6 }, { catalogId: pasang, qty: 6 }] });
  await rq("tNurman", "POST", `/quotations/${q.id}/submit`); await rq("tMgr", "POST", `/quotations/${q.id}/approve`); await rq("tNurman", "POST", `/quotations/${q.id}/send`);

  // diterima → terkunci, lead Won
  const acc = (await rq("tNurman", "POST", `/quotations/${q.id}/accept`)).d;
  assert.equal(acc.status, "ACCEPTED"); assert.equal(acc.lead.stage, "WON");
  assert.equal((await rq("tNurman", "POST", `/quotations/${q.id}/revise`, { note: "x" })).s, 409);
  assert.equal((await rq("tNurman", "POST", `/quotations/${q.id}/cancel`, { note: "x" })).s, 409);
  assert.equal((await rq("tNurman", "PUT", `/quotations/${q.id}`, { subject: "x" })).s, 409);

  // kedaluwarsa otomatis & batal & ditolak
  const l2 = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Kantor B", phone: "081377770003" })).d;
  const q2 = (await rq("tNurman", "POST", "/quotations", { leadId: l2.id, validUntil: "2099-01-01", lines: [{ catalogId: wifi, qty: 1 }] })).d;
  assert.match(q2.number, /-0002$/);
  await rq("tNurman", "POST", `/quotations/${q2.id}/submit`); await rq("tMgr", "POST", `/quotations/${q2.id}/approve`); await rq("tNurman", "POST", `/quotations/${q2.id}/send`);
  await pool.query("UPDATE quotations SET valid_until='2020-01-01' WHERE id=$1", [q2.id]);
  assert.equal((await rq("tNurman", "GET", `/quotations/${q2.id}`)).d.status, "EXPIRED");
  assert.equal((await rq("tNurman", "POST", `/quotations/${q2.id}/revise`, { note: "Perpanjang" })).d.status, "DRAFT");
  assert.equal((await rq("tNurman", "POST", `/quotations/${q2.id}/cancel`)).s, 400); // alasan wajib
  assert.equal((await rq("tNurman", "POST", `/quotations/${q2.id}/cancel`, { note: "Batal" })).d.status, "CANCELLED");
  // masa berlaku lewat → tidak boleh dikirim
  const q3 = (await rq("tNurman", "POST", "/quotations", { leadId: l2.id, validUntil: "2020-01-01", lines: [{ catalogId: wifi, qty: 1 }] })).d;
  await rq("tNurman", "POST", `/quotations/${q3.id}/submit`); await rq("tMgr", "POST", `/quotations/${q3.id}/approve`);
  assert.equal((await rq("tNurman", "POST", `/quotations/${q3.id}/send`)).s, 409);
  // item katalog nonaktif tidak bisa diajukan/ditambah
  await rq("tMgr", "PATCH", `/catalog/${wifi}`, { active: false });
  assert.equal((await rq("tNurman", "POST", "/quotations", { leadId: l2.id, lines: [{ catalogId: wifi, qty: 1 }] })).s, 400);
  assert.ok(!(await rq("tNurman", "GET", "/catalog")).d.some((c: any) => c.id === wifi)); // staf tidak melihat yang nonaktif
  assert.ok((await rq("tMgr", "GET", "/catalog?all=1")).d.some((c: any) => c.id === wifi));
  // daftar: reviewer melihat semua, staf lain tidak
  assert.ok((await rq("tMgr", "GET", "/quotations")).d.length >= 3);
  assert.equal((await rq("tRasyad", "GET", "/quotations")).d.length, 0);
  assert.equal((await rq("tMktTanpaAkses", "GET", "/quotations")).s, 403);
});

test("Review manager: komentar, Reviewed/Revision Required/Completed, aturan follow-up, riwayat", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);
  const rep = (await rq("tNurman", "POST", "/reports", { activityType: "MEETING", area: "Rev-Area", summary: "Rapat review", picIds: ["u-nurman"] })).d;
  assert.equal((await rq("tMgr", "POST", `/reports/${rep.id}/review`)).s, 409); // belum disubmit
  await rq("tNurman", "POST", `/reports/${rep.id}/submit`);
  assert.equal((await rq("tNurman", "POST", `/reports/${rep.id}/review`)).s, 403); // staf bukan reviewer
  assert.equal((await rq("tMgr", "POST", `/reports/${rep.id}/return`)).s, 400); // catatan wajib
  const ret = await rq("tMgr", "POST", `/reports/${rep.id}/return`, { note: "Lengkapi counterpart" });
  assert.equal(ret.d.status, "REVISION_REQUIRED"); assert.equal(ret.d.comments.at(-1).kind, "REVISION_REQUIRED");
  assert.equal((await rq("tNurman", "PUT", `/reports/${rep.id}`, { activityType: "MEETING", area: "Rev-Area", counterpart: "Pak RT", summary: "Rapat review" })).s, 200); // bisa diubah lagi
  assert.equal((await rq("tNurman", "POST", `/reports/${rep.id}/comments`, { note: "Sudah dilengkapi" })).s, 201); // pemilik boleh berkomentar
  assert.equal((await rq("tRasyad", "POST", `/reports/${rep.id}/comments`, { note: "x" })).s, 403); // bukan miliknya
  await rq("tNurman", "POST", `/reports/${rep.id}/submit`);
  assert.equal((await rq("tMgr", "POST", `/reports/${rep.id}/complete`)).s, 409); // harus Reviewed dulu
  await rq("tNurman", "POST", `/reports/${rep.id}/tasks`, { title: "Kirim proposal", picUserId: "u-nurman", dueDate: "2020-01-01" });
  assert.equal((await rq("tMgr", "POST", `/reports/${rep.id}/review`, { note: "OK" })).d.status, "REVIEWED");
  const blocked = await rq("tMgr", "POST", `/reports/${rep.id}/complete`);
  assert.equal(blocked.s, 409); assert.match(blocked.d.error, /follow-up/);
  const t = (await rq("tNurman", "GET", "/tasks")).d.find((x: any) => x.reportId == rep.id);
  assert.equal(t.overdue, true);
  await rq("tNurman", "PATCH", `/tasks/${t.id}`, { status: "DONE" });
  const done = await rq("tMgr", "POST", `/reports/${rep.id}/complete`);
  assert.equal(done.d.status, "COMPLETED");
  assert.deepEqual(done.d.comments.map((c: any) => c.kind), ["REVISION_REQUIRED", "COMMENT", "REVIEWED", "COMPLETED"]);
  assert.equal((await rq("tNurman", "PUT", `/reports/${rep.id}`, { activityType: "MEETING" })).s, 409); // selesai = terkunci
});

test("Dashboard KPI: rentang tanggal, cakupan staf vs reviewer, filter marketing/area, pipeline lead & penawaran", async () => {
  const rq = (tok: string, path: string) => call(tok, "GET", "/crm/api" + path).then(async (r) => ({ s: r.status, d: await r.json() as any }));
  const rev = await rq("tMgr", "/dashboard?area=rev-area");
  assert.equal(rev.s, 200); assert.equal(rev.d.field.visits, 1);
  assert.deepEqual(rev.d.field.perMarketing.map((x: any) => [x.name, x.visits]), [["Nurman", 1]]);
  assert.equal(rev.d.field.verified + rev.d.field.unverified, 1); // tanpa GPS = Unverified
  assert.ok(rev.d.people.length > 0);
  // staf: hanya miliknya, filter marketing diabaikan
  const mine = await rq("tRasyad", "/dashboard?marketing=u-nurman");
  assert.equal(mine.d.scope, "marketing"); assert.equal(mine.d.filters.marketing, "u-rasyad"); assert.deepEqual(mine.d.people, []);
  const mineVisits = mine.d.field.perMarketing.map((x: any) => x.name);
  assert.ok(mineVisits.every((n: string) => n === "Rasyad"));
  // filter marketing oleh reviewer
  const onlyNurman = await rq("tMgr", "/dashboard?marketing=u-nurman");
  assert.ok(onlyNurman.d.field.perMarketing.every((x: any) => x.name === "Nurman"));
  // rentang di masa lalu → nol
  const old = await rq("tMgr", "/dashboard?from=2020-01-01&to=2020-01-31");
  assert.equal(old.d.field.visits, 0); assert.equal(old.d.leads.created, 0);
  assert.equal((await rq("tMgr", "/dashboard?from=2026-02-01&to=2026-01-01")).s, 400);
  assert.equal((await rq("tMgr", "/dashboard?from=bukan")).s, 400);
  // pipeline: dari tes sebelumnya ada lead non-internet Won & penawaran diterima
  const d = (await rq("tMgr", "/dashboard")).d;
  assert.ok(d.leads.created >= 3); assert.ok(d.leads.won >= 1); assert.equal(typeof d.leads.winRate, "number");
  assert.ok(d.quotations.acceptedCount >= 1); assert.ok(d.quotations.acceptedValue > 0);
  assert.equal(d.field.tasks.overdue >= 0, true);
  assert.equal((await rq("tMktTanpaAkses", "/dashboard")).s, 403);
});

test("Jejak marketing permanen: snapshot id+nama pada lead & penawaran; tahan ganti nama/hapus di WO; payload PUT WO selalu memuat marketingUserId+marketingName", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);
  const { quotationWoPayload } = await import("./woPayload.js");
  const { detail } = await import("./quotations.js");

  const item = (await rq("tMgr", "POST", "/catalog", { name: "Jejak Item", sku: "JEJAK-1", kind: "SERVICE", unit: "paket", price: 1000000 })).d.id;
  const lead = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Pelanggan Jejak", phone: "081399990001" })).d;
  assert.deepEqual([lead.ownerId, lead.ownerName, lead.createdBy, lead.createdByName], ["u-nurman", "Nurman", "u-nurman", "Nurman"]);
  const q = (await rq("tNurman", "POST", "/quotations", { leadId: lead.id, lines: [{ catalogId: item, qty: 2 }] })).d;
  assert.deepEqual([q.marketingUserId, q.marketingName, q.createdByName], ["u-nurman", "Nurman", "Nurman"]);

  // pengguna di WO berganti nama, lalu dihapus dari cache → jejak tetap
  await pool.query("UPDATE wo_user_cache SET name='Nurman Baru', role='NOC' WHERE user_id='u-nurman'");
  let again = (await rq("tMgr", "GET", `/quotations/${q.id}`)).d;
  assert.deepEqual([again.marketingUserId, again.marketingName], ["u-nurman", "Nurman"]);
  await pool.query("DELETE FROM wo_user_cache WHERE user_id='u-nurman'");
  again = (await rq("tMgr", "GET", `/quotations/${q.id}`)).d;
  assert.deepEqual([again.marketingUserId, again.marketingName, again.createdByName], ["u-nurman", "Nurman", "Nurman"]);
  assert.equal((await rq("tMgr", "GET", `/leads/${lead.id}`)).d.ownerName, "Nurman");

  // payload ke WO: hanya status yang perlu dikirim; selalu membawa id + nama marketing (snapshot)
  assert.equal(quotationWoPayload(again), null); // DRAFT tidak dikirim
  await rq("tNurman", "POST", `/quotations/${q.id}/submit`); await rq("tMgr", "POST", `/quotations/${q.id}/approve`);
  assert.equal(quotationWoPayload((await rq("tMgr", "GET", `/quotations/${q.id}`)).d), null); // APPROVED belum
  await rq("tNurman", "POST", `/quotations/${q.id}/send`);
  const sent = quotationWoPayload(await detail((await pool.query("SELECT * FROM quotations WHERE id=$1", [q.id])).rows[0]))!;
  assert.equal(sent.status, "QUOTED"); assert.equal(sent.marketingUserId, "u-nurman"); assert.equal(sent.marketingName, "Nurman");
  assert.equal(sent.lines[0].sku, "JEJAK-1"); assert.equal(sent.lines[0].qty, 2); assert.equal(sent.total, 2220000);
  await rq("tNurman", "POST", `/quotations/${q.id}/accept`);
  const won = quotationWoPayload(await detail((await pool.query("SELECT * FROM quotations WHERE id=$1", [q.id])).rows[0]))!;
  assert.equal(won.status, "WON"); assert.equal(won.marketingUserId, "u-nurman"); assert.equal(won.marketingName, "Nurman");

  // penjaga DB: kolom jejak tidak bisa diubah (bahkan lewat SQL langsung)
  await assert.rejects(pool.query("UPDATE quotations SET owner_name='Lain' WHERE id=$1", [q.id]), /jejak permanen/);
  await assert.rejects(pool.query("UPDATE quotations SET owner_id='u-x' WHERE id=$1", [q.id]), /jejak permanen/);
  await assert.rejects(pool.query("UPDATE quotations SET created_by_name='Lain' WHERE id=$1", [q.id]), /jejak permanen/);
  await assert.rejects(pool.query("UPDATE leads SET created_by='u-x' WHERE id=$1", [lead.id]), /jejak permanen/);

  // pergantian pemilik lead oleh reviewer: tercatat id+nama lama→baru; penawaran lama tetap atas nama marketing awal tetapi terlihat pemilik baru
  const l2 = (await rq("tRasyad", "POST", "/leads", { kind: "NON_INTERNET", name: "Pindah Tangan", phone: "081399990002" })).d;
  const q2 = (await rq("tRasyad", "POST", "/quotations", { leadId: l2.id, lines: [{ catalogId: item, qty: 1 }] })).d;
  assert.equal((await rq("tMgr", "PATCH", `/leads/${l2.id}`, { ownerId: "tidak-ada" })).s, 400); // pemilik harus user MKT/ADMIN yang dikenal
  await pool.query("INSERT INTO wo_user_cache (user_id,name,role) VALUES ('u-baru','Marketing Baru','MKT') ON CONFLICT (user_id) DO UPDATE SET name='Marketing Baru'");
  const moved = (await rq("tMgr", "PATCH", `/leads/${l2.id}`, { ownerId: "u-baru" })).d;
  assert.deepEqual([moved.ownerId, moved.ownerName], ["u-baru", "Marketing Baru"]);
  assert.match(moved.events.find((e: any) => e.type === "OWNER").note, /Rasyad \(u-rasyad\) → Marketing Baru \(u-baru\)/);
  const q2again = (await rq("tMgr", "GET", `/quotations/${q2.id}`)).d;
  assert.deepEqual([q2again.marketingUserId, q2again.marketingName], ["u-rasyad", "Rasyad"]); // penawaran tidak ikut berganti nama pemilik
  assert.equal((await rq("tRasyad", "GET", `/quotations/${q2.id}`)).s, 200); // pembuat tetap bisa melihat
});
