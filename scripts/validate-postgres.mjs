import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL before validating PostgreSQL.");
const pool = new pg.Pool({ connectionString, ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false } });

try {
  const expected = ['app_migrations', 'company_memberships', 'organizations', 'practice_sessions', 'students', 'videos', 'critiques', 'user_critique_deletions', 'video_library_groups', 'video_library_group_items', 'user_pro_trials', 'video_dancer_selections', 'student_roster_invites'];
  const { rows } = await pool.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1)`, [expected]);
  const missing = expected.filter((name) => !rows.some((row) => row.table_name === name));
  if (missing.length) throw new Error(`Missing PostgreSQL tables: ${missing.join(', ')}`);
  const ownership = await pool.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'critiques' AND column_name = 'owner_user_id'`);
  if (!ownership.rowCount) throw new Error("Missing critique account ownership. Run db:migrate to apply 0006_account_owned_critiques.sql.");
  console.log("PostgreSQL schema validation passed.");
} finally {
  await pool.end();
}
