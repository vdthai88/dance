import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL before validating PostgreSQL.");
const pool = new pg.Pool({ connectionString, ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false } });

try {
  const { rows } = await pool.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN
    ('organizations', 'company_memberships', 'students', 'practice_sessions', 'videos', 'app_migrations')`);
  const expected = ['app_migrations', 'company_memberships', 'organizations', 'practice_sessions', 'students', 'videos'];
  const missing = expected.filter((name) => !rows.some((row) => row.table_name === name));
  if (missing.length) throw new Error(`Missing PostgreSQL tables: ${missing.join(', ')}`);
  console.log("PostgreSQL schema validation passed.");
} finally {
  await pool.end();
}
