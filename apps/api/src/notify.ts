import { pool } from "./db.js";

/**
 * Notifikasi dalam aplikasi (lonceng). Tidak pernah menggagalkan proses utama: kegagalan hanya dicatat.
 * Baris demo tidak menghasilkan notifikasi (pemanggil memeriksa is_demo).
 */
export interface Note { type: string; title: string; body?: string | null; href?: string | null; key?: string | null }

/** Teruskan ke WO (Telegram/email/kotak masuk sesuai preferensi penerima)? Perlu kunci integrasi; sakelar WO_NOTIFY_ENABLED=0 / WO_SYNC_ENABLED=0 mematikan. */
export const notifyPushEnabled = () => (process.env.CRM_INTEGRATION_KEY ?? "").length > 0 && (process.env.WO_NOTIFY_ENABLED ?? "1") !== "0" && (process.env.WO_SYNC_ENABLED ?? "1") !== "0";

export async function notify(userIds: (string | null | undefined)[], n: Note): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  try {
    for (const id of ids) {
      const r = await pool.query(
        `INSERT INTO crm_notifications (user_id,type,title,body,href,dedupe_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING id`,
        [id, n.type, n.title.slice(0, 200), n.body?.slice(0, 500) ?? null, n.href ?? null, n.key ?? null]);
      // baris baru → antre ke WO (antrean wo_outbox yang sama: coba ulang bertahap, jeda ikut berlaku); duplikat tidak diantre ulang
      if (r.rows[0] && notifyPushEnabled())
        await pool.query(`INSERT INTO wo_outbox (kind, ref_id, crm_id) VALUES ('NOTIFICATION',$1,$2) ON CONFLICT (kind, ref_id) WHERE status='PENDING' DO NOTHING`, [r.rows[0].id, `notification-${r.rows[0].id}`]);
    }
  } catch (e) { console.error("notifikasi:", (e as Error).message); }
}

/** Reviewer = Admin atau MKT Manager/Supervisor (sama dengan isReviewer), dari cache identitas WO. */
export async function reviewerIds(exceptId?: string): Promise<string[]> {
  const r = await pool.query(`SELECT user_id FROM wo_user_cache WHERE role='ADMIN' OR (role='MKT' AND sub_role IN ('MANAGER','SUPERVISOR'))`);
  return r.rows.map((x) => x.user_id as string).filter((id) => id !== exceptId);
}
export async function adminIds(): Promise<string[]> {
  return (await pool.query(`SELECT user_id FROM wo_user_cache WHERE role='ADMIN'`)).rows.map((x) => x.user_id as string);
}

const today = () => new Date().toISOString().slice(0, 10);

/** Pengingat berkala (tiap jam): follow-up jatuh tempo/terlambat, penawaran terkirim yang segera kedaluwarsa, antrean WO yang ditolak; lalu bersihkan yang lama. */
export async function sweepNotifications(): Promise<number> {
  let n = 0;
  const count = async (promise: Promise<void>) => { await promise; n++; };
  try {
    const t = today();
    const tasks = (await pool.query(
      `SELECT t.id, t.title, t.pic_user_id, t.due_date::text AS due, t.report_id, r.counterpart FROM field_tasks t JOIN field_reports r ON r.id=t.report_id
        WHERE t.status='OPEN' AND t.deleted_at IS NULL AND NOT t.is_demo AND t.due_date <= $1::date`, [t])).rows;
    for (const x of tasks) {
      const late = x.due < t;
      await count(notify([x.pic_user_id], { type: late ? "TASK_OVERDUE" : "TASK_DUE", title: late ? `Follow-up terlambat: ${x.title}` : `Follow-up jatuh tempo hari ini: ${x.title}`, body: `${x.counterpart ?? "Report"} · tenggat ${x.due}`, href: `/reports/${x.report_id}`, key: `${late ? "task-over" : "task-due"}:${x.id}` }));
    }
    const qs = (await pool.query(
      `SELECT id, number, customer_name, owner_id, created_by, rev, valid_until::text AS vu FROM quotations
        WHERE status='SENT' AND deleted_at IS NULL AND NOT is_demo AND valid_until IS NOT NULL AND valid_until <= $1::date + 3`, [t])).rows;
    for (const q of qs)
      await count(notify([q.owner_id ?? q.created_by], { type: "QUOTATION_EXPIRING", title: `Penawaran ${q.number} segera kedaluwarsa`, body: `${q.customer_name} · berlaku sampai ${q.vu}`, href: `/quotations/${q.id}`, key: `qt-exp:${q.id}:${q.rev}` }));
    const blocked = (await pool.query(`SELECT id, kind, crm_id, last_error FROM wo_outbox WHERE status='BLOCKED' AND kind <> 'NOTIFICATION' AND created_at > now() - interval '30 days'`)).rows;
    if (blocked.length) {
      const admins = await adminIds();
      for (const b of blocked)
        await count(notify(admins, { type: "WO_BLOCKED", title: `Kirim ke WO ditolak: ${b.crm_id}`, body: b.last_error, href: "/admin/settings", key: `outbox:${b.id}` }));
    }
    await pool.query(`DELETE FROM crm_notifications WHERE (read_at IS NOT NULL AND read_at < now() - interval '45 days') OR created_at < now() - interval '180 days'`);
  } catch (e) { console.error("sweep notifikasi:", (e as Error).message); }
  return n;
}

export function startNotifySweep() {
  const tick = () => void sweepNotifications();
  setTimeout(tick, 45_000).unref();
  setInterval(tick, 3_600_000).unref();
}
