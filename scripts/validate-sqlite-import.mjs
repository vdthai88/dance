import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before validating the SQLite import.");

const sqlite = new DatabaseSync(join(process.cwd(), "data", "dance.sqlite"), { readOnly: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false } });
const mappings = [
  ["user", "user"], ["account", "account"], ["session", "session"], ["roles", "roles"],
  ["user_profiles", "user_profiles"], ["user_roles", "user_roles"], ["organizations", "organizations"],
  ["company_memberships", "company_memberships"], ["students", "students"], ["teacher_profiles", "teacher_profiles"],
  ["student_company_assignments", "student_company_assignments"], ["student_teacher_assignments", "student_teacher_assignments"],
  ["connection_requests", "connection_requests"], ["practice_sessions", "practice_sessions"], ["session_videos", "videos"],
  ["critiques", "critiques"], ["session_critiques", "session_critiques"], ["session_teacher_feedback", "session_teacher_feedback"],
];

try {
  const mismatches = [];
  for (const [source, destination] of mappings) {
    const sourceCount = Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM "${source}"`).get().count);
    const destinationCount = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM "${destination}"`)).rows[0].count);
    console.log(`${source} -> ${destination}: ${sourceCount} / ${destinationCount}`);
    if (sourceCount !== destinationCount) mismatches.push(`${source} (${sourceCount}) != ${destination} (${destinationCount})`);
  }
  if (mismatches.length) throw new Error(`Migration count mismatch: ${mismatches.join("; ")}`);
  console.log("SQLite-to-PostgreSQL record counts match.");
} finally {
  sqlite.close();
  await pool.end();
}
