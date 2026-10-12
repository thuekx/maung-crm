import pg from "pg";

// DATE tetap string "YYYY-MM-DD" (tanpa konversi zona waktu ke Date)
pg.types.setTypeParser(1082, (v: string) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres@localhost:5432/maung_crm",
});

export async function audit(
  actorId: string, entity: string, entityId: number | string, action: string,
  before: unknown = null, after: unknown = null, db: { query: typeof pool.query } = pool,
) {
  await db.query(
    "INSERT INTO audit_log (actor_id, entity, entity_id, action, before, after) VALUES ($1,$2,$3,$4,$5,$6)",
    [actorId, entity, entityId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
}
