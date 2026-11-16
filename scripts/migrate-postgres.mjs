import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL before running PostgreSQL migrations.");
const migrationsDirectory = join(process.cwd(), "db", "migrations");
const migrationFiles = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
const pool = new pg.Pool({ connectionString, ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  await client.query("CREATE TABLE IF NOT EXISTS app_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const filename of migrationFiles) {
    if ((await client.query("SELECT 1 FROM app_migrations WHERE filename = $1", [filename])).rowCount) continue;
    const sql = await readFile(join(migrationsDirectory, filename), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO app_migrations (filename) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
