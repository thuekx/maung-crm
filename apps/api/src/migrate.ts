import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

export async function migrate() {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, at timestamptz DEFAULT now())");
  const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [f]);
    if (done.rowCount) continue;
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(readFileSync(dir + f, "utf8"));
      await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      await c.query("COMMIT");
      console.log("migrasi diterapkan:", f);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => pool.end());
}
