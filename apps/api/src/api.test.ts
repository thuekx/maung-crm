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
  tAdminActing: { id: "u-admin", name: "Admin", email: "admin@l1v.local", role: "ADMIN", subRole: "STAFF", features: ["app.crm"], acting: { role: "MKT", subRole: "STAFF" } },
};
let wo: http.Server, api: http.Server, base = "";
// Export API WO tiruan: customers dibagi 2 halaman (cursor); packages/areas = 404 (belum ada di WO); kunci salah = 401.

// Pintu masuk CRM → WO tiruan mengikuti docs/API.md WO ("Integrasi CRM → WO"): kunci x-api-key, validasi isi, aturan WON terkunci/stale/duplicate.
const CRM_KEY = "k-test-crm-integration";
let woMode: string = "ok";
let woOrderSeq = 0;
const woCalls: { method: string; path: string; body: any }[] = [];
const woCatalog = new Map<string, any>(), woQuotes = new Map<string, any>(), woNotes: any[] = [];
const crmMock = (req: http.IncomingMessage, res: http.ServerResponse) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (st: number, o: any) => { res.statusCode = st; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    if (req.headers["x-api-key"] !== CRM_KEY) return send(401, { error: "API key tidak valid" });
    const body = raw ? JSON.parse(raw) : {};
    if (req.method === "GET" && req.url!.startsWith("/api/integrations/crm/quotations?")) { // daftar rekonsiliasi (baca-saja)
      const all = [...woQuotes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([crmId, b]) => ({ crmId, number: b.number, rev: b.rev, status: b.status, total: b.total, demo: !!b.demo, marketingUserId: b.marketingUserId, marketingName: b.marketingName, customerCode: null, lineCount: b.lines.length, woNumber: b.woNumber ?? null, woStatus: null, updatedAt: new Date().toISOString() }));
      const cur = new URL(req.url!, "http://x").searchParams.get("cursor"); const st = cur ? all.findIndex((x) => x.crmId === cur) + 1 : 0;
      return send(200, { count: Math.min(2, all.length - st), nextCursor: st + 2 < all.length ? all[st + 1].crmId : null, generatedAt: new Date().toISOString(), data: all.slice(st, st + 2) });
    }
    if (req.method === "POST" && req.url === "/api/integrations/crm/notifications") { // notifikasi CRM → WO (idempoten per userId+dedupeKey)
      if (woMode === "down") return send(503, { error: "layanan sibuk" });
      if (!body.userId || !body.title || !String(body.link ?? "/").startsWith("/") || !/^[A-Z0-9_]+$/.test(body.type ?? "")) return send(422, { error: "isi tidak valid" });
      if (body.userId === "u-gone") return send(404, { error: "pengguna tidak ada" });
      const dup = woNotes.some((x) => x.userId === body.userId && x.dedupeKey === body.dedupeKey);
      if (!dup) woNotes.push(body);
      return send(dup ? 200 : 201, { ok: true, duplicate: dup });
    }
    const [, kind, crmId] = /^\/api\/integrations\/crm\/(catalog|quotations)\/([^/?]+)/.exec(req.url!) ?? [];
    woCalls.push({ method: req.method!, path: `${kind}/${crmId}`, body });
    if (woMode === "down") return send(503, { error: "layanan sibuk" });
    if (kind === "catalog") {
      if (!body.name || body.name.length < 2 || body.name.length > 80 || !["SERVICE", "PRODUCT"].includes(body.kind)) return send(400, { error: "isian katalog tidak valid" });
      const other = [...woCatalog.entries()].find(([id, c]) => c.name.toLowerCase() === body.name.toLowerCase() && id !== crmId);
      if (other) return send(409, { error: `Nama "${body.name}" sudah dipakai paket lain` });
      const had = woCatalog.has(crmId); woCatalog.set(crmId, body);
      return send(had ? 200 : 201, { ok: true, created: !had, ...(body.sku ? { skuFound: body.sku === "CCTV-DOME-2MP", itemName: null } : {}) });
    }
    if (!String(body.marketingUserId ?? "").trim() || !String(body.marketingName ?? "").trim()) return send(422, { error: "marketingUserId dan marketingName wajib" });
    const c = body.customer ?? {};
    if (!(c.name?.length >= 2) || !/^[0-9+][0-9 +()-]*$/.test(c.phone ?? "") || c.phone.length < 6 || !(c.address?.length >= 5) || !Array.isArray(body.lines) || !body.lines.length) return send(400, { error: "isian penawaran tidak valid" });
    if (c.code && c.code !== "A5") return send(404, { error: `Pelanggan ${c.code} tidak ditemukan di WO` });
    const cur = woQuotes.get(crmId);
    const view = (q: any) => ({ quotationId: "w1", crmId, number: q.number, rev: q.rev, status: q.status, woNumber: q.woNumber ?? null });
    if (cur) {
      if (body.rev < cur.rev) return send(200, { ok: true, stale: true, ...view(cur) });
      if (cur.status === "WON" && (body.rev > cur.rev || body.status !== "WON")) return send(409, { error: "Penawaran sudah WON dan terkunci" });
      if (body.rev === cur.rev && body.status === cur.status && !(cur.status === "WON" && !cur.woNumber)) return send(200, { ok: true, duplicate: true, ...view(cur) });
      if (body.rev === cur.rev && cur.status === "LOST") return send(409, { error: "sudah LOST pada revisi ini" });
    }
    // Tahap 2b WO: WON membentuk pelanggan + order jasa (nomor WO-SO-…); WON lama tanpa order diproses ulang saat dikirim ulang
    if (body.status === "WON") body.woNumber = cur?.woNumber ?? `WO-SO-${String(++woOrderSeq).padStart(4, "0")}`; else if (cur?.woNumber) body.woNumber = cur.woNumber;
    woQuotes.set(crmId, body);
    send(cur ? 200 : 201, { ok: true, ...view(body), warnings: { marketingMatched: body.marketingUserId === "u-nurman", unknownCatalog: [], skuNotFound: [], areaNotFound: false } });
  });
};
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
    if (req.url === "/api/users") { // daftar pengguna WO (Admin) — akun demo mkt@ dst.
      if (t !== "tAdmin") { res.statusCode = 403; return void res.end("{}"); }
      return void res.end(JSON.stringify([
        { id: "u-admin", name: "Admin", email: "admin@l1v.local", role: "ADMIN", subRole: "STAFF", active: true },
        { id: "u-demo-mkt", name: "Marketing Demo", email: "mkt@l1v.local", role: "MKT", subRole: "SUPERVISOR", active: true },
        { id: "u-demo-noc", name: "NOC Demo", email: "noc@l1v.local", role: "NOC", subRole: "SUPERVISOR", active: true },
        { id: "u-luar", name: "Orang Luar", email: "luar@contoh.com", role: "MKT", subRole: "STAFF", active: true },
      ]));
    }
    if (req.url === "/api/auth/me") {
      const u = USERS[t];
      res.statusCode = u ? 200 : 401;
      return void res.end(JSON.stringify(u ?? { error: "Belum login" }));
    }
    if (req.url?.startsWith("/api/export/")) return void exportMock(req, res);
    if (req.url?.startsWith("/api/integrations/crm/")) return void crmMock(req, res);
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
  exportData.customers[0].crmLeadRef = "ld-77"; exportData.customers[0].parentCustomerCode = "P-1"; await runSync(); // diekspor apa adanya dari WO; CRM menormalkan huruf besar
  assert.deepEqual((await pool.query("SELECT crm_lead_ref, parent_customer_code FROM wo_customers WHERE code='A1'")).rows[0], { crm_lead_ref: "LD-77", parent_customer_code: "P-1" });
  delete exportData.customers[0].crmLeadRef; delete exportData.customers[0].parentCustomerCode;
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
  const lead = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Toko Maju", address: "Jl. Uji Coba No. 1, Bekasi", phone: "081377770001", interest: "CCTV 4 titik" })).d;
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
  const nfc = async (uid: string, type: string) => Number((await pool.query("SELECT count(*) n FROM crm_notifications WHERE user_id=$1 AND type=$2", [uid, type])).rows[0].n);
  assert.equal(await nfc("u-mgr", "QUOTATION_SUBMITTED"), 1); assert.equal(await nfc("u-nurman", "QUOTATION_SUBMITTED"), 0); // reviewer diberi tahu, pengaju tidak
  assert.equal(await nfc("u-nurman", "QUOTATION_RETURNED"), 1);
  await rq("tNurman", "POST", `/quotations/${q.id}/submit`);
  const ap = (await rq("tMgr", "POST", `/quotations/${q.id}/approve`)).d;
  assert.equal(ap.status, "APPROVED"); assert.equal(ap.approvedByName, "Manajer");
  assert.equal(await nfc("u-nurman", "QUOTATION_APPROVED"), 1);
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
  const l2 = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Kantor B", address: "Jl. Uji Coba No. 1, Bekasi", phone: "081377770003" })).d;
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
  const nfr = async (uid: string, type: string) => Number((await pool.query("SELECT count(*) n FROM crm_notifications WHERE user_id=$1 AND type=$2", [uid, type])).rows[0].n);
  assert.ok(await nfr("u-mgr", "REPORT_SUBMITTED") >= 1); assert.equal(await nfr("u-nurman", "REPORT_REVISION_REQUIRED"), 1);
  assert.equal((await rq("tNurman", "PUT", `/reports/${rep.id}`, { activityType: "MEETING", area: "Rev-Area", counterpart: "Pak RT", summary: "Rapat review" })).s, 200); // bisa diubah lagi
  assert.equal((await rq("tNurman", "POST", `/reports/${rep.id}/comments`, { note: "Sudah dilengkapi" })).s, 201); // pemilik boleh berkomentar
  assert.equal((await rq("tRasyad", "POST", `/reports/${rep.id}/comments`, { note: "x" })).s, 403); // bukan miliknya
  await rq("tNurman", "POST", `/reports/${rep.id}/submit`);
  assert.equal((await rq("tMgr", "POST", `/reports/${rep.id}/complete`)).s, 409); // harus Reviewed dulu
  await rq("tNurman", "POST", `/reports/${rep.id}/tasks`, { title: "Kirim proposal", picUserId: "u-nurman", dueDate: "2020-01-01" });
  // follow-up untuk orang lain → PIC diberi tahu; pengingat terlambat lewat sweep (sekali per task)
  const asg0 = await nfr("u-rasyad", "TASK_ASSIGNED");
  await rq("tNurman", "POST", `/reports/${rep.id}/tasks`, { title: "Telepon ulang", picUserId: "u-rasyad", dueDate: "2020-01-02" });
  assert.equal(await nfr("u-rasyad", "TASK_ASSIGNED"), asg0 + 1);
  const { sweepNotifications } = await import("./notify.js");
  await sweepNotifications(); await sweepNotifications(); // idempoten
  const od = await nfr("u-nurman", "TASK_OVERDUE"); await sweepNotifications(); assert.equal(await nfr("u-nurman", "TASK_OVERDUE"), od); assert.ok(od >= 1 && await nfr("u-rasyad", "TASK_OVERDUE") >= 1);
  // endpoint lonceng: hanya milik sendiri; tandai dibaca
  const nl = await rq("tRasyad", "GET", "/notifications");
  assert.ok(nl.d.unread >= 2); assert.ok(nl.d.items.every((x: any) => x.title));
  assert.equal((await rq("tNurman", "GET", "/notifications")).d.items.some((x: any) => x.type === "TASK_ASSIGNED"), false);
  assert.equal((await rq("tRasyad", "POST", "/notifications/read", { ids: [nl.d.items[0].id] })).d.marked, 1);
  assert.equal((await rq("tRasyad", "GET", "/notifications")).d.unread, nl.d.unread - 1);
  assert.equal((await rq("tNurman", "POST", "/notifications/read", { ids: [nl.d.items[1]?.id ?? 0] })).d.marked, 0); // tak bisa menandai milik orang lain
  await rq("tRasyad", "POST", "/notifications/read"); assert.equal((await rq("tRasyad", "GET", "/notifications")).d.unread, 0);
  assert.equal((await rq("tMgr", "POST", `/reports/${rep.id}/review`, { note: "OK" })).d.status, "REVIEWED");
  const blocked = await rq("tMgr", "POST", `/reports/${rep.id}/complete`);
  assert.equal(blocked.s, 409); assert.match(blocked.d.error, /follow-up/);
  const t = (await rq("tNurman", "GET", "/tasks")).d.find((x: any) => x.reportId == rep.id);
  assert.equal(t.overdue, true);
  await rq("tNurman", "PATCH", `/tasks/${t.id}`, { status: "DONE" });
  for (const x of (await rq("tMgr", "GET", "/tasks")).d.filter((x: any) => x.reportId == rep.id && x.status === "OPEN")) await rq("tMgr", "PATCH", `/tasks/${x.id}`, { status: "DONE" }); // task tambahan uji notifikasi
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

test("Lead untuk pelanggan existing: pilih dari WO (acuan), internet = kode baru dilacak terpisah, non-internet = ditautkan ke pelanggan itu", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);
  await pool.query(`INSERT INTO wo_customers (code,name,phone,phone_norm,phone_digits,status,package_name,wo_created_at) VALUES
    ('EX-1','PT Lama','081355550001','6281355550001','6281355550001','ACTIVE','Paket 20M', now() - interval '400 days')`);
  assert.equal((await rq("tNurman", "GET", "/customers?q=PT Lama")).d[0].code, "EX-1"); // pencarian nama dari cermin WO
  assert.equal((await rq("tNurman", "POST", "/leads", { kind: "INTERNET", name: "PT Lama", phone: "081355550001", relatedCustomerCode: "NADA" })).s, 400);
  // internet: layanan baru → status pelanggan lama TIDAK diikuti (bukan Won), acuan tersimpan
  const li = (await rq("tNurman", "POST", "/leads", { kind: "INTERNET", name: "PT Lama (cabang)", phone: "081355550001", relatedCustomerCode: "EX-1" })).d;
  assert.equal(li.relatedCustomerCode, "EX-1"); assert.equal(li.relatedCustomer.name, "PT Lama"); assert.equal(li.existingCustomer, true);
  assert.equal(li.customerCode, null); assert.equal(li.stage, "NEW");
  const { refreshLeadLinks } = await import("./leads.js"); await refreshLeadLinks();
  const li2 = (await rq("tNurman", "GET", `/leads/${li.id}`)).d; assert.equal(li2.customerCode, null); assert.equal(li2.stage, "NEW");
  // WO membuat kode BARU untuk layanan baru → tertaut otomatis ke kode baru itu, bukan ke EX-1
  await pool.query(`INSERT INTO wo_customers (code,name,phone,phone_norm,phone_digits,status,wo_created_at) VALUES ('EX-2','PT Lama (cabang)','081355550001','6281355550001','6281355550001','PROSPECT', now() + interval '1 hour')`);
  await refreshLeadLinks();
  const li3 = (await rq("tNurman", "GET", `/leads/${li.id}`)).d; assert.equal(li3.customerCode, "EX-2"); assert.equal(li3.relatedCustomerCode, "EX-1");
  // non-internet: ditautkan langsung ke pelanggan yang dipilih (order jasa tidak membuat pelanggan baru)
  const ln = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "PT Lama", phone: "081355550001", relatedCustomerCode: "EX-1" })).d;
  assert.equal(ln.customerCode, "EX-1"); assert.equal(ln.linkState, "MANUAL"); assert.equal(ln.relatedCustomerCode, "EX-1");
  // nomor Lead (LD-<id>) dari WO menautkan PASTI ke kode baru, mengalahkan tebakan; kode induk ikut diisi
  const lj = (await rq("tNurman", "POST", "/leads", { kind: "INTERNET", name: "Cabang Rahasia", phone: "081355559999", relatedCustomerCode: "EX-1" })).d;
  assert.equal(lj.ref, `LD-${lj.id}`);
  await pool.query(`INSERT INTO wo_customers (code,name,phone,status,wo_created_at,crm_lead_ref,parent_customer_code) VALUES ('EX-3','Nama Beda','0899','PROSPECT', now() + interval '2 hours', $1, 'EX-1')`, [lj.ref]);
  await refreshLeadLinks();
  const lj2 = (await rq("tNurman", "GET", `/leads/${lj.id}`)).d; assert.equal(lj2.customerCode, "EX-3"); assert.equal(lj2.relatedCustomerCode, "EX-1");
  // non-internet lokasi baru: tidak ditautkan ke pelanggan acuan; payload memakai customer.parentCode
  const lnl = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "PT Lama Cabang", phone: "081355550002", address: "Jl. Cabang No. 2, Bekasi", relatedCustomerCode: "EX-1", newLocation: true })).d;
  assert.equal(lnl.customerCode, null); assert.equal(lnl.newLocation, true);
  const cit = (await rq("tMgr", "POST", "/catalog", { name: "Item Cabang", sku: "CAB-1", kind: "SERVICE", unit: "paket", price: 500000 })).d.id;
  const qn = (await rq("tNurman", "POST", "/quotations", { leadId: lnl.id, lines: [{ catalogId: cit, qty: 1 }] })).d;
  const { quotationWoPayload } = await import("./woPayload.js"); const { detail } = await import("./quotations.js");
  const sentQ = await detail((await pool.query("SELECT * FROM quotations WHERE id=$1", [qn.id])).rows[0]);
  const pl = quotationWoPayload({ ...sentQ, status: "SENT" } as any)!;
  assert.equal(pl.customer.code, undefined); assert.equal(pl.customer.parentCode, "EX-1");
  const qs = (await rq("tNurman", "POST", "/quotations", { leadId: ln.id, lines: [{ catalogId: cit, qty: 1 }] })).d; // pelanggan yang sama → customer.code, tanpa parentCode
  const pl2 = quotationWoPayload({ ...(await detail((await pool.query("SELECT * FROM quotations WHERE id=$1", [qs.id])).rows[0])), status: "SENT" } as any)!;
  assert.equal(pl2.customer.code, "EX-1"); assert.equal(pl2.customer.parentCode, undefined);
});

test("Jejak marketing permanen: snapshot id+nama pada lead & penawaran; tahan ganti nama/hapus di WO; payload PUT WO selalu memuat marketingUserId+marketingName", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);
  const { quotationWoPayload } = await import("./woPayload.js");
  const { detail } = await import("./quotations.js");

  const item = (await rq("tMgr", "POST", "/catalog", { name: "Jejak Item", sku: "JEJAK-1", kind: "SERVICE", unit: "paket", price: 1000000 })).d.id;
  const lead = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Pelanggan Jejak", address: "Jl. Uji Coba No. 1, Bekasi", phone: "081399990001" })).d;
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

test("Jejak Field Report: id + nama pembuat (report, foto, follow-up) snapshot permanen, tahan hapus/ganti nama di WO, tak bisa diubah", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);
  await pool.query("INSERT INTO wo_user_cache (user_id,name,role) VALUES ('u-nurman','Nurman','MKT') ON CONFLICT (user_id) DO UPDATE SET name='Nurman', role='MKT'");
  const rep = (await rq("tNurman", "POST", "/reports", { activityType: "SURVEY", summary: "Jejak", picIds: ["u-nurman", "u-rasyad"] })).d;
  assert.deepEqual([rep.createdBy, rep.createdByName], ["u-nurman", "Nurman"]);
  const task = (await rq("tNurman", "POST", `/reports/${rep.id}/tasks`, { title: "Tugas jejak", picUserId: "u-rasyad", dueDate: "2030-01-01" })).d;
  const f = new FormData();
  f.set("original", new Blob([new Uint8Array(await png())]), "o.png");
  assert.equal((await fetch(`${base}/crm/api/reports/${rep.id}/photos`, { method: "POST", headers: { Authorization: "Bearer tNurman" }, body: f })).status, 201);

  // pengguna berganti nama lalu dihapus dari WO/cache → jejak tetap
  await pool.query("UPDATE wo_user_cache SET name='Nama Baru' WHERE user_id='u-nurman'");
  await pool.query("DELETE FROM wo_user_cache WHERE user_id IN ('u-nurman','u-rasyad')");
  const d = (await rq("tMgr", "GET", `/reports/${rep.id}`)).d;
  assert.deepEqual([d.createdBy, d.createdByName], ["u-nurman", "Nurman"]);
  assert.deepEqual(d.pics.map((p: any) => [p.userId, p.name]), [["u-nurman", "Nurman"], ["u-rasyad", "Rasyad"]]); // PIC snapshot
  assert.deepEqual([d.tasks[0].createdBy, d.tasks[0].createdByName, d.tasks[0].picName], ["u-nurman", "Nurman", "Rasyad"]);
  assert.deepEqual([d.photos[0].createdBy, d.photos[0].createdByName], ["u-nurman", "Nurman"]);

  // pengeditan biasa tidak mengubah jejak; mengubah lewat SQL ditolak di DB
  assert.equal((await rq("tNurman", "PUT", `/reports/${rep.id}`, { activityType: "SURVEY", summary: "Jejak v2" })).s, 200);
  assert.equal((await rq("tMgr", "GET", `/reports/${rep.id}`)).d.createdByName, "Nurman");
  await assert.rejects(pool.query("UPDATE field_reports SET created_by_name='X' WHERE id=$1", [rep.id]), /jejak permanen/);
  await assert.rejects(pool.query("UPDATE field_reports SET created_by='u-x' WHERE id=$1", [rep.id]), /jejak permanen/);
  await assert.rejects(pool.query("UPDATE field_photos SET created_by_name='X' WHERE report_id=$1", [rep.id]), /jejak permanen/);
  await assert.rejects(pool.query("UPDATE field_tasks SET created_by_name='X' WHERE id=$1", [task.id]), /jejak permanen/);
  // aksi biasa pada task (selesai) tetap berjalan
  assert.equal((await rq("tNurman", "PATCH", `/tasks/${task.id}`, { status: "DONE" })).s, 200);
});

test("Kirim CRM → WO (outbox): katalog dulu baru penawaran, jejak marketing, idempoten, coba ulang, BLOCKED + retry, LOST hanya bila pernah terkirim, kunci tak bocor", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);
  const { processOutbox, enqueueBackfill, pushEnabled } = await import("./woPush.js");
  const reset = () => { woCalls.length = 0; woCatalog.clear(); woQuotes.clear(); woMode = "ok"; };
  const q1 = async (sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows;
  const due = () => pool.query("UPDATE wo_outbox SET next_attempt_at=now() WHERE status='PENDING'");
  await pool.query("DELETE FROM wo_outbox"); await pool.query("UPDATE catalog_items SET wo_synced_at=now()"); await pool.query("UPDATE quotations SET wo_synced_at=NULL, wo_synced_rev=NULL, wo_synced_status=NULL");
  reset();

  // 0) tanpa kunci: tidak aktif, tidak mengirim apa pun
  delete process.env.CRM_INTEGRATION_KEY;
  assert.equal(pushEnabled(), false);
  const cat = (await rq("tMgr", "POST", "/catalog", { name: "Kamera Outbox", sku: "OUTBOX-CAM-1", kind: "PRODUCT", unit: "unit", price: 900000 })).d.id;
  const svc = (await rq("tMgr", "POST", "/catalog", { name: "Instalasi Outbox", kind: "SERVICE", unit: "titik", price: 150000 })).d.id;
  assert.equal(await processOutbox().then((r) => r.done), 0); assert.equal(woCalls.length, 0);
  assert.equal((await rq("tMgr", "POST", "/catalog", { name: "x".repeat(81), kind: "SERVICE" })).s, 400); // batas nama WO

  // penawaran: data pelanggan harus memenuhi syarat WO sebelum diajukan
  const lead = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Toko Outbox", phone: "0812 8888 0001", interest: "CCTV" })).d; // tanpa alamat
  const q = (await rq("tNurman", "POST", "/quotations", { leadId: lead.id, lines: [{ catalogId: cat, qty: 2 }, { catalogId: svc, qty: 2 }] })).d;
  const need = await rq("tNurman", "POST", `/quotations/${q.id}/submit`);
  assert.equal(need.s, 409); assert.match(need.d.error, /alamat/);
  await rq("tNurman", "PUT", `/quotations/${q.id}`, { customerAddress: "Jl. Raya No. 5, Bekasi" });
  await rq("tNurman", "POST", `/quotations/${q.id}/submit`); await rq("tMgr", "POST", `/quotations/${q.id}/approve`);
  assert.equal((await q1("SELECT count(*)::int n FROM wo_outbox WHERE kind='QUOTATION'"))[0].n, 0); // belum SENT: tidak diantre
  await rq("tNurman", "POST", `/quotations/${q.id}/send`);

  // 1) dengan kunci: katalog lebih dulu, lalu penawaran QUOTED membawa jejak marketing (id + nama)
  process.env.CRM_INTEGRATION_KEY = CRM_KEY;
  assert.equal(pushEnabled(), true);
  let r = await processOutbox();
  assert.deepEqual([r.done, r.blocked, r.retry], [3, 0, 0]);
  assert.deepEqual(woCalls.map((c) => c.path.split("/")[0]), ["catalog", "catalog", "quotations"]);
  const put = woCalls.find((c) => c.path.startsWith("quotations"))!;
  assert.equal(put.path, `quotations/quotation-${q.id}`); assert.equal(put.method, "PUT");
  assert.deepEqual([put.body.marketingUserId, put.body.marketingName, put.body.status, put.body.rev], ["u-nurman", "Nurman", "QUOTED", 1]);
  assert.equal(put.body.customer.address, "Jl. Raya No. 5, Bekasi"); assert.equal(put.body.customer.phone, "0812 8888 0001");
  assert.equal(put.body.lines[0].catalogCrmId, `catalog-${cat}`); assert.equal(put.body.lines[0].sku, "OUTBOX-CAM-1");
  assert.equal(put.body.total, 1.11 * (2 * 900000 + 2 * 150000)); assert.match(put.body.taxNote, /PPN 11%/);
  assert.ok(!JSON.stringify(woCalls).includes(CRM_KEY)); // kunci tidak ada di isi permintaan
  const row = (await q1("SELECT wo_synced_rev, wo_synced_status, wo_warnings FROM quotations WHERE id=$1", [q.id]))[0];
  assert.deepEqual([row.wo_synced_rev, row.wo_synced_status, row.wo_warnings.marketingMatched], [1, "QUOTED", true]);

  // 2) idempoten: antre ulang keadaan yang sama → tidak ada PUT baru
  const { enqueue } = await import("./woPush.js");
  woCalls.length = 0; await enqueue("QUOTATION", q.id); r = await processOutbox();
  assert.equal(woCalls.length, 0);

  // 3) WO tidak tersedia (503) → coba ulang bertahap (bukan BLOCKED); lalu pulih
  woMode = "down";
  await rq("tNurman", "POST", `/quotations/${q.id}/accept`);
  r = await processOutbox(); assert.deepEqual([r.done, r.blocked, r.retry], [0, 0, 1]);
  let job = (await q1("SELECT * FROM wo_outbox WHERE kind='QUOTATION' AND status='PENDING'"))[0];
  assert.equal(job.attempts, 1); assert.equal(job.last_http, 503); assert.ok(new Date(job.next_attempt_at).getTime() > Date.now() + 30_000);
  assert.equal((await processOutbox()).done, 0); // belum jatuh tempo → tidak dicoba lagi
  woMode = "ok"; await due(); r = await processOutbox(); assert.equal(r.done, 1);
  assert.equal(woQuotes.get(`quotation-${q.id}`).status, "WON");
  assert.equal((await q1("SELECT wo_synced_status FROM quotations WHERE id=$1", [q.id]))[0].wo_synced_status, "WON");
  // Tahap 2b: respons WON memuat nomor order WO → tersimpan & tampil
  const orderNo = (await q1("SELECT wo_number FROM quotations WHERE id=$1", [q.id]))[0].wo_number;
  assert.match(orderNo, /^WO-SO-\d{4}$/);
  assert.equal((await rq("tMgr", "GET", `/quotations/${q.id}`)).d.wo.woNumber, orderNo);
  // WON lama tanpa nomor order (terkirim sebelum 2b aktif) dikirim ulang agar WO membentuk order; WON yang sudah punya order tidak dikirim ulang
  woCalls.length = 0; await enqueue("QUOTATION", q.id); await processOutbox(); assert.equal(woCalls.length, 0);
  await pool.query("UPDATE quotations SET wo_number=NULL WHERE id=$1", [q.id]); woQuotes.get(`quotation-${q.id}`).woNumber = null;
  await enqueue("QUOTATION", q.id); await processOutbox();
  assert.equal(woCalls.filter((c) => c.path.includes(`quotation-${q.id}`)).length, 1);
  assert.match((await q1("SELECT wo_number FROM quotations WHERE id=$1", [q.id]))[0].wo_number, /^WO-SO-\d{4}$/);

  // 4) kunci salah (401) → dicoba ulang (masalah konfigurasi), pesan tidak memuat kunci
  const l2 = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Kantor Outbox", phone: "0812 8888 0002", address: "Jl. Kantor No. 9, Bandung" })).d;
  const q2 = (await rq("tNurman", "POST", "/quotations", { leadId: l2.id, lines: [{ catalogId: svc, qty: 1 }] })).d;
  await rq("tNurman", "POST", `/quotations/${q2.id}/submit`); await rq("tMgr", "POST", `/quotations/${q2.id}/approve`); await rq("tNurman", "POST", `/quotations/${q2.id}/send`);
  await pool.query("DELETE FROM wo_outbox WHERE kind='NOTIFICATION'"); // notifikasi diuji terpisah
  process.env.CRM_INTEGRATION_KEY = "kunci-salah-xxxxxxxx";
  r = await processOutbox(); assert.deepEqual([r.blocked, r.retry], [0, 1]);
  const err401 = (await q1("SELECT last_error, last_http FROM wo_outbox WHERE kind='QUOTATION' AND ref_id=$1 AND status='PENDING'", [q2.id]))[0];
  assert.equal(err401.last_http, 401); assert.ok(!err401.last_error.includes("kunci-salah") && !err401.last_error.includes(CRM_KEY));
  process.env.CRM_INTEGRATION_KEY = CRM_KEY; await due(); assert.equal((await processOutbox()).done, 1);

  // 5) ditolak karena isi (409 nama katalog bentrok) → BLOCKED, penawaran yang bergantung juga BLOCKED dengan alasan jelas; perbaiki → retry → selesai
  woCatalog.set("catalog-bentrok", { name: "Router Bentrok" }); // sudah ada di WO atas nama lain
  const bad = (await rq("tMgr", "POST", "/catalog", { name: "Router Bentrok", kind: "PRODUCT", unit: "unit", price: 1 })).d.id;
  r = await processOutbox(); assert.deepEqual([r.done, r.blocked], [0, 1]);
  const st = await rq("tMgr", "GET", "/wo-sync");
  assert.equal(st.d.blocked, 1); assert.match(st.d.problems[0].lastError, /409/); assert.ok(!JSON.stringify(st.d).includes(CRM_KEY));
  assert.equal((await rq("tNurman", "GET", "/wo-sync")).s, 403);
  await rq("tMgr", "PATCH", `/catalog/${bad}`, { name: "Router Tidak Bentrok" }); // perbaikan → antre baru otomatis
  assert.equal((await processOutbox()).done, 1);
  assert.equal((await q1("SELECT wo_sync_error FROM catalog_items WHERE id=$1", [bad]))[0].wo_sync_error, null);
  const blockedId = (await q1("SELECT id FROM wo_outbox WHERE status='BLOCKED' LIMIT 1"))[0]?.id;
  if (blockedId) assert.equal((await rq("tMgr", "POST", `/wo-sync/${blockedId}/retry`)).s, 200);
  assert.equal((await rq("tMgr", "POST", "/wo-sync/999999/retry")).s, 404);

  // 6) batal sebelum pernah terkirim → tidak ada LOST; setelah pernah terkirim → LOST dengan alasan
  woCalls.length = 0;
  const l3 = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Batal Awal", phone: "0812 8888 0003", address: "Jl. Batal No. 3, Bekasi" })).d;
  const q3 = (await rq("tNurman", "POST", "/quotations", { leadId: l3.id, lines: [{ catalogId: svc, qty: 1 }] })).d;
  await rq("tNurman", "POST", `/quotations/${q3.id}/cancel`, { note: "Batal sebelum dikirim" });
  await processOutbox(); assert.equal(woCalls.filter((c) => c.path.includes(`quotation-${q3.id}`)).length, 0);
  await rq("tNurman", "POST", `/quotations/${q2.id}/reject`, { note: "Harga tinggi" });
  await processOutbox();
  const lost = woQuotes.get(`quotation-${q2.id}`);
  assert.deepEqual([lost.status, lost.lostReason, lost.marketingUserId, lost.marketingName], ["LOST", "Harga tinggi", "u-nurman", "Nurman"]);

  // 7) revisi: tidak dikirim saat DRAFT; setelah dikirim ulang → rev 2 QUOTED menggantikan LOST (rev lebih tinggi)
  woCalls.length = 0;
  await rq("tNurman", "POST", `/quotations/${q2.id}/revise`, { note: "Diskon" }); await processOutbox(); assert.equal(woCalls.length, 0);
  await rq("tNurman", "POST", `/quotations/${q2.id}/submit`); await rq("tMgr", "POST", `/quotations/${q2.id}/approve`); await rq("tNurman", "POST", `/quotations/${q2.id}/send`);
  await processOutbox();
  assert.deepEqual([woQuotes.get(`quotation-${q2.id}`).rev, woQuotes.get(`quotation-${q2.id}`).status], [2, "QUOTED"]);

  // 8) WON terkunci di WO: revisi baru ditolak WO (409) → BLOCKED, tidak diulang terus-menerus
  woQuotes.get(`quotation-${q2.id}`).status = "WON";
  await rq("tNurman", "POST", `/quotations/${q2.id}/cancel`, { note: "uji kunci" }); // CANCELLED → LOST dikirim → WO menolak
  r = await processOutbox(); assert.equal(r.blocked, 1);

  // 9) backfill: penawaran terkirim sebelum integrasi aktif ikut diantre; status tidak membocorkan kunci
  await pool.query("UPDATE quotations SET wo_synced_rev=NULL, wo_synced_status=NULL, wo_synced_at=NULL WHERE id=$1", [q.id]);
  await pool.query("DELETE FROM wo_outbox WHERE status='PENDING'");
  assert.ok(await enqueueBackfill() >= 1);
  assert.equal((await rq("tAdmin", "POST", "/wo-sync/run")).s, 200);
  assert.ok(!JSON.stringify((await rq("tAdmin", "GET", "/wo-sync")).d).includes(CRM_KEY));
  assert.equal((await rq("tMgr", "POST", "/wo-sync/run")).s, 403);
  delete process.env.CRM_INTEGRATION_KEY;
});

test("Admin CRM: Data & Backup (backup/restore/upload/hapus), purge 3 tingkat + hanya demo, data demo (isDemo) tidak pernah dikirim ke WO, Pengaturan", async () => {
  const j = async (r: Response) => ({ s: r.status, d: await r.json().catch(() => ({})) as any });
  const rq = (tok: string, m: string, path: string, body?: unknown) => call(tok, m, "/crm/api" + path, body).then(j);
  const q1 = async (sql: string, a: unknown[] = []) => (await pool.query(sql, a)).rows;
  const fs = await import("node:fs");
  process.env.BACKUP_DIR = "/tmp/crm-backups-test"; fs.rmSync(process.env.BACKUP_DIR, { recursive: true, force: true });
  await pool.query("INSERT INTO wo_user_cache (user_id,name,email,role) VALUES ('u-admin','Admin','admin@l1v.local','ADMIN') ON CONFLICT (user_id) DO NOTHING");

  // ── hanya Admin ASLI ──
  for (const tok of ["tNurman", "tMgr", "tNoc", "tAdminActing"]) {
    assert.equal((await rq(tok, "GET", "/admin/data/overview")).s, 403, tok);
    assert.equal((await rq(tok, "GET", "/admin/settings")).s, 403, tok);
  }
  assert.equal((await rq("tAdmin", "GET", "/admin/data/overview")).s, 200);

  // ── Pengaturan: default penawaran dipakai saat membuat penawaran; jeda kirim ke WO ──
  const bad = await rq("tAdmin", "PUT", "/admin/settings", { quotation: { taxRate: 101, validDays: 14, terms: "x" } }); assert.equal(bad.s, 400);
  assert.equal((await rq("tAdmin", "PUT", "/admin/settings", { quotation: { taxRate: 10, validDays: 30, terms: "Syarat uji pengaturan." } })).s, 200);
  const st = (await rq("tAdmin", "GET", "/admin/settings")).d;
  assert.equal(st.quotation.taxRate, 10); assert.equal(typeof st.integration.integrationKeySet, "boolean");
  assert.ok(!JSON.stringify(st).includes(CRM_KEY) && !JSON.stringify(st).includes(EXPORT_KEY)); // nilai kunci tidak pernah keluar
  const item = (await rq("tMgr", "POST", "/catalog", { name: "Item Pengaturan", kind: "SERVICE", unit: "paket", price: 1000000 })).d.id;
  const ls = (await rq("tNurman", "POST", "/leads", { kind: "NON_INTERNET", name: "Lead Pengaturan", phone: "0812 7777 0001", address: "Jl. Pengaturan No. 1, Bandung" })).d;
  const qs = (await rq("tNurman", "POST", "/quotations", { leadId: ls.id, lines: [{ catalogId: item, qty: 1 }] })).d;
  assert.equal(qs.taxRate, 10); assert.equal(qs.total, 1100000); assert.equal(qs.terms, "Syarat uji pengaturan.");
  assert.equal(qs.validUntil, new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const { processOutbox, enqueue } = await import("./woPush.js");
  process.env.CRM_INTEGRATION_KEY = CRM_KEY;
  await rq("tAdmin", "PUT", "/admin/settings", { woSync: { paused: true } });
  await enqueue("CATALOG", item); woCalls.length = 0;
  assert.equal((await processOutbox()).done, 0); assert.equal(woCalls.length, 0); // dijeda
  assert.equal((await rq("tAdmin", "GET", "/admin/settings")).d.integration.wo.paused, true);
  await rq("tAdmin", "PUT", "/admin/settings", { woSync: { paused: false } });
  await pool.query("DELETE FROM wo_outbox");

  // ── backup manual, daftar, unduh, unggah, hapus ──
  const bk = await rq("tAdmin", "POST", "/admin/data/backup", { note: "uji" }); assert.equal(bk.s, 201);
  assert.match(bk.d.name, /^crm-manual-\d{8}-\d{6}\.json\.gz$/); assert.equal(bk.d.valid, true); assert.ok(bk.d.tables.leads >= 1);
  const dl = await fetch(`${base}/crm/api/admin/data/backups/${bk.d.name}/download`, { headers: { Authorization: "Bearer tAdmin" } });
  assert.equal(dl.status, 200);
  const raw = Buffer.from(await dl.arrayBuffer());
  const zlib = await import("node:zlib");
  const head = JSON.parse(zlib.gunzipSync(raw).toString().split("\n")[0]);
  assert.deepEqual([head.format, head.version], ["maung-crm-backup", 1]);
  assert.equal((await fetch(`${base}/crm/api/admin/data/backups/..%2Fetc.json.gz/download`, { headers: { Authorization: "Bearer tAdmin" } })).status, 404);
  const upOk = new FormData(); upOk.set("file", new Blob([new Uint8Array(raw)]), "salinan.json.gz");
  assert.equal((await fetch(`${base}/crm/api/admin/data/backups/upload`, { method: "POST", headers: { Authorization: "Bearer tAdmin" }, body: upOk })).status, 201);
  const upBad = new FormData(); upBad.set("file", new Blob([zlib.gzipSync(Buffer.from('{"format":"maung-backup"}\n'))]), "dari-wo.json.gz"); // format WO ditolak
  const rb = await fetch(`${base}/crm/api/admin/data/backups/upload`, { method: "POST", headers: { Authorization: "Bearer tAdmin" }, body: upBad });
  assert.equal(rb.status, 400); assert.ok(fs.readdirSync(process.env.BACKUP_DIR).every((n) => !n.includes("dari-wo")));
  let list = (await rq("tAdmin", "GET", "/admin/data/overview")).d; assert.ok(list.backups.length >= 2);
  const up1 = list.backups.find((b: any) => b.name.includes("crm-upload"));
  assert.equal((await rq("tAdmin", "DELETE", `/admin/data/backups/${up1.name}`)).s, 200);
  assert.equal((await rq("tAdmin", "DELETE", "/admin/data/backups/..%2F..%2Fx")).s, 400);

  // ── data demo: akun demo WO (tanpa membuat akun CRM), semua status, ditandai isDemo ──
  assert.equal((await rq("tAdmin", "POST", "/admin/data/demo", { confirm: "muat demo" })).s, 400);
  const demo = await rq("tAdmin", "POST", "/admin/data/demo", { confirm: "MUAT DEMO" });
  assert.equal(demo.s, 200); assert.ok(demo.d.people.some((p: any) => p.id === "u-demo-mkt")); assert.ok(!demo.d.people.some((p: any) => p.id === "u-luar" || p.id === "u-demo-noc")); // hanya Admin + akun demo MKT
  assert.deepEqual(demo.d.counts, { catalog: 4, leads: 18, quotations: 8, reports: 10, tasks: 5 });
  assert.deepEqual((await q1("SELECT status FROM quotations WHERE is_demo ORDER BY status")).map((x) => x.status), ["ACCEPTED", "APPROVED", "CANCELLED", "DRAFT", "EXPIRED", "PENDING_APPROVAL", "REJECTED", "SENT"]);
  assert.deepEqual((await q1("SELECT DISTINCT status FROM field_reports WHERE is_demo ORDER BY status")).map((x) => x.status), ["COMPLETED", "DRAFT", "REVIEWED", "REVISION_REQUIRED", "SUBMITTED"]);
  assert.equal((await q1("SELECT count(*)::int n FROM leads WHERE is_demo AND (owner_id NOT IN ('u-admin','u-demo-mkt'))"))[0].n, 0);
  assert.ok((await q1("SELECT count(*)::int n FROM leads WHERE is_demo AND created_by_name IS NOT NULL AND owner_name <> ''"))[0].n === 18); // jejak id+nama tersimpan
  assert.equal((await rq("tAdmin", "GET", "/dashboard")).d.hasDemo, true);
  assert.ok((await rq("tAdmin", "GET", "/dashboard")).d.leads.created >= 18);

  // ── baris demo TIDAK PERNAH dikirim ke WO ──
  woCalls.length = 0;
  const dq = (await q1("SELECT id FROM quotations WHERE is_demo AND status='SENT'"))[0].id;
  const dc = (await q1("SELECT id FROM catalog_items WHERE is_demo LIMIT 1"))[0].id;
  await enqueue("QUOTATION", dq); await enqueue("CATALOG", dc);
  assert.equal((await q1("SELECT count(*)::int n FROM wo_outbox"))[0].n, 0); // tidak diantre sama sekali
  await pool.query("INSERT INTO wo_outbox (kind,ref_id,crm_id) VALUES ('QUOTATION',$1,'quotation-demo'),('CATALOG',$2,'catalog-demo')", [dq, dc]); // paksa baris outbox demo
  await processOutbox(); assert.equal(woCalls.length, 0);
  assert.equal((await q1("SELECT count(*)::int n FROM wo_outbox WHERE status='DONE'"))[0].n, 2);
  const { enqueueBackfill } = await import("./woPush.js"); await pool.query("DELETE FROM wo_outbox"); await enqueueBackfill();
  assert.equal((await q1("SELECT count(*)::int n FROM wo_outbox o JOIN quotations q ON o.kind='QUOTATION' AND q.id=o.ref_id WHERE q.is_demo"))[0].n, 0);
  // lead demo → penawaran baru ikut demo; item demo tak boleh dipakai penawaran nyata
  const dl1 = (await q1("SELECT id FROM leads WHERE is_demo AND kind='NON_INTERNET' AND stage='NEW' LIMIT 1"))[0].id;
  const dq2 = (await rq("tAdmin", "POST", "/quotations", { leadId: dl1, lines: [{ catalogId: dc, qty: 1 }] })).d;
  assert.equal((await q1("SELECT is_demo FROM quotations WHERE id=$1", [dq2.id]))[0].is_demo, true);
  assert.equal((await rq("tNurman", "POST", "/quotations", { leadId: ls.id, lines: [{ catalogId: dc, qty: 1 }] })).s, 400);
  // lead demo tidak ditautkan otomatis ke pelanggan WO
  const { refreshLeadLinks } = await import("./leads.js"); await refreshLeadLinks();
  assert.equal((await q1("SELECT count(*)::int n FROM leads WHERE is_demo AND customer_code IS NOT NULL"))[0].n, 0);

  // ── uji sambung: penawaran demo dikirim ke WO HANYA lewat aksi eksplisit, dengan demo:true ──
  const dqs = (await rq("tAdmin", "GET", "/admin/data/demo-quotations")).d.items;
  assert.equal(dqs.length, 9); assert.ok(dqs.find((x: any) => x.status === "DRAFT").sendable === false);
  const dSent = dqs.find((x: any) => x.status === "SENT"), dDraft = dqs.find((x: any) => x.status === "DRAFT");
  const realQ = (await q1("SELECT id FROM quotations WHERE NOT is_demo LIMIT 1"))[0].id;
  assert.equal((await rq("tAdmin", "POST", "/admin/data/demo-quotations/send-test", { ids: [dSent.id], confirm: "kirim uji" })).s, 400);
  assert.equal((await rq("tNurman", "POST", "/admin/data/demo-quotations/send-test", { ids: [dSent.id], confirm: "KIRIM UJI" })).s, 403);
  woCalls.length = 0;
  const outboxBefore = (await q1("SELECT count(*)::int n FROM wo_outbox"))[0].n;
  const tst = await rq("tAdmin", "POST", "/admin/data/demo-quotations/send-test", { ids: [dSent.id, dDraft.id, realQ], confirm: "KIRIM UJI" });
  assert.equal(tst.s, 200);
  const byId = Object.fromEntries(tst.d.results.map((r: any) => [r.id, r]));
  assert.equal(byId[dSent.id].ok, true, byId[dSent.id].message); assert.equal(byId[dDraft.id].ok, false); assert.equal(byId[realQ].ok, false);
  assert.equal(woCalls.length, 1); assert.equal(woCalls[0].body.demo, true); assert.ok(woCalls[0].body.marketingUserId && woCalls[0].body.marketingName); // jejak tetap wajib
  assert.equal((await q1("SELECT wo_test_status FROM quotations WHERE id=$1", [dSent.id]))[0].wo_test_status, "QUOTED");
  assert.equal((await q1("SELECT wo_synced_at FROM quotations WHERE id=$1", [dSent.id]))[0].wo_synced_at, null); // status kirim nyata tak tersentuh
  assert.equal((await q1("SELECT count(*)::int n FROM wo_outbox"))[0].n, outboxBefore); // tidak lewat antrean
  woMode = "down"; woCalls.length = 0;
  const badSend = await rq("tAdmin", "POST", "/admin/data/demo-quotations/send-test", { ids: [dSent.id], confirm: "KIRIM UJI" });
  assert.equal(badSend.d.results[0].ok, false); assert.match((await q1("SELECT wo_test_error FROM quotations WHERE id=$1", [dSent.id]))[0].wo_test_error, /503/); woMode = "ok";
  // pengiriman nyata biasa tidak membawa demo:true
  assert.ok(!woCalls.some((c) => c.body?.demo === true && c.path !== `quotations/quotation-${dSent.id}`));

  // ── rekonsiliasi baca-saja ──
  assert.equal((await rq("tNurman", "GET", "/admin/data/reconcile")).s, 403);
  const key = `quotation-${dSent.id}`;
  woQuotes.set("quotation-9999", { number: "QT-X", rev: 1, status: "QUOTED", total: 5, demo: false, marketingUserId: "u", marketingName: "n", lines: [{}] }); // ada di WO, tak ada di CRM
  woQuotes.set("quotation-9998", { number: "QT-D", rev: 1, status: "QUOTED", total: 5, demo: true, marketingUserId: "u", marketingName: "n", lines: [{}] }); // sisa demo yatim di WO
  woCalls.length = 0;
  let rc = (await rq("tAdmin", "GET", "/admin/data/reconcile")).d;
  assert.equal(woCalls.filter((c) => c.method !== "GET").length, 0); // pembacaan tidak menulis ke WO
  assert.ok(rc.woCount >= 3); assert.ok(rc.onlyInWo.some((x: any) => x.crmId === "quotation-9999"));
  assert.ok(rc.demoInWo.some((x: any) => x.crmId === key && x.inCrm === true)); assert.ok(rc.demoInWo.some((x: any) => x.crmId === "quotation-9998" && x.inCrm === false));
  assert.equal(rc.ok, false);
  woQuotes.get(key).total = 1; woQuotes.get(key).status = "WON";
  rc = (await rq("tAdmin", "GET", "/admin/data/reconcile")).d;
  const mm = rc.mismatched.find((x: any) => x.crmId === key); assert.ok(mm && mm.problems.length >= 2);
  woQuotes.delete(key);
  rc = (await rq("tAdmin", "GET", "/admin/data/reconcile")).d;
  assert.ok(rc.missingInWo.some((x: any) => x.crmId === key && x.demo === true));
  woQuotes.delete("quotation-9999"); woQuotes.delete("quotation-9998");
  delete process.env.CRM_INTEGRATION_KEY; assert.equal((await rq("tAdmin", "GET", "/admin/data/reconcile")).s, 400); process.env.CRM_INTEGRATION_KEY = CRM_KEY;

  // ── purge hanya demo: data nyata utuh ──
  const real = { leads: (await q1("SELECT count(*)::int n FROM leads WHERE NOT is_demo"))[0].n, quotes: (await q1("SELECT count(*)::int n FROM quotations WHERE NOT is_demo"))[0].n, cat: (await q1("SELECT count(*)::int n FROM catalog_items WHERE NOT is_demo"))[0].n };
  assert.equal((await rq("tAdmin", "POST", "/admin/data/purge", { onlyDemo: true, confirm: "hapus data" })).s, 400);
  const pd = await rq("tAdmin", "POST", "/admin/data/purge", { onlyDemo: true, confirm: "HAPUS DATA" });
  assert.equal(pd.s, 200); assert.match(pd.d.backup, /^crm-pre-purge-/); assert.equal(pd.d.testSent, 1); // pemilik diingatkan: ada penawaran uji sambung di WO
  assert.deepEqual(await q1("SELECT (SELECT count(*)::int FROM leads WHERE is_demo) a, (SELECT count(*)::int FROM quotations WHERE is_demo) b, (SELECT count(*)::int FROM field_reports WHERE is_demo) c, (SELECT count(*)::int FROM catalog_items WHERE is_demo) d, (SELECT count(*)::int FROM field_report_comments WHERE report_id NOT IN (SELECT id FROM field_reports)) e"), [{ a: 0, b: 0, c: 0, d: 0, e: 0 }]);
  assert.deepEqual([(await q1("SELECT count(*)::int n FROM leads"))[0].n, (await q1("SELECT count(*)::int n FROM quotations"))[0].n, (await q1("SELECT count(*)::int n FROM catalog_items"))[0].n], [real.leads, real.quotes, real.cat]);
  assert.equal((await rq("tAdmin", "GET", "/dashboard")).d.hasDemo, false);
  assert.equal((await q1("SELECT count(*)::int n FROM crm_settings WHERE key='demo'"))[0].n, 0);

  // ── restore: round-trip + sequence tidak bentrok + admin tetap ──
  const snap = await rq("tAdmin", "POST", "/admin/data/backup", { note: "snapshot restore" });
  const before = (await q1("SELECT (SELECT count(*)::int FROM leads) l, (SELECT count(*)::int FROM quotations) q, (SELECT count(*)::int FROM field_reports) r, (SELECT count(*)::int FROM catalog_items) c, (SELECT count(*)::int FROM wo_customers) w"))[0];
  assert.equal((await rq("tAdmin", "POST", "/admin/data/purge", { scope: 3, deleteUsers: true, confirm: "HAPUS DATA" })).s, 200);
  const empty = (await q1("SELECT (SELECT count(*)::int FROM leads) l, (SELECT count(*)::int FROM quotations) q, (SELECT count(*)::int FROM catalog_items) c, (SELECT count(*)::int FROM wo_customers) w, (SELECT count(*)::int FROM crm_settings) s, (SELECT count(*)::int FROM wo_user_cache WHERE user_id='u-admin') a, (SELECT count(*)::int FROM wo_user_cache) u"))[0];
  assert.deepEqual([empty.l, empty.q, empty.c, empty.w], [0, 0, 0, 0]); assert.ok(empty.s >= 1); assert.equal(empty.a, 1); assert.equal(empty.u, 1); // pengaturan & akun Admin selamat; cache akun lain dibersihkan
  assert.equal((await rq("tAdmin", "POST", `/admin/data/backups/${snap.d.name}/restore`, { confirm: "restore" })).s, 400);
  const rs = await rq("tAdmin", "POST", `/admin/data/backups/${snap.d.name}/restore`, { confirm: "RESTORE" });
  assert.equal(rs.s, 200); assert.match(rs.d.preBackup, /^crm-pre-restore-/);
  assert.deepEqual((await q1("SELECT (SELECT count(*)::int FROM leads) l, (SELECT count(*)::int FROM quotations) q, (SELECT count(*)::int FROM field_reports) r, (SELECT count(*)::int FROM catalog_items) c, (SELECT count(*)::int FROM wo_customers) w"))[0], before);
  const nl = await rq("tNurman", "POST", "/leads", { kind: "INTERNET", name: "Setelah Restore", phone: "0812 6666 0001" }); // id baru tidak bentrok (sequence dimajukan)
  assert.equal(nl.s, 201);
  await pool.query("INSERT INTO wo_user_cache (user_id,name,email,role) VALUES ('u-nurman','Nurman','nurman@l1v.local','MKT') ON CONFLICT (user_id) DO NOTHING");
  const nr = await rq("tNurman", "POST", "/reports", { activityType: "SURVEY", summary: "Setelah restore", picIds: ["u-nurman"] }); assert.equal(nr.s, 201);
  assert.equal((await rq("tAdmin", "POST", "/admin/data/backups/crm-manual-20200101-000000.json.gz/restore", { confirm: "RESTORE" })).s, 400);

  // ── purge cakupan 1 dan 2 ──
  assert.equal((await rq("tAdmin", "POST", "/admin/data/purge", { scope: 1, confirm: "HAPUS DATA", backupFirst: false })).s, 200);
  assert.deepEqual((await q1("SELECT (SELECT count(*)::int FROM leads) l, (SELECT count(*)::int FROM field_reports) r, (SELECT count(*)::int FROM wo_customers) w, (SELECT count(*)::int FROM catalog_items) c"))[0], { l: 0, r: 0, w: before.w, c: before.c }); // cermin & katalog tetap
  assert.equal((await rq("tAdmin", "POST", "/admin/data/purge", { scope: 2, confirm: "HAPUS DATA", backupFirst: false })).s, 200);
  assert.deepEqual((await q1("SELECT (SELECT count(*)::int FROM wo_customers) w, (SELECT count(*)::int FROM catalog_items) c"))[0], { w: 0, c: before.c });

  // ── backup otomatis harian ──
  const { autoBackupTick } = await import("./autoBackup.js");
  const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  assert.equal(await autoBackupTick(at(2, 0)), null); // belum jam 02:30
  const auto = await autoBackupTick(at(3)); assert.match(auto!, /^crm-auto-\d{8}-\d{6}\.json\.gz$/);
  assert.equal(await autoBackupTick(at(4)), null); // sudah ada hari ini
  for (const n of fs.readdirSync(process.env.BACKUP_DIR!).filter((x) => x.startsWith("crm-auto-"))) fs.rmSync(`${process.env.BACKUP_DIR}/${n}`);
  assert.equal((await rq("tAdmin", "PUT", "/admin/data/auto", { autoDaily: false })).s, 200);
  assert.equal(await autoBackupTick(at(5)), null); // dimatikan
  await rq("tAdmin", "PUT", "/admin/data/auto", { autoDaily: true });
  delete process.env.CRM_INTEGRATION_KEY;
});

test("Notifikasi → WO (POST /integrations/crm/notifications): lewat antrean, idempoten, 404 tidak diulang, link berawalan /crm, jeda & sakelar ditaati", async () => {
  const { notify } = await import("./notify.js");
  const { processOutbox } = await import("./woPush.js");
  process.env.CRM_INTEGRATION_KEY = CRM_KEY; woMode = "ok"; woNotes.length = 0;
  await pool.query("DELETE FROM wo_outbox"); await pool.query("DELETE FROM crm_notifications");
  await notify(["u-nurman"], { type: "QUOTATION_APPROVED", title: "Penawaran QT-1 disetujui", body: "x", href: "/quotations/1", key: "k1" });
  await notify(["u-nurman"], { type: "QUOTATION_APPROVED", title: "ganda", href: "/quotations/1", key: "k1" }); // dedupe lokal: tidak diantre lagi
  await notify(["u-gone"], { type: "TASK_DUE", title: "untuk pengguna hilang", key: "k2" });
  assert.equal((await pool.query("SELECT count(*)::int n FROM wo_outbox WHERE kind='NOTIFICATION'")).rows[0].n, 2);
  const r = await processOutbox(); assert.equal(r.done, 2); assert.equal(r.blocked + r.retry, 0); // 404 → selesai (dilewati), bukan BLOCKED
  assert.equal(woNotes.length, 1); assert.deepEqual([woNotes[0].userId, woNotes[0].link, woNotes[0].dedupeKey, woNotes[0].type], ["u-nurman", "/crm/quotations/1", "k1", "QUOTATION_APPROVED"]);
  // WO turun → dicoba ulang, tidak hilang
  await notify(["u-nurman"], { type: "REPORT_COMMENT", title: "komentar", href: "/reports/2", key: "k3" });
  woMode = "down"; const r2 = await processOutbox(); assert.equal(r2.retry, 1);
  woMode = "ok"; await pool.query("UPDATE wo_outbox SET next_attempt_at=now() WHERE status='PENDING'");
  assert.equal((await processOutbox()).done, 1); assert.equal(woNotes.length, 2);
  // sakelar: WO_NOTIFY_ENABLED=0 → hanya lonceng, tidak diantre
  process.env.WO_NOTIFY_ENABLED = "0";
  await notify(["u-nurman"], { type: "TASK_DUE", title: "tanpa push", key: "k4" });
  assert.equal((await pool.query("SELECT count(*)::int n FROM wo_outbox WHERE status='PENDING'")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM crm_notifications WHERE dedupe_key='k4'")).rows[0].n, 1);
  delete process.env.WO_NOTIFY_ENABLED; delete process.env.CRM_INTEGRATION_KEY;
});
