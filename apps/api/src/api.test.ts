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
  assert.equal((await runSync()).ok, true);
  assert.equal((await pool.query("SELECT 1 FROM wo_customers WHERE code='C2'")).rowCount, 0);
  assert.deepEqual((await pool.query("SELECT name, kind, origin FROM wo_packages ORDER BY name")).rows, [{ name: "Home 20", kind: "INTERNET", origin: "EXPORT" }, { name: "Sewa WiFi", kind: "SERVICE", origin: "EXPORT" }]);
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
