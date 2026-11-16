import { randomUUID } from "node:crypto";
import { getPostgresPool } from "../../db/postgres";
import type { LocalTeacherProfile, StudentCompany, TeacherOrganization, UserProfile } from "./session-store";

type AccountRole = "student" | "teacher" | "admin";

async function studentDisplayName(userId: string) {
  const pool = getPostgresPool();
  const { rows } = await pool.query(`SELECT up.first_name, up.last_name, u.name
    FROM "user" u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`, [userId]);
  const row = rows[0] as { first_name: string | null; last_name: string | null; name: string } | undefined;
  return [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim() || row?.name?.trim() || "Student";
}

export async function ensurePgStudentProfile(userId: string) {
  const pool = getPostgresPool();
  const existing = await pool.query("SELECT id FROM students WHERE user_id = $1", [userId]);
  if (existing.rowCount) return existing.rows[0].id as string;
  const baseName = await studentDisplayName(userId);
  const conflict = await pool.query("SELECT 1 FROM students WHERE lower(display_name) = lower($1) AND user_id IS DISTINCT FROM $2", [baseName, userId]);
  const name = conflict.rowCount ? `${baseName} (${userId.slice(0, 6)})` : baseName;
  const id = randomUUID();
  await pool.query("INSERT INTO students (id, display_name, user_id) VALUES ($1, $2, $3)", [id, name, userId]);
  return id;
}

export async function getPgAccountRoles(userId: string): Promise<AccountRole[]> {
  const { rows } = await getPostgresPool().query("SELECT role_id FROM user_roles WHERE user_id = $1 ORDER BY role_id", [userId]);
  return rows.map((row) => row.role_id as AccountRole);
}

export async function choosePgAccountRole(userId: string, role: "student" | "teacher") {
  const pool = getPostgresPool();
  await pool.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, role]);
  if (role === "student") await ensurePgStudentProfile(userId);
}

export async function getPgUserProfile(userId: string): Promise<UserProfile> {
  const { rows } = await getPostgresPool().query("SELECT first_name, last_name, organization_name, birth_year FROM user_profiles WHERE user_id = $1", [userId]);
  const row = rows[0] as { first_name: string; last_name: string; organization_name: string; birth_year: number | null } | undefined;
  return row ? { firstName: row.first_name, lastName: row.last_name, organizationName: row.organization_name, birthYear: row.birth_year } : { firstName: "", lastName: "", organizationName: "", birthYear: null };
}

/** Google stores a display name in Better Auth's user record. Split it only as
 * a profile-form suggestion; the person must still review and save it. */
export async function getPgGoogleNameSuggestion(userId: string, displayName: string): Promise<Pick<UserProfile, "firstName" | "lastName"> | null> {
  const linked = await getPostgresPool().query(`SELECT 1 FROM account WHERE "userId" = $1 AND "providerId" = 'google' LIMIT 1`, [userId]);
  if (!linked.rowCount) return null;
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function savePgUserProfile(userId: string, profile: UserProfile): Promise<UserProfile> {
  const pool = getPostgresPool();
  await pool.query(`INSERT INTO user_profiles (user_id, first_name, last_name, organization_name, birth_year, updated_at)
    VALUES ($1,$2,$3,$4,$5,now())
    ON CONFLICT (user_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
      organization_name = excluded.organization_name, birth_year = excluded.birth_year, updated_at = now()`,
    [userId, profile.firstName, profile.lastName, profile.organizationName, profile.birthYear]);
  if ((await getPgAccountRoles(userId)).includes("student")) {
    const studentId = await ensurePgStudentProfile(userId);
    const baseName = await studentDisplayName(userId);
    const conflict = await pool.query("SELECT 1 FROM students WHERE lower(display_name) = lower($1) AND id <> $2", [baseName, studentId]);
    await pool.query("UPDATE students SET display_name = $1 WHERE id = $2", [conflict.rowCount ? `${baseName} (${userId.slice(0, 6)})` : baseName, studentId]);
  }
  return profile;
}

export async function listPgUserCompanies(userId: string): Promise<StudentCompany[]> {
  const { rows } = await getPostgresPool().query(`SELECT DISTINCT id, name, type FROM (
    SELECT o.id, o.display_name AS name, o.organization_type AS type
      FROM students s JOIN student_company_assignments sca ON sca.student_id = s.id
      JOIN organizations o ON o.id = sca.company_id WHERE s.user_id = $1
    UNION
    SELECT o.id, o.display_name AS name, o.organization_type AS type
      FROM company_memberships cm JOIN organizations o ON o.id = cm.company_id WHERE cm.user_id = $1
  ) companies ORDER BY name`, [userId]);
  return rows as StudentCompany[];
}

export async function listPgStudentCompanies(userId: string): Promise<StudentCompany[]> {
  const { rows } = await getPostgresPool().query(`SELECT DISTINCT o.id, o.display_name AS name, o.organization_type AS type
    FROM students s JOIN student_company_assignments sca ON sca.student_id = s.id
    JOIN organizations o ON o.id = sca.company_id WHERE s.user_id = $1 ORDER BY o.display_name`, [userId]);
  return rows as StudentCompany[];
}

export async function listPgTeacherCompanies(userId: string): Promise<TeacherOrganization[]> {
  const { rows } = await getPostgresPool().query(`SELECT o.id, o.display_name, o.organization_type, cm.is_default
    FROM company_memberships cm JOIN organizations o ON o.id = cm.company_id
    WHERE cm.user_id = $1 AND cm.role IN ('owner', 'admin', 'teacher') ORDER BY o.display_name`, [userId]);
  return rows.map((row) => ({ id: row.id as string, name: row.display_name as string,
    type: row.organization_type as TeacherOrganization["type"], isDefault: row.is_default as boolean }));
}

export async function setPgDefaultTeacherCompany(userId: string, companyId: string): Promise<boolean> {
  const client = await getPostgresPool().connect();
  try {
    const membership = await client.query(`SELECT 1 FROM company_memberships
      WHERE company_id = $1 AND user_id = $2 AND role IN ('owner', 'admin', 'teacher')`, [companyId, userId]);
    if (!membership.rowCount) return false;
    await client.query("BEGIN");
    await client.query("UPDATE company_memberships SET is_default = false WHERE user_id = $1", [userId]);
    await client.query("UPDATE company_memberships SET is_default = true WHERE company_id = $1 AND user_id = $2", [companyId, userId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function getPgTeacherOrganization(userId: string): Promise<TeacherOrganization | null> {
  const companies = await listPgTeacherCompanies(userId);
  return companies.find((company) => company.isDefault) ?? companies[0] ?? null;
}

export async function getPgTeacherProfile(userId: string): Promise<LocalTeacherProfile> {
  const company = await getPgTeacherOrganization(userId);
  if (!company) return { isCompanyOwner: false, companyRole: null };
  const { rows } = await getPostgresPool().query("SELECT role FROM company_memberships WHERE company_id = $1 AND user_id = $2", [company.id, userId]);
  const role = rows[0]?.role as LocalTeacherProfile["companyRole"] | undefined;
  return { isCompanyOwner: role === "owner", companyRole: role ?? null };
}
