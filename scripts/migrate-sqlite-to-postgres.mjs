import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DATABASE_URL before migrating SQLite data.");

const sqlite = new DatabaseSync(join(process.cwd(), "data", "dance.sqlite"), { readOnly: true });
const pool = new pg.Pool({ connectionString, ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false } });
const client = await pool.connect();

const sourceCount = (table) => Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count);
const tableCounts = ["user", "account", "session", "verification", "roles", "user_profiles", "user_roles", "organizations", "company_memberships", "students", "teacher_profiles", "student_company_assignments", "student_teacher_assignments", "company_join_requests", "connection_requests", "invitations", "practice_sessions", "session_videos", "critiques", "session_critiques", "session_teacher_feedback", "teacher_feedback"];

async function insertMany(rows, sql, map = (row) => row) {
  for (const row of rows) await client.query(sql, map(row));
}

try {
  console.log("SQLite source records:");
  for (const table of tableCounts) console.log(`  ${table}: ${sourceCount(table)}`);

  const destinationUsers = Number((await client.query('SELECT COUNT(*)::int AS count FROM "user"')).rows[0].count);
  const destinationOrganizations = Number((await client.query("SELECT COUNT(*)::int AS count FROM organizations")).rows[0].count);
  if (!apply) {
    console.log("\nDry run only. No data was changed. Run with --apply to copy these records.");
    console.log(`Destination currently has ${destinationUsers} users and ${destinationOrganizations} organizations.`);
    process.exitCode = 0;
  } else {
    if (destinationUsers || destinationOrganizations) throw new Error("PostgreSQL already contains application data. Refusing to merge a SQLite import. Use a new database or clear it deliberately first.");
    await client.query("BEGIN");
    try {
      await insertMany(sqlite.prepare('SELECT * FROM "user"').all(), `INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`, (row) => [row.id, row.name, row.email, Boolean(row.emailVerified), row.image, row.createdAt, row.updatedAt]);
      await insertMany(sqlite.prepare("SELECT * FROM account").all(), `INSERT INTO account (id, "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope, password, "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, (row) => [row.id, row.accountId, row.providerId, row.userId, row.accessToken, row.refreshToken, row.idToken, row.accessTokenExpiresAt, row.refreshTokenExpiresAt, row.scope, row.password, row.createdAt, row.updatedAt]);
      await insertMany(sqlite.prepare('SELECT * FROM "session"').all(), `INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, (row) => [row.id, row.expiresAt, row.token, row.createdAt, row.updatedAt, row.ipAddress, row.userAgent, row.userId]);
      await insertMany(sqlite.prepare("SELECT * FROM verification").all(), `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6)`, (row) => [row.id, row.identifier, row.value, row.expiresAt, row.createdAt, row.updatedAt]);
      await insertMany(sqlite.prepare("SELECT * FROM roles").all(), "INSERT INTO roles (id, name, created_at) VALUES ($1,$2,$3)", (row) => [row.id, row.name, row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM user_profiles").all(), "INSERT INTO user_profiles (user_id, first_name, last_name, organization_name, birth_year, updated_at) VALUES ($1,$2,$3,$4,$5,$6)", (row) => [row.user_id, row.first_name, row.last_name, row.organization_name, row.birth_year, row.updated_at]);
      await insertMany(sqlite.prepare("SELECT * FROM user_roles").all(), "INSERT INTO user_roles (user_id, role_id, created_at) VALUES ($1,$2,$3)", (row) => [row.user_id, row.role_id, row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM organizations").all(), "INSERT INTO organizations (id, display_name, organization_type, created_at) VALUES ($1,$2,$3,$4)", (row) => [row.id, row.display_name, row.organization_type, row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM company_memberships").all(), "INSERT INTO company_memberships (company_id, user_id, role, is_default, joined_at) VALUES ($1,$2,$3,$4,$5)", (row) => [row.company_id, row.user_id, row.role, Boolean(row.is_default), row.joined_at]);
      await insertMany(sqlite.prepare("SELECT * FROM students").all(), "INSERT INTO students (id, display_name, user_id, organization_id, created_at) VALUES ($1,$2,$3,$4,$5)", (row) => [row.id, row.display_name, row.user_id, row.organization_id, row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM teacher_profiles").all(), "INSERT INTO teacher_profiles (id, user_id, display_name, organization_id, is_company_owner, created_at) VALUES ($1,$2,$3,$4,$5,$6)", (row) => [row.id, row.user_id, row.display_name, row.organization_id, Boolean(row.is_company_owner), row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM student_company_assignments").all(), "INSERT INTO student_company_assignments (student_id, company_id, permission, assigned_at) VALUES ($1,$2,$3,$4)", (row) => [row.student_id, row.company_id, row.permission, row.assigned_at]);
      await insertMany(sqlite.prepare("SELECT * FROM student_teacher_assignments").all(), "INSERT INTO student_teacher_assignments (student_id, teacher_user_id, permission, assigned_at) VALUES ($1,$2,$3,$4)", (row) => [row.student_id, row.teacher_user_id, row.permission, row.assigned_at]);
      await insertMany(sqlite.prepare("SELECT * FROM company_join_requests").all(), "INSERT INTO company_join_requests (id, company_id, requester_user_id, status, requested_at, decided_at) VALUES ($1,$2,$3,$4,$5,$6)", (row) => [row.id, row.company_id, row.requester_user_id, row.status, row.requested_at, row.decided_at]);
      await insertMany(sqlite.prepare("SELECT * FROM connection_requests").all(), "INSERT INTO connection_requests (id, student_id, target_type, target_user_id, target_company_id, status, requested_at, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", (row) => [row.id, row.student_id, row.target_type, row.target_user_id, row.target_company_id, row.status, row.requested_at, row.decided_at]);
      await insertMany(sqlite.prepare("SELECT * FROM invitations").all(), "INSERT INTO invitations (id, token, company_id, student_id, email, invitation_role, invited_by_user_id, status, expires_at, accepted_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", (row) => [row.id, row.token, row.company_id, row.student_id, row.email, row.invitation_role, row.invited_by_user_id, row.status, row.expires_at, row.accepted_at, row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM practice_sessions").all(), "INSERT INTO practice_sessions (id, student_id, company_id, session_name, session_date, location, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", (row) => [row.id, row.student_id, row.company_id, row.session_name, row.session_date, row.location, row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM critiques").all(), "INSERT INTO critiques (cache_key, earlier_sha256, newer_sha256, earlier_filename, newer_filename, model, critique_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", (row) => [row.cache_key, row.earlier_sha256, row.newer_sha256, row.earlier_filename, row.newer_filename, row.model, JSON.parse(row.critique_json), row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM session_critiques").all(), "INSERT INTO session_critiques (session_id, cache_key, created_at) VALUES ($1,$2,$3)", (row) => [row.session_id, row.cache_key, row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM session_teacher_feedback").all(), "INSERT INTO session_teacher_feedback (id, session_id, model, feedback_json, created_at) VALUES ($1,$2,$3,$4,$5)", (row) => [row.id, row.session_id, row.model, JSON.parse(row.feedback_json), row.created_at]);
      await insertMany(sqlite.prepare("SELECT * FROM teacher_feedback").all(), "INSERT INTO teacher_feedback (id, video_sha256, video_filename, model, feedback_json, created_at) VALUES ($1,$2,$3,$4,$5)", (row) => [row.id, row.video_sha256, row.video_filename, row.model, JSON.parse(row.feedback_json), row.created_at]);

      const legacyVideos = sqlite.prepare(`SELECT sv.session_id, sv.video_sha256, sv.video_filename, s.user_id
        FROM session_videos sv JOIN practice_sessions ps ON ps.id = sv.session_id JOIN students s ON s.id = ps.student_id`).all();
      await insertMany(legacyVideos, `INSERT INTO videos (id, session_id, uploaded_by_user_id, original_filename, sha256, storage_status)
        VALUES ($1,$2,$3,$4,$5,'reupload_required')`, (row) => [randomUUID(), row.session_id, row.user_id, row.video_filename, row.video_sha256]);
      await client.query("COMMIT");
      console.log("SQLite data migration completed. Legacy video rows were imported as reupload_required metadata.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  sqlite.close();
  client.release();
  await pool.end();
}
