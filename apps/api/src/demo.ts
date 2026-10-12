import { pool } from "./db.js";
import { WO_URL } from "./auth.js";
import { normalizePhone } from "./phone.js";
import { totals } from "./quotations.js";
import { purgeData } from "./backup.js";

/**
 * Data demo CRM (Admin → Data & Backup → "Muat data demo").
 * - Memakai AKUN DEMO WO (mkt@, … ) dan Admin yang sedang login: id & nama diambil dari WO (GET /api/users dengan token Admin), TIDAK membuat akun di CRM.
 * - Setiap baris ditandai is_demo=true. Pengirim ke WO (outbox) dan penautan otomatis ke pelanggan WO melewati baris demo → tidak pernah membuat order/pelanggan di WO.
 * - Dimasukkan langsung lewat SQL (bukan lewat API) sehingga tidak ada antrean kirim yang terbentuk.
 */
export interface Person { id: string; name: string; role: string; subRole?: string | null; email?: string }

/** Akun demo/Marketing di WO. Gagal terjangkau → hanya Admin yang dipakai (peringatan dikembalikan). */
export async function lookupPeople(admin: Person, token: string): Promise<{ people: Person[]; warnings: string[] }> {
  const warnings: string[] = [];
  const people: Person[] = [admin];
  try {
    const r = await fetch(`${WO_URL()}/api/users`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const all = (await r.json()) as (Person & { active?: boolean })[];
    const demo = all.filter((u) => u.active !== false && /@l1v\.local$/i.test(u.email ?? "") && u.id !== admin.id);
    const mkt = demo.filter((u) => u.role === "MKT");
    people.push(...mkt.slice(0, 3));
    if (!mkt.length) warnings.push("Akun demo Marketing (mkt@…) tidak ditemukan di WO — data demo memakai Admin saja.");
  } catch (e) { warnings.push(`Daftar pengguna WO tidak terjangkau (${(e as Error).message}) — data demo memakai Admin saja.`); }
  return { people, warnings };
}

const ago = (days: number, hour = 9) => { const d = new Date(Date.now() - days * 86_400_000); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const dateOnly = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const AREAS = ["Bandung", "Bekasi", "Cimahi", "Ciwidey"];

export async function loadDemo(admin: Person, token: string, by: string) {
  const { people, warnings } = await lookupPeople(admin, token);
  await purgeData({ onlyDemo: true, deleteFiles: true }); // muat ulang: demo lama diganti
  const c = await pool.connect();
  const y3 = String(new Date().getFullYear() % 1000).padStart(3, "0");
  const counts = { catalog: 0, leads: 0, quotations: 0, reports: 0, tasks: 0 };
  try {
    await c.query("BEGIN");
    // cache identitas WO (bukan akun CRM) agar daftar PIC/pemilik mengenali akun demo
    for (const p of people) if (p.id !== admin.id) await c.query(`INSERT INTO wo_user_cache (user_id,name,email,role,sub_role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO NOTHING`, [p.id, p.name, p.email ?? null, p.role, p.subRole ?? null]);
    const P = (i: number) => people[i % people.length];
    const reviewer = people.find((p) => p.role === "MKT" && (p.subRole === "SUPERVISOR" || p.subRole === "MANAGER")) ?? admin;

    // ── katalog demo ──
    const cat: Record<string, { id: number; name: string; sku: string | null; kind: string; unit: string; price: number }> = {};
    for (const [key, name, sku, kind, unit, price] of [
      ["wifi", "DEMO Sewa WiFi Bulanan", null, "SERVICE", "bulan", 150000], ["cctv", "DEMO CCTV Dome 2MP", "DEMO-CCTV-2MP", "PRODUCT", "unit", 850000],
      ["pasang", "DEMO Jasa Instalasi CCTV", null, "SERVICE", "titik", 150000], ["utp", "DEMO Kabel UTP Cat6", "DEMO-UTP-CAT6", "PRODUCT", "meter", 7500],
    ] as const) {
      const r = await c.query(`INSERT INTO catalog_items (name,sku,kind,unit,price,description,created_by,is_demo) VALUES ($1,$2,$3,$4,$5,'Data demo',$6,true) RETURNING id`, [name, sku, kind, unit, price, admin.id]);
      cat[key] = { id: Number(r.rows[0].id), name, sku, kind, unit, price }; counts.catalog++;
    }

    // ── lead demo ──
    type L = { name: string; kind: "INTERNET" | "NON_INTERNET"; stage: string; interest: string; reason?: string; auto?: boolean; existing?: boolean; age: number };
    const L: L[] = [
      { name: "Andi Wijaya", kind: "INTERNET", stage: "NEW", interest: "Home 20", age: 2 }, { name: "Rina Marlina", kind: "INTERNET", stage: "CONTACTED", interest: "Home 10", age: 6 },
      { name: "CV Sinar Jaya", kind: "INTERNET", stage: "QUALIFIED", interest: "Biz 50", age: 9 }, { name: "Dewi Lestari", kind: "INTERNET", stage: "REGISTERED", interest: "Home 20", age: 12 },
      { name: "Bambang Hartono", kind: "INTERNET", stage: "INSTALLING", interest: "Home 30", age: 15 }, { name: "Siti Nurhaliza", kind: "INTERNET", stage: "WON", interest: "Home 20", age: 24 },
      { name: "Joko Prasetyo", kind: "INTERNET", stage: "LOST", interest: "Home 10", reason: "Pindah lokasi", age: 20 },
      { name: "Maya Sari", kind: "INTERNET", stage: "LOST", interest: "Home 20", reason: "WO Pasang Baru DEMO ditolak (validasi teknis)", auto: true, age: 18 },
      { name: "Pak Haji (pelanggan lama)", kind: "INTERNET", stage: "NEW", interest: "Home 50", existing: true, age: 3 },
      { name: "Toko Berkah", kind: "NON_INTERNET", stage: "NEW", interest: "CCTV 2 titik", age: 1 }, { name: "Kantor Notaris Adi", kind: "NON_INTERNET", stage: "QUOTING", interest: "CCTV 4 titik", age: 8 },
      { name: "Hotel Melati", kind: "NON_INTERNET", stage: "NEGOTIATION", interest: "Sewa WiFi 20 kamar", age: 14 }, { name: "Klinik Sehat Sentosa", kind: "NON_INTERNET", stage: "WON", interest: "CCTV 8 titik", age: 26 },
      { name: "Warung Bu Tini", kind: "NON_INTERNET", stage: "LOST", interest: "CCTV 1 titik", reason: "Harga di atas anggaran", age: 21 }, { name: "PT Maju Mundur", kind: "NON_INTERNET", stage: "QUOTING", interest: "Sewa WiFi gudang", age: 5 },
      { name: "Sekolah Harapan", kind: "NON_INTERNET", stage: "NEGOTIATION", interest: "CCTV 12 titik", age: 11 }, { name: "Toko Elektronik Jaya", kind: "NON_INTERNET", stage: "LOST", interest: "CCTV 3 titik", reason: "Penawaran kedaluwarsa", age: 29 },
      { name: "Gudang Sentral", kind: "NON_INTERNET", stage: "LOST", interest: "Sewa WiFi", reason: "Dibatalkan pelanggan", age: 17 },
    ];
    const leadId: Record<string, number> = {};
    const FLOW = ["NEW", "CONTACTED", "QUALIFIED", "REGISTERED", "INSTALLING", "QUOTING", "NEGOTIATION"];
    for (const [i, l] of L.entries()) {
      const o = P(i), ph = `0899 0000 ${String(100 + i).padStart(4, "0")}`, pn = normalizePhone(ph), at = ago(l.age);
      const closed = l.stage === "WON" || l.stage === "LOST";
      const r = await c.query(
        `INSERT INTO leads (kind,stage,name,phone,phone_norm,phone_digits,email,address,area,interest,source,notes,owner_id,owner_name,existing_customer,lost_reason,lost_auto,won_at,closed_at,created_by,created_by_name,created_at,updated_at,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Data demo',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21,true) RETURNING id`,
        [l.kind, l.stage, l.name, ph, pn.e164, pn.digits || null, `demo${i}@contoh.id`, `Jl. Contoh No. ${10 + i}, ${AREAS[i % AREAS.length]} (DEMO)`, AREAS[i % AREAS.length], l.interest, ["Canvassing", "Referral", "Walk-in", "Event"][i % 4],
         o.id, o.name, !!l.existing, l.reason ?? null, !!l.auto, l.stage === "WON" ? ago(Math.max(l.age - 5, 0)) : null, closed ? ago(Math.max(l.age - 5, 0)) : null, o.id, o.name, at]);
      const id = Number(r.rows[0].id); leadId[l.name] = id; counts.leads++;
      await c.query(`INSERT INTO lead_events (lead_id,type,to_stage,note,actor_id,actor_name,at) VALUES ($1,'CREATED','NEW','Data demo',$2,$3,$4)`, [id, o.id, o.name, at]);
      const path = l.stage === "WON" || l.stage === "LOST" ? FLOW.filter((s) => (l.kind === "INTERNET" ? !["QUOTING", "NEGOTIATION"].includes(s) : !["REGISTERED", "INSTALLING"].includes(s))).slice(1, 3) : FLOW.slice(1, FLOW.indexOf(l.stage) + 1).filter((s) => (l.kind === "INTERNET" ? !["QUOTING", "NEGOTIATION"].includes(s) : !["REGISTERED", "INSTALLING"].includes(s)));
      let prev = "NEW";
      for (const [k, s] of [...path, ...(closed ? [l.stage] : [])].entries()) {
        await c.query(`INSERT INTO lead_events (lead_id,type,from_stage,to_stage,note,actor_id,actor_name,at) VALUES ($1,'STAGE',$2,$3,$4,$5,$6,$7)`,
          [id, prev, s, s === "LOST" ? l.reason : null, l.auto && s === "LOST" ? null : o.id, l.auto && s === "LOST" ? null : o.name, ago(Math.max(l.age - 1 - k, 0))]);
        prev = s;
      }
    }

    // ── penawaran demo: semua status ──
    type Q = { lead: string; status: string; rev?: number; lines: [keyof typeof cat, number][]; discount?: number; note?: string };
    const Qs: Q[] = [
      { lead: "Kantor Notaris Adi", status: "DRAFT", lines: [["cctv", 4], ["pasang", 4]] },
      { lead: "PT Maju Mundur", status: "PENDING_APPROVAL", lines: [["wifi", 12]] },
      { lead: "Sekolah Harapan", status: "APPROVED", lines: [["cctv", 12], ["pasang", 12], ["utp", 120]], discount: 500000 },
      { lead: "Hotel Melati", status: "SENT", rev: 2, lines: [["wifi", 20]], discount: 300000 },
      { lead: "Klinik Sehat Sentosa", status: "ACCEPTED", lines: [["cctv", 8], ["pasang", 8], ["utp", 80]] },
      { lead: "Warung Bu Tini", status: "REJECTED", lines: [["cctv", 1], ["pasang", 1]], note: "Harga di atas anggaran" },
      { lead: "Toko Elektronik Jaya", status: "EXPIRED", lines: [["cctv", 3], ["pasang", 3]], note: "Masa berlaku berakhir" },
      { lead: "Gudang Sentral", status: "CANCELLED", lines: [["wifi", 6]], note: "Dibatalkan pelanggan" },
    ];
    for (const [i, qd] of Qs.entries()) {
      const lead = L.find((x) => x.name === qd.lead)!, lid = leadId[qd.lead];
      const o = P(L.indexOf(lead)), rev = qd.rev ?? 1, tax = 11, disc = qd.discount ?? 0;
      const priced = qd.lines.map(([k, qty]) => ({ k, qty, unitPrice: cat[k].price }));
      const t = totals(priced, disc, tax);
      const number = `DEMO-${y3}-${String(i + 1).padStart(4, "0")}`;
      const after = (s: string) => ["APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(s);
      const created = ago(lead.age - 1);
      const sent = ["SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(qd.status) ? ago(Math.max(lead.age - 3, 0)) : null;
      const r = await c.query(
        `INSERT INTO quotations (number,rev,status,lead_id,owner_id,owner_name,customer_name,customer_phone,customer_email,customer_address,pic_name,subject,valid_until,terms,notes,tax_rate,discount,subtotal,tax_amount,total,
           sent_at,decided_at,decision_note,approved_by,approved_by_name,approved_at,created_by,created_by_name,created_at,updated_at,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Harga dalam Rupiah. Data demo.','Data demo',$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$27,true) RETURNING id`,
        [number, rev, qd.status, lid, o.id, o.name, lead.name, `0899 0000 ${String(100 + L.indexOf(lead)).padStart(4, "0")}`, `demo${L.indexOf(lead)}@contoh.id`, `Jl. Contoh No. ${10 + L.indexOf(lead)}, ${AREAS[L.indexOf(lead) % AREAS.length]} (DEMO)`, "PIC Demo", lead.interest,
         qd.status === "EXPIRED" ? dateOnly(-5) : dateOnly(qd.status === "SENT" || qd.status === "APPROVED" ? 14 : 7), tax, disc, t.subtotal, t.taxAmount, t.total,
         sent, ["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"].includes(qd.status) ? ago(Math.max(lead.age - 5, 0)) : null, qd.note ?? null,
         after(qd.status) ? reviewer.id : null, after(qd.status) ? reviewer.name : null, after(qd.status) ? ago(Math.max(lead.age - 2, 0)) : null, o.id, o.name, created]);
      const qid = Number(r.rows[0].id); counts.quotations++;
      for (const [pos, l2] of priced.entries()) await c.query(`INSERT INTO quotation_lines (quotation_id,position,catalog_id,name,sku,kind,unit,qty,unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [qid, pos, cat[l2.k].id, cat[l2.k].name, cat[l2.k].sku, cat[l2.k].kind, cat[l2.k].unit, l2.qty, l2.unitPrice]);
      await c.query(`INSERT INTO quotation_events (quotation_id,type,to_status,note,actor_id,actor_name,at) VALUES ($1,'CREATED','DRAFT','Data demo',$2,$3,$4)`, [qid, o.id, o.name, created]);
      const steps = ["PENDING_APPROVAL", "APPROVED", "SENT"].slice(0, ["PENDING_APPROVAL", "APPROVED", "SENT"].indexOf(qd.status === "ACCEPTED" || qd.status === "REJECTED" || qd.status === "EXPIRED" ? "SENT" : qd.status) + 1);
      let prev = "DRAFT";
      for (const [k, s] of [...steps, ...(["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"].includes(qd.status) ? [qd.status] : [])].entries()) {
        await c.query(`INSERT INTO quotation_events (quotation_id,type,from_status,to_status,note,actor_id,actor_name,at) VALUES ($1,'STATUS',$2,$3,$4,$5,$6,$7)`,
          [qid, prev, s, ["REJECTED", "CANCELLED", "EXPIRED"].includes(s) ? qd.note : null, s === "EXPIRED" ? null : (s === "APPROVED" ? reviewer.id : o.id), s === "EXPIRED" ? null : (s === "APPROVED" ? reviewer.name : o.name), ago(Math.max(lead.age - 1 - k, 0))]);
        prev = s;
      }
      if (rev > 1) await c.query(`INSERT INTO quotation_revisions (quotation_id,rev,snapshot,reason,actor_id,actor_name,at) VALUES ($1,1,$2,'Revisi diskon (demo)',$3,$4,$5)`, [qid, JSON.stringify({ total: t.total + 300000, status: "SENT", demo: true }), o.id, o.name, ago(Math.max(lead.age - 6, 0))]);
    }

    // ── field report demo (semua status) + follow-up + review ──
    type R = { type: string; area: string; status: string; age: number; gps: boolean; counterpart: string; task?: "overdue" | "open" | "done" };
    const Rs: R[] = [
      { type: "CANVASSING", area: "Panundaan", status: "COMPLETED", age: 25, gps: true, counterpart: "Pengurus BUMDes", task: "done" }, { type: "MEETING", area: "Bandung", status: "COMPLETED", age: 20, gps: true, counterpart: "Manajer Hotel" },
      { type: "SURVEY", area: "Ciwidey", status: "COMPLETED", age: 16, gps: false, counterpart: "Kepala Desa", task: "done" }, { type: "CANVASSING", area: "Bekasi", status: "REVIEWED", age: 9, gps: true, counterpart: "RT/RW setempat", task: "open" },
      { type: "FOLLOW_UP", area: "Cimahi", status: "REVIEWED", age: 7, gps: true, counterpart: "Pemilik toko" }, { type: "PARTNERSHIP", area: "Panundaan", status: "SUBMITTED", age: 4, gps: true, counterpart: "Koperasi", task: "overdue" },
      { type: "CANVASSING", area: "Bandung", status: "SUBMITTED", age: 3, gps: false, counterpart: "Pasar Induk" }, { type: "COMMUNITY_ENGAGEMENT", area: "Ciwidey", status: "SUBMITTED", age: 2, gps: true, counterpart: "Karang Taruna", task: "open" },
      { type: "MEETING", area: "Bekasi", status: "REVISION_REQUIRED", age: 6, gps: true, counterpart: "Kantor Kelurahan" }, { type: "SURVEY", area: "Bandung", status: "DRAFT", age: 1, gps: false, counterpart: "Calon mitra" },
    ];
    for (const [i, rd] of Rs.entries()) {
      const owner = P(i), pics = people.length > 1 && i % 2 === 0 ? [P(i), P(i + 1)] : [owner], at = ago(rd.age, 10);
      const r = await c.query(
        `INSERT INTO field_reports (activity_type,activity_at,counterpart,account_name,area,summary,next_action,gps_lat,gps_lng,gps_accuracy,gps_at,gps_source,location_status,status,submitted_at,created_by,created_by_name,created_at,updated_at,is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,'Tindak lanjut (demo)',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$2,$2,true) RETURNING id`,
        [rd.type, at, rd.counterpart, `${rd.counterpart} ${rd.area}`, rd.area, `Kunjungan demo di ${rd.area}: pembahasan layanan internet dan kemitraan.`,
         rd.gps ? -6.9 + i * 0.01 : null, rd.gps ? 107.6 + i * 0.01 : null, rd.gps ? 8 + i : null, rd.gps ? at : null, rd.gps ? "LIVE" : null, rd.gps ? "VERIFIED" : "UNVERIFIED", rd.status,
         rd.status === "DRAFT" ? null : at, owner.id, owner.name]);
      const rid = Number(r.rows[0].id); counts.reports++;
      for (const p of pics) await c.query(`INSERT INTO field_report_pics (report_id,user_id,name) VALUES ($1,$2,$3)`, [rid, p.id, p.name]);
      let pos = 0;
      for (const [kind, text] of [["DISCUSSION", "Pengenalan paket internet dan harga"], ["DISCUSSION", "Kebutuhan titik pemasangan"], ["AGREEMENT", "Survei lokasi minggu depan"], ["ISSUE", "Sinyal di area pinggir lemah"]] as const)
        await c.query(`INSERT INTO field_report_items (report_id,kind,text,position) VALUES ($1,$2,$3,$4)`, [rid, kind, text, pos++]);
      if (rd.task) {
        const due = rd.task === "overdue" ? dateOnly(-3) : dateOnly(5);
        await c.query(`INSERT INTO field_tasks (report_id,title,pic_user_id,pic_name,due_date,status,created_by,created_by_name,created_at,updated_at,is_demo) VALUES ($1,'Kirim proposal (demo)',$2,$3,$4,$5,$6,$7,$8,$8,true)`,
          [rid, owner.id, owner.name, due, rd.task === "done" ? "DONE" : "OPEN", owner.id, owner.name, at]); counts.tasks++;
      }
      const review: [string, string | null][] = rd.status === "REVIEWED" ? [["REVIEWED", "Sudah baik"]] : rd.status === "COMPLETED" ? [["REVIEWED", "Baik"], ["COMPLETED", null]] : rd.status === "REVISION_REQUIRED" ? [["REVISION_REQUIRED", "Lengkapi counterpart dan foto"]] : [];
      for (const [k, [kind, note]] of review.entries()) await c.query(`INSERT INTO field_report_comments (report_id,kind,note,actor_id,actor_name,at) VALUES ($1,$2,$3,$4,$5,$6)`, [rid, kind, note, reviewer.id, reviewer.name, ago(Math.max(rd.age - 1 - k, 0), 14)]);
    }
    await c.query(`INSERT INTO crm_settings (key,value,updated_by) VALUES ('demo',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now(), updated_by=$2`, [JSON.stringify({ loadedAt: new Date().toISOString(), by, people: people.map((p) => ({ id: p.id, name: p.name })) }), admin.id]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  return { counts, people: people.map((p) => ({ id: p.id, name: p.name, role: p.role })), warnings };
}
