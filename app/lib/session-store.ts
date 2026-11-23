import { randomBytes, randomUUID } from "node:crypto";
import { openDanceDatabase } from "./critique-store";
import type { DanceCritique, TeacherFeedback } from "./gemini-critique";
import { isDanceCritique, isTeacherFeedback } from "./gemini-critique";

export type StudentProfile = { id: string; name: string; organizationId: string | null; organizationName: string | null; createdAt: string };
export type TeacherOrganization = { id: string; name: string; type: "studio" | "private_company" | "other"; address?: string | null; phoneNumber?: string | null; isDefault?: boolean };
export type LocalTeacherProfile = { isCompanyOwner: boolean; companyRole: "owner" | "admin" | "teacher" | "staff" | null };
export type CompanyMember = { userId: string; name: string; email: string | null; role: "owner" | "admin" | "teacher" | "staff"; joinedAt: string };
export type Invitation = { token: string; email: string; role: "teacher" | "student"; studentId: string | null; status: "pending" | "accepted" | "revoked"; expiresAt: string; createdAt: string };
export type ConnectionOption = { type: "teacher" | "company"; id: string; name: string; companyName: string | null };
export type ConnectionRequest = { id: string; studentName: string; targetName: string; targetType: "teacher" | "company"; requestedAt: string };
export type StudentCompany = { id: string; name: string; type: "studio" | "private_company" | "other" };
export type CompanyJoinRequest = { id: string; companyId: string; companyName: string; requesterName: string; requestedAt: string };
export type UserProfile = { firstName: string; lastName: string; organizationName: string; birthYear: number | null };
export type PracticeSession = {
  id: string;
  studentId: string;
  studentName: string;
  companyId: string | null;
  name: string;
  sessionDate: string;
  location: string;
  createdAt: string;
};
export type SessionTeacherFeedback = {
  id: string;
  sessionId: string;
  model: string;
  feedback: TeacherFeedback;
  createdAt: string;
};
export type SessionCritique = {
  key: string;
  model: string;
  critique: DanceCritique;
  createdAt: string;
};
export type SessionVideo = { hash: string; filename: string; createdAt: string };
export type SessionSnapshot = {
  session: PracticeSession;
  videos: SessionVideo[];
  teacherFeedback: SessionTeacherFeedback[];
  aiCritiques: SessionCritique[];
};

function assignRole(db: ReturnType<typeof openDanceDatabase>, userId: string, role: "student" | "teacher" | "admin") {
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(userId, role);
}

export function chooseAccountRole(userId: string, role: "student" | "teacher") {
  const db = openDanceDatabase();
  try {
    assignRole(db, userId, role);
    // A person using the Student role is their own student profile. They do not
    // need to wait for a teacher invitation before they can see their sessions.
    if (role === "student") ensureStudentProfile(db, userId);
  } finally { db.close(); }
}

export function getAccountRoles(userId: string): Array<"student" | "teacher" | "admin"> {
  const db = openDanceDatabase();
  try {
    return (db.prepare("SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY role_id").all(userId) as Array<{ role_id: "student" | "teacher" | "admin" }>).map((row) => row.role_id);
  } finally { db.close(); }
}

export function getUserProfile(userId: string): UserProfile {
  const db = openDanceDatabase();
  try {
    const row = db.prepare("SELECT first_name, last_name, organization_name, birth_year FROM user_profiles WHERE user_id = ?").get(userId) as { first_name: string; last_name: string; organization_name: string; birth_year: number | null } | undefined;
    return row ? { firstName: row.first_name, lastName: row.last_name, organizationName: row.organization_name, birthYear: row.birth_year } : { firstName: "", lastName: "", organizationName: "", birthYear: null };
  } finally { db.close(); }
}

function studentDisplayName(db: ReturnType<typeof openDanceDatabase>, userId: string) {
  const profile = db.prepare("SELECT first_name, last_name FROM user_profiles WHERE user_id = ?").get(userId) as { first_name: string; last_name: string } | undefined;
  const account = db.prepare('SELECT name FROM "user" WHERE id = ?').get(userId) as { name: string } | undefined;
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || account?.name?.trim() || "Student";
}

function uniqueStudentDisplayName(db: ReturnType<typeof openDanceDatabase>, userId: string, name: string) {
  const usedByAnotherStudent = db.prepare("SELECT 1 FROM students WHERE display_name = ? AND (user_id IS NULL OR user_id <> ?)").get(name, userId);
  return usedByAnotherStudent ? `${name} (${userId.slice(0, 6)})` : name;
}

function ensureStudentProfile(db: ReturnType<typeof openDanceDatabase>, userId: string) {
  const existing = db.prepare("SELECT id FROM students WHERE user_id = ?").get(userId) as { id: string } | undefined;
  if (existing) return existing.id;
  const name = uniqueStudentDisplayName(db, userId, studentDisplayName(db, userId));
  const id = randomUUID();
  db.prepare("INSERT INTO students (id, display_name, user_id) VALUES (?, ?, ?)").run(id, name, userId);
  return id;
}

export function saveUserProfile(userId: string, profile: UserProfile): UserProfile {
  const db = openDanceDatabase();
  try {
    db.prepare(`INSERT INTO user_profiles (user_id, first_name, last_name, organization_name, birth_year, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, organization_name = excluded.organization_name, birth_year = excluded.birth_year, updated_at = CURRENT_TIMESTAMP`)
      .run(userId, profile.firstName, profile.lastName, profile.organizationName, profile.birthYear);
    const isStudent = Boolean(db.prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = 'student'").get(userId));
    if (isStudent) {
      const studentId = ensureStudentProfile(db, userId);
      const name = uniqueStudentDisplayName(db, userId, studentDisplayName(db, userId));
      db.prepare("UPDATE students SET display_name = ? WHERE id = ?").run(name, studentId);
    }
    return profile;
  } finally { db.close(); }
}

function ensureTeacherProfile(db: ReturnType<typeof openDanceDatabase>, userId: string) {
  let profile = db.prepare("SELECT id, organization_id FROM teacher_profiles WHERE user_id = ?").get(userId) as { id: string; organization_id: string | null } | undefined;
  if (!profile) {
    const legacy = db.prepare("SELECT organization_id, is_company_owner FROM teacher_profiles WHERE id = 'local-teacher'").get() as { organization_id: string | null; is_company_owner: number } | undefined;
    const id = randomUUID();
    db.prepare("INSERT INTO teacher_profiles (id, display_name, user_id, organization_id) VALUES (?, ?, ?, ?)")
      .run(id, "Teacher", userId, legacy?.organization_id ?? null);
    profile = { id, organization_id: legacy?.organization_id ?? null };
    if (legacy?.organization_id) {
      db.prepare("INSERT OR IGNORE INTO company_memberships (company_id, user_id, role) VALUES (?, ?, ?)")
        .run(legacy.organization_id, userId, legacy.is_company_owner === 1 ? "owner" : "teacher");
    }
  }
  assignRole(db, userId, "teacher");
  return profile;
}

export function getTeacherOrganization(userId: string): TeacherOrganization | null {
  const db = openDanceDatabase();
  try {
    const profile = ensureTeacherProfile(db, userId);
    const row = db.prepare(`SELECT o.id, o.display_name, o.organization_type
      FROM teacher_profiles t LEFT JOIN organizations o ON o.id = t.organization_id
      WHERE t.id = ?`).get(profile.id) as { id: string | null; display_name: string | null; organization_type: TeacherOrganization["type"] | null };
    return row.id && row.display_name && row.organization_type
      ? { id: row.id, name: row.display_name, type: row.organization_type }
      : null;
  } finally { db.close(); }
}

export function getTeacherProfile(userId: string): LocalTeacherProfile {
  const db = openDanceDatabase();
  try {
    const profile = ensureTeacherProfile(db, userId);
    const row = db.prepare(`SELECT cm.role FROM teacher_profiles t
      LEFT JOIN company_memberships cm ON cm.company_id = t.organization_id AND cm.user_id = ?
      WHERE t.id = ?`).get(userId, profile.id) as { role: LocalTeacherProfile["companyRole"] } | undefined;
    return { isCompanyOwner: row?.role === "owner", companyRole: row?.role ?? null };
  } finally { db.close(); }
}

export function setTeacherCompanyOwner(userId: string, isCompanyOwner: boolean): LocalTeacherProfile {
  const db = openDanceDatabase();
  try {
    const profile = ensureTeacherProfile(db, userId);
    if (profile.organization_id) {
      const companyRole = isCompanyOwner ? "owner" : "teacher";
      db.prepare(`INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, ?)
        ON CONFLICT(company_id, user_id) DO UPDATE SET role = excluded.role`).run(profile.organization_id, userId, companyRole);
      db.prepare("UPDATE teacher_profiles SET is_company_owner = ? WHERE id = ?").run(isCompanyOwner ? 1 : 0, profile.id);
      return { isCompanyOwner, companyRole };
    }
    return { isCompanyOwner: false, companyRole: null };
  } finally { db.close(); }
}

export function associateTeacherWithOrganization(userId: string, input: { name: string; type: TeacherOrganization["type"] }): TeacherOrganization {
  const db = openDanceDatabase();
  try {
    db.exec("BEGIN IMMEDIATE");
    const profile = ensureTeacherProfile(db, userId);
    db.prepare(`INSERT INTO organizations (id, display_name, organization_type) VALUES (?, ?, ?)
      ON CONFLICT(display_name) DO UPDATE SET organization_type = excluded.organization_type`)
      .run(randomUUID(), input.name.trim(), input.type);
    const row = db.prepare("SELECT id, display_name, organization_type FROM organizations WHERE display_name = ?").get(input.name.trim()) as {
      id: string; display_name: string; organization_type: TeacherOrganization["type"];
    };
    db.prepare("UPDATE teacher_profiles SET organization_id = ? WHERE id = ?").run(row.id, profile.id);
    db.prepare("INSERT OR IGNORE INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'teacher')").run(row.id, userId);
    db.exec("COMMIT");
    return { id: row.id, name: row.display_name, type: row.organization_type };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Ignore rollback errors if no transaction is active. */ }
    throw error;
  } finally { db.close(); }
}

export function listCompanies(): TeacherOrganization[] {
  const db = openDanceDatabase();
  try {
    return (db.prepare("SELECT id, display_name, organization_type FROM organizations ORDER BY display_name COLLATE NOCASE").all() as Array<{ id: string; display_name: string; organization_type: TeacherOrganization["type"] }>)
      .map((company) => ({ id: company.id, name: company.display_name, type: company.organization_type }));
  } finally { db.close(); }
}

export function listOwnedCompanies(userId: string): TeacherOrganization[] {
  const db = openDanceDatabase();
  try {
    return (db.prepare(`SELECT o.id, o.display_name, o.organization_type, o.address, o.phone_number
      FROM company_memberships cm JOIN organizations o ON o.id = cm.company_id
      WHERE cm.user_id = ? AND cm.role = 'owner' ORDER BY o.display_name COLLATE NOCASE`).all(userId) as Array<{ id: string; display_name: string; organization_type: TeacherOrganization["type"]; address: string | null; phone_number: string | null }>).map((company) => ({ id: company.id, name: company.display_name, type: company.organization_type, address: company.address, phoneNumber: company.phone_number }));
  } finally { db.close(); }
}

export function updateOwnedCompany(userId: string, companyId: string, input: { name: string; type: TeacherOrganization["type"]; address: string; phoneNumber: string }): TeacherOrganization | "exists" | null {
  const db = openDanceDatabase();
  try {
    const owned = db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND role = 'owner'").get(companyId, userId);
    if (!owned) return null;
    const duplicate = db.prepare("SELECT 1 FROM organizations WHERE lower(display_name) = lower(?) AND id <> ?").get(input.name.trim(), companyId);
    if (duplicate) return "exists";
    db.prepare("UPDATE organizations SET display_name = ?, organization_type = ?, address = ?, phone_number = ? WHERE id = ?").run(input.name.trim(), input.type, input.address.trim(), input.phoneNumber.trim(), companyId);
    const row = db.prepare("SELECT id, display_name, organization_type, address, phone_number FROM organizations WHERE id = ?").get(companyId) as { id: string; display_name: string; organization_type: TeacherOrganization["type"]; address: string | null; phone_number: string | null };
    return { id: row.id, name: row.display_name, type: row.organization_type, address: row.address, phoneNumber: row.phone_number };
  } finally { db.close(); }
}

export function createCompanyForTeacher(userId: string, input: { name: string; type: TeacherOrganization["type"]; address?: string; phoneNumber?: string }): TeacherOrganization | "exists" {
  const db = openDanceDatabase();
  try {
    if (db.prepare("SELECT 1 FROM organizations WHERE display_name = ?").get(input.name.trim())) return "exists";
    db.exec("BEGIN IMMEDIATE");
    const id = randomUUID();
    db.prepare("INSERT INTO organizations (id, display_name, organization_type, address, phone_number) VALUES (?, ?, ?, ?, ?)").run(id, input.name.trim(), input.type, input.address?.trim() ?? "", input.phoneNumber?.trim() ?? "");
    const profile = ensureTeacherProfile(db, userId);
    db.prepare("UPDATE company_memberships SET is_default = 0 WHERE user_id = ?").run(userId);
    db.prepare("INSERT INTO company_memberships (company_id, user_id, role, is_default) VALUES (?, ?, 'owner', 1)").run(id, userId);
    db.prepare("UPDATE teacher_profiles SET organization_id = ? WHERE id = ?").run(id, profile.id);
    db.exec("COMMIT");
    return { id, name: input.name.trim(), type: input.type, address: input.address?.trim() ?? "", phoneNumber: input.phoneNumber?.trim() ?? "" };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* No transaction was active. */ }
    throw error;
  } finally { db.close(); }
}

export function requestCompanyJoin(userId: string, companyId: string): "created" | "already_member" | "already_requested" | "missing" {
  const db = openDanceDatabase();
  try {
    if (!db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(companyId)) return "missing";
    if (db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ?").get(companyId, userId)) return "already_member";
    if (db.prepare("SELECT 1 FROM company_join_requests WHERE company_id = ? AND requester_user_id = ? AND status = 'pending'").get(companyId, userId)) return "already_requested";
    db.prepare("INSERT INTO company_join_requests (id, company_id, requester_user_id) VALUES (?, ?, ?)").run(randomUUID(), companyId, userId);
    return "created";
  } finally { db.close(); }
}

export function listPendingCompanyJoinRequests(userId: string): CompanyJoinRequest[] {
  const db = openDanceDatabase();
  try {
    return (db.prepare(`SELECT r.id, r.company_id, o.display_name AS company_name, r.requested_at,
      COALESCE(NULLIF(TRIM(up.first_name || ' ' || up.last_name), ''), NULLIF(TRIM(u.name), ''), 'Teacher') AS requester_name
      FROM company_join_requests r
      JOIN company_memberships cm ON cm.company_id = r.company_id AND cm.user_id = ? AND cm.role IN ('owner', 'admin')
      JOIN organizations o ON o.id = r.company_id
      LEFT JOIN "user" u ON u.id = r.requester_user_id
      LEFT JOIN user_profiles up ON up.user_id = r.requester_user_id
      WHERE r.status = 'pending' ORDER BY r.requested_at DESC`).all(userId) as Array<{ id: string; company_id: string; company_name: string; requester_name: string; requested_at: string }>)
      .map((request) => ({ id: request.id, companyId: request.company_id, companyName: request.company_name, requesterName: request.requester_name, requestedAt: request.requested_at }));
  } finally { db.close(); }
}

export function decideCompanyJoinRequest(userId: string, requestId: string, accept: boolean): boolean {
  const db = openDanceDatabase();
  try {
    const request = db.prepare("SELECT company_id, requester_user_id FROM company_join_requests WHERE id = ? AND status = 'pending'").get(requestId) as { company_id: string; requester_user_id: string } | undefined;
    if (!request || !db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND role IN ('owner', 'admin')").get(request.company_id, userId)) return false;
    db.exec("BEGIN IMMEDIATE");
    if (accept) {
      db.prepare("INSERT OR IGNORE INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'teacher')").run(request.company_id, request.requester_user_id);
        const hasDefaultCompany = Boolean(db.prepare("SELECT 1 FROM company_memberships WHERE user_id = ? AND is_default = 1").get(request.requester_user_id));
        if (!hasDefaultCompany) db.prepare("UPDATE company_memberships SET is_default = 1 WHERE company_id = ? AND user_id = ?").run(request.company_id, request.requester_user_id);
      const profile = ensureTeacherProfile(db, request.requester_user_id);
      db.prepare("UPDATE teacher_profiles SET organization_id = COALESCE(organization_id, ?) WHERE id = ?").run(request.company_id, profile.id);
    }
    db.prepare("UPDATE company_join_requests SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?").run(accept ? "accepted" : "declined", requestId);
    db.exec("COMMIT"); return true;
  } catch (error) { try { db.exec("ROLLBACK"); } catch { /* No transaction was active. */ } throw error; } finally { db.close(); }
}

function mapStudentRows(rows: Array<{ id: string; display_name: string; organization_id: string | null; organization_name: string | null; created_at: string }>): StudentProfile[] {
  return rows.map((row) => ({ id: row.id, name: row.display_name, organizationId: row.organization_id, organizationName: row.organization_name, createdAt: row.created_at }));
}

export function listStudentsForUser(userId: string): StudentProfile[] {
  const db = openDanceDatabase();
  try {
    // Accounts created before this rule existed may already have the Student
    // role but no matching row in students, so repair that safely on first use.
    const hasStudentRole = Boolean(db.prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = 'student'").get(userId));
    if (hasStudentRole) ensureStudentProfile(db, userId);
    return mapStudentRows(db.prepare(`SELECT s.id, s.display_name, s.organization_id, o.display_name AS organization_name, s.created_at
      FROM students s LEFT JOIN organizations o ON o.id = s.organization_id WHERE s.user_id = ?
      ORDER BY s.display_name COLLATE NOCASE`).all(userId) as Array<{
      id: string; display_name: string; organization_id: string | null; organization_name: string | null; created_at: string;
    }>);
  } finally { db.close(); }
}

export function listStudentsForTeacher(userId: string, companyId?: string | null): StudentProfile[] {
  const db = openDanceDatabase();
  try {
    if (companyId) {
      return mapStudentRows(db.prepare(`SELECT DISTINCT s.id, s.display_name, s.organization_id, o.display_name AS organization_name, s.created_at
        FROM students s JOIN student_company_assignments sca ON sca.student_id = s.id
        LEFT JOIN organizations o ON o.id = s.organization_id
        JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = ?
        WHERE sca.company_id = ? AND cm.role IN ('owner', 'admin', 'teacher')
        ORDER BY s.display_name COLLATE NOCASE`).all(userId, companyId) as Array<{ id: string; display_name: string; organization_id: string | null; organization_name: string | null; created_at: string }>);
    }
    return mapStudentRows(db.prepare(`SELECT DISTINCT s.id, s.display_name, s.organization_id, o.display_name AS organization_name, s.created_at
      FROM students s
      LEFT JOIN organizations o ON o.id = s.organization_id
      LEFT JOIN student_teacher_assignments sta ON sta.student_id = s.id AND sta.teacher_user_id = ?
      LEFT JOIN student_company_assignments sca ON sca.student_id = s.id
      LEFT JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = ?
      WHERE sta.teacher_user_id IS NOT NULL OR cm.role IN ('owner', 'admin', 'teacher')
      ORDER BY s.display_name COLLATE NOCASE`).all(userId, userId) as Array<{
        id: string; display_name: string; organization_id: string | null; organization_name: string | null; created_at: string;
      }>);
  } finally { db.close(); }
}

export function listUserCompanies(userId: string): StudentCompany[] {
  const db = openDanceDatabase();
  try {
    return db.prepare(`SELECT DISTINCT id, name, type FROM (
      SELECT o.id, o.display_name AS name, o.organization_type AS type
      FROM students s
      JOIN student_company_assignments sca ON sca.student_id = s.id
      JOIN organizations o ON o.id = sca.company_id
      WHERE s.user_id = ?
      UNION
      SELECT o.id, o.display_name AS name, o.organization_type AS type
      FROM company_memberships cm
      JOIN organizations o ON o.id = cm.company_id
      WHERE cm.user_id = ?
    ) ORDER BY name COLLATE NOCASE`).all(userId, userId) as StudentCompany[];
  } finally { db.close(); }
}

export function listStudentCompanies(userId: string): StudentCompany[] {
  const db = openDanceDatabase();
  try {
    return db.prepare(`SELECT DISTINCT o.id, o.display_name AS name, o.organization_type AS type
      FROM students s
      JOIN student_company_assignments sca ON sca.student_id = s.id
      JOIN organizations o ON o.id = sca.company_id
      WHERE s.user_id = ?
      ORDER BY o.display_name COLLATE NOCASE`).all(userId) as StudentCompany[];
  } finally { db.close(); }
}

export function listTeacherCompanies(userId: string): TeacherOrganization[] {
  const db = openDanceDatabase();
  try {
    return (db.prepare(`SELECT o.id, o.display_name, o.organization_type, cm.is_default
      FROM company_memberships cm JOIN organizations o ON o.id = cm.company_id
      WHERE cm.user_id = ? AND cm.role IN ('owner', 'admin', 'teacher') ORDER BY o.display_name COLLATE NOCASE`).all(userId) as Array<{ id: string; display_name: string; organization_type: TeacherOrganization["type"]; is_default: number }>).map((company) => ({ id: company.id, name: company.display_name, type: company.organization_type, isDefault: company.is_default === 1 }));
  } finally { db.close(); }
}

export function setDefaultTeacherCompany(userId: string, companyId: string): boolean {
  const db = openDanceDatabase();
  try {
    if (!db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND role IN ('owner', 'admin', 'teacher')").get(companyId, userId)) return false;
    db.exec("BEGIN IMMEDIATE");
    db.prepare("UPDATE company_memberships SET is_default = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE company_memberships SET is_default = 1 WHERE company_id = ? AND user_id = ?").run(companyId, userId);
    db.exec("COMMIT"); return true;
  } catch (error) { try { db.exec("ROLLBACK"); } catch { /* No transaction was active. */ } throw error; } finally { db.close(); }
}

export function canAccessStudent(userId: string, studentId: string, asTeacher: boolean, companyId?: string | null): boolean {
  const db = openDanceDatabase();
  try {
    if (!asTeacher) {
      if (!companyId) return Boolean(db.prepare("SELECT 1 FROM students WHERE id = ? AND user_id = ?").get(studentId, userId));
      return Boolean(db.prepare(`SELECT 1 FROM students s
        JOIN student_company_assignments sca ON sca.student_id = s.id
        WHERE s.id = ? AND s.user_id = ? AND sca.company_id = ?`).get(studentId, userId, companyId));
    }
    if (companyId) return Boolean(db.prepare(`SELECT 1 FROM student_company_assignments sca
      JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = ?
      WHERE sca.student_id = ? AND sca.company_id = ? AND cm.role IN ('owner', 'admin', 'teacher')`).get(userId, studentId, companyId));
    return Boolean(db.prepare(`SELECT 1 FROM students s
      LEFT JOIN student_teacher_assignments sta ON sta.student_id = s.id AND sta.teacher_user_id = ?
      LEFT JOIN student_company_assignments sca ON sca.student_id = s.id
      LEFT JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = ?
      WHERE s.id = ? AND (sta.teacher_user_id IS NOT NULL OR cm.role IN ('owner', 'admin', 'teacher'))`).get(userId, userId, studentId));
  } finally { db.close(); }
}

export function listCompanyMembers(userId: string): CompanyMember[] {
  const db = openDanceDatabase();
  try {
    const membership = db.prepare(`SELECT company_id FROM company_memberships
      WHERE user_id = ? AND role IN ('owner', 'admin') LIMIT 1`).get(userId) as { company_id: string } | undefined;
    if (!membership) return [];
    return (db.prepare(`SELECT cm.user_id, COALESCE(u.name, tp.display_name, 'Team member') AS display_name,
      u.email, cm.role, cm.joined_at
      FROM company_memberships cm
      LEFT JOIN "user" u ON u.id = cm.user_id
      LEFT JOIN teacher_profiles tp ON tp.user_id = cm.user_id
      WHERE cm.company_id = ? ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END, display_name COLLATE NOCASE`)
      .all(membership.company_id) as Array<{ user_id: string; display_name: string; email: string | null; role: CompanyMember["role"]; joined_at: string }>).map((row) => ({
        userId: row.user_id, name: row.display_name, email: row.email, role: row.role, joinedAt: row.joined_at,
      }));
  } finally { db.close(); }
}

function managedCompanyId(db: ReturnType<typeof openDanceDatabase>, userId: string) {
  return db.prepare("SELECT company_id FROM company_memberships WHERE user_id = ? AND role IN ('owner', 'admin') LIMIT 1").get(userId) as { company_id: string } | undefined;
}

export function createInvitation(input: { userId: string; email: string; role: "teacher" | "student"; studentId?: string | null }): Invitation | null {
  const db = openDanceDatabase();
  try {
    const membership = managedCompanyId(db, input.userId);
    if (!membership) return null;
    if (input.role === "student" && (!input.studentId || !db.prepare("SELECT 1 FROM student_company_assignments WHERE student_id = ? AND company_id = ?").get(input.studentId, membership.company_id))) return null;
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO invitations (id, token, company_id, student_id, email, invitation_role, invited_by_user_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), token, membership.company_id, input.studentId ?? null, input.email.toLowerCase(), input.role, input.userId, expiresAt);
    return { token, email: input.email.toLowerCase(), role: input.role, studentId: input.studentId ?? null, status: "pending", expiresAt, createdAt: new Date().toISOString() };
  } finally { db.close(); }
}

export function acceptInvitation(user: { id: string; email: string; name: string }, token: string): { role: "teacher" | "student" } | "invalid" | "email_mismatch" {
  const db = openDanceDatabase();
  try {
    const invite = db.prepare(`SELECT * FROM invitations WHERE token = ? AND status = 'pending' AND expires_at > CURRENT_TIMESTAMP`).get(token) as { company_id: string; student_id: string | null; email: string; invitation_role: "teacher" | "student" } | undefined;
    if (!invite) return "invalid";
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) return "email_mismatch";
    db.exec("BEGIN IMMEDIATE");
    if (invite.invitation_role === "teacher") {
      db.prepare("INSERT INTO company_memberships (company_id, user_id, role) VALUES (?, ?, 'teacher') ON CONFLICT(company_id, user_id) DO NOTHING").run(invite.company_id, user.id);
      db.prepare("INSERT OR IGNORE INTO teacher_profiles (id, display_name, user_id, organization_id) VALUES (?, ?, ?, ?)").run(randomUUID(), user.name, user.id, invite.company_id);
      assignRole(db, user.id, "teacher");
    } else if (invite.student_id) {
      const updated = db.prepare("UPDATE students SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = ?)").run(user.id, invite.student_id, user.id);
      if (updated.changes === 0) { db.exec("ROLLBACK"); return "invalid"; }
      assignRole(db, user.id, "student");
    }
    db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP WHERE token = ?").run(token);
    db.exec("COMMIT");
    return { role: invite.invitation_role };
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; } finally { db.close(); }
}

export function canAccessSession(userId: string, sessionId: string, asTeacher: boolean): boolean {
  const db = openDanceDatabase();
  try {
    const row = db.prepare("SELECT student_id FROM practice_sessions WHERE id = ?").get(sessionId) as { student_id: string } | undefined;
    if (!row) return false;
    if (!asTeacher) return Boolean(db.prepare("SELECT 1 FROM students WHERE id = ? AND user_id = ?").get(row.student_id, userId));
    return Boolean(db.prepare(`SELECT 1 FROM students s
      LEFT JOIN student_teacher_assignments sta ON sta.student_id = s.id AND sta.teacher_user_id = ?
      LEFT JOIN student_company_assignments sca ON sca.student_id = s.id
      LEFT JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = ?
      WHERE s.id = ? AND (sta.teacher_user_id IS NOT NULL OR cm.role IN ('owner', 'admin', 'teacher'))`).get(userId, userId, row.student_id));
  } finally { db.close(); }
}

export function createStudent(input: { name: string; teacherUserId: string; organizationId?: string | null; studentUserId?: string | null }): StudentProfile {
  const id = randomUUID();
  const db = openDanceDatabase();
  try {
    const name = input.name.trim();
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO students (id, display_name, user_id, organization_id) VALUES (?, ?, ?, ?)").run(id, name, input.studentUserId ?? null, input.organizationId ?? null);
    db.prepare("INSERT OR IGNORE INTO student_teacher_assignments (student_id, teacher_user_id, permission) VALUES (?, ?, 'manage')").run(id, input.teacherUserId);
    if (input.organizationId) db.prepare("INSERT OR IGNORE INTO student_company_assignments (student_id, company_id, permission) VALUES (?, ?, 'manage')").run(id, input.organizationId);
    if (input.studentUserId) assignRole(db, input.studentUserId, "student");
    const row = db.prepare(`SELECT s.created_at, s.organization_id, o.display_name AS organization_name
      FROM students s LEFT JOIN organizations o ON o.id = s.organization_id WHERE s.id = ?`).get(id) as {
        created_at: string; organization_id: string | null; organization_name: string | null;
      };
    db.exec("COMMIT");
    return { id, name, organizationId: row.organization_id, organizationName: row.organization_name, createdAt: row.created_at };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* No transaction was active. */ }
    throw error;
  } finally { db.close(); }
}

export function listConnectionOptions(): ConnectionOption[] {
  const db = openDanceDatabase();
  try {
    const teachers = db.prepare(`SELECT DISTINCT tp.user_id AS id,
      COALESCE(NULLIF(TRIM(up.first_name || ' ' || up.last_name), ''), NULLIF(TRIM(u.name), ''), NULLIF(TRIM(tp.display_name), ''), 'Teacher') AS name,
      o.display_name AS company_name
      FROM teacher_profiles tp LEFT JOIN "user" u ON u.id = tp.user_id
      LEFT JOIN user_profiles up ON up.user_id = tp.user_id
      LEFT JOIN company_memberships cm ON cm.user_id = tp.user_id AND cm.role IN ('owner', 'admin', 'teacher')
      LEFT JOIN organizations o ON o.id = cm.company_id
      WHERE tp.user_id IS NOT NULL ORDER BY company_name COLLATE NOCASE, name COLLATE NOCASE`).all() as Array<{ id: string; name: string; company_name: string | null }>;
    const companies = db.prepare("SELECT id, display_name AS name FROM organizations ORDER BY display_name COLLATE NOCASE").all() as Array<{ id: string; name: string }>;
    return [...teachers.map((teacher) => ({ type: "teacher" as const, id: teacher.id, name: teacher.name, companyName: teacher.company_name })), ...companies.map((company) => ({ type: "company" as const, id: company.id, name: company.name, companyName: company.name }))];
  } finally { db.close(); }
}

export function listStudentPendingConnectionRequests(userId: string): ConnectionRequest[] {
  const db = openDanceDatabase();
  try {
    return (db.prepare(`SELECT cr.id, s.display_name AS student_name, cr.target_type, cr.requested_at,
      COALESCE(NULLIF(TRIM(up.first_name || ' ' || up.last_name), ''), NULLIF(TRIM(tu.name), ''), NULLIF(TRIM(tp.display_name), ''), o.display_name, 'Unknown recipient') AS target_name
      FROM connection_requests cr JOIN students s ON s.id = cr.student_id
      LEFT JOIN teacher_profiles tp ON tp.user_id = cr.target_user_id LEFT JOIN "user" tu ON tu.id = cr.target_user_id
      LEFT JOIN user_profiles up ON up.user_id = cr.target_user_id
      LEFT JOIN organizations o ON o.id = cr.target_company_id
      WHERE s.user_id = ? AND cr.status = 'pending' ORDER BY cr.requested_at DESC`).all(userId) as Array<{ id: string; student_name: string; target_type: "teacher" | "company"; requested_at: string; target_name: string }>).map((row) => ({ id: row.id, studentName: row.student_name, targetType: row.target_type, targetName: row.target_name, requestedAt: row.requested_at }));
  } finally { db.close(); }
}

export function requestConnection(userId: string, input: { type: "teacher" | "company"; targetId: string }): boolean {
  const db = openDanceDatabase();
  try {
    const student = db.prepare("SELECT id FROM students WHERE user_id = ?").get(userId) as { id: string } | undefined;
    if (!student) return false;
    if (input.type === "teacher" && !db.prepare("SELECT 1 FROM teacher_profiles WHERE user_id = ?").get(input.targetId)) return false;
    if (input.type === "company" && !db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(input.targetId)) return false;
    db.prepare(`INSERT INTO connection_requests (id, student_id, target_type, target_user_id, target_company_id) VALUES (?, ?, ?, ?, ?)`)
      .run(randomUUID(), student.id, input.type, input.type === "teacher" ? input.targetId : null, input.type === "company" ? input.targetId : null);
    return true;
  } finally { db.close(); }
}

export function listPendingConnectionRequests(userId: string): ConnectionRequest[] {
  const db = openDanceDatabase();
  try {
    return (db.prepare(`SELECT cr.id, s.display_name AS student_name, cr.target_type, cr.requested_at,
      COALESCE(NULLIF(TRIM(up.first_name || ' ' || up.last_name), ''), NULLIF(TRIM(tu.name), ''), NULLIF(TRIM(tp.display_name), ''), o.display_name, 'Unknown recipient') AS target_name
      FROM connection_requests cr JOIN students s ON s.id = cr.student_id
      LEFT JOIN teacher_profiles tp ON tp.user_id = cr.target_user_id LEFT JOIN "user" tu ON tu.id = cr.target_user_id
      LEFT JOIN user_profiles up ON up.user_id = cr.target_user_id
      LEFT JOIN organizations o ON o.id = cr.target_company_id
      LEFT JOIN company_memberships cm ON cm.company_id = cr.target_company_id AND cm.user_id = ?
      WHERE cr.status = 'pending' AND (cr.target_user_id = ? OR cm.role IN ('owner', 'admin')) ORDER BY cr.requested_at DESC`).all(userId, userId) as Array<{ id: string; student_name: string; target_type: "teacher" | "company"; requested_at: string; target_name: string }>).map((row) => ({ id: row.id, studentName: row.student_name, targetType: row.target_type, targetName: row.target_name, requestedAt: row.requested_at }));
  } finally { db.close(); }
}

export function decideConnectionRequest(userId: string, requestId: string, accept: boolean): boolean {
  const db = openDanceDatabase();
  try {
    const request = db.prepare("SELECT * FROM connection_requests WHERE id = ? AND status = 'pending'").get(requestId) as { student_id: string; target_type: "teacher" | "company"; target_user_id: string | null; target_company_id: string | null } | undefined;
    if (!request) return false;
    const allowed = request.target_type === "teacher" ? request.target_user_id === userId : Boolean(request.target_company_id && db.prepare("SELECT 1 FROM company_memberships WHERE company_id = ? AND user_id = ? AND role IN ('owner', 'admin')").get(request.target_company_id, userId));
    if (!allowed) return false;
    db.exec("BEGIN IMMEDIATE");
    if (accept) {
      if (request.target_type === "teacher") {
        db.prepare("INSERT OR IGNORE INTO student_teacher_assignments (student_id, teacher_user_id, permission) VALUES (?, ?, 'manage')").run(request.student_id, request.target_user_id);
        const teacherCompany = db.prepare("SELECT organization_id FROM teacher_profiles WHERE user_id = ?").get(request.target_user_id) as { organization_id: string | null } | undefined;
        if (teacherCompany?.organization_id) {
          db.prepare("INSERT OR IGNORE INTO student_company_assignments (student_id, company_id, permission) VALUES (?, ?, 'manage')").run(request.student_id, teacherCompany.organization_id);
          db.prepare("UPDATE students SET organization_id = COALESCE(organization_id, ?) WHERE id = ?").run(teacherCompany.organization_id, request.student_id);
        }
      } else {
        db.prepare("INSERT OR IGNORE INTO student_company_assignments (student_id, company_id, permission) VALUES (?, ?, 'manage')").run(request.student_id, request.target_company_id);
        db.prepare("UPDATE students SET organization_id = COALESCE(organization_id, ?) WHERE id = ?").run(request.target_company_id, request.student_id);
      }
    }
    db.prepare("UPDATE connection_requests SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?").run(accept ? "accepted" : "declined", requestId);
    db.exec("COMMIT"); return true;
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; } finally { db.close(); }
}

export function cancelConnectionRequest(userId: string, requestId: string): boolean {
  const db = openDanceDatabase();
  try {
    return db.prepare(`DELETE FROM connection_requests
      WHERE id = ? AND status = 'pending' AND student_id IN (SELECT id FROM students WHERE user_id = ?)`)
      .run(requestId, userId).changes > 0;
  } finally { db.close(); }
}

export function listSessions(studentId: string, companyId?: string | null): PracticeSession[] {
  const db = openDanceDatabase();
  try {
    const rows = companyId
      ? db.prepare(`SELECT s.id, s.student_id, s.company_id, p.display_name AS student_name, s.session_name, s.session_date, s.location, s.created_at
          FROM practice_sessions s JOIN students p ON p.id = s.student_id WHERE s.student_id = ? AND s.company_id = ? ORDER BY s.session_date DESC, s.created_at DESC`).all(studentId, companyId)
      : db.prepare(`SELECT s.id, s.student_id, s.company_id, p.display_name AS student_name, s.session_name, s.session_date, s.location, s.created_at
      FROM practice_sessions s JOIN students p ON p.id = s.student_id
      WHERE s.student_id = ? ORDER BY s.session_date DESC, s.created_at DESC`).all(studentId);
    return (rows as Array<{ id: string; student_id: string; company_id: string | null; student_name: string; session_name: string; session_date: string; location: string; created_at: string }>).map((row) => ({
        id: row.id, studentId: row.student_id, studentName: row.student_name,
        companyId: row.company_id, name: row.session_name || `${row.session_date} - ${row.student_name}`, sessionDate: row.session_date, location: row.location, createdAt: row.created_at,
      }));
  } finally { db.close(); }
}

export function createPracticeSession(input: { studentId: string; companyId: string; sessionDate: string; location: string }): PracticeSession | null {
  const id = randomUUID();
  const db = openDanceDatabase();
  try {
    const student = db.prepare(`SELECT s.display_name, o.display_name AS organization_name
      FROM students s LEFT JOIN organizations o ON o.id = ? WHERE s.id = ?`).get(input.companyId, input.studentId) as { display_name: string; organization_name: string | null } | undefined;
    if (!student) return null;
    const name = [input.sessionDate, student.display_name, student.organization_name].filter(Boolean).join(" - ");
    db.prepare("INSERT INTO practice_sessions (id, student_id, company_id, session_name, session_date, location) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.studentId, input.companyId, name, input.sessionDate, input.location.trim());
    const row = db.prepare("SELECT created_at FROM practice_sessions WHERE id = ?").get(id) as { created_at: string };
    return { id, studentId: input.studentId, studentName: student.display_name, companyId: input.companyId, name, sessionDate: input.sessionDate, location: input.location.trim(), createdAt: row.created_at };
  } finally { db.close(); }
}

export function getSessionSnapshot(sessionId: string): SessionSnapshot | null {
  const db = openDanceDatabase();
  try {
    const row = db.prepare(`SELECT s.id, s.student_id, s.company_id, p.display_name AS student_name, s.session_name, s.session_date, s.location, s.created_at
      FROM practice_sessions s JOIN students p ON p.id = s.student_id WHERE s.id = ?`).get(sessionId) as {
        id: string; student_id: string; company_id: string | null; student_name: string; session_name: string; session_date: string; location: string; created_at: string;
      } | undefined;
    if (!row) return null;
    const videos = (db.prepare(`SELECT video_sha256, video_filename, created_at FROM session_videos
      WHERE session_id = ? ORDER BY created_at`).all(sessionId) as Array<{ video_sha256: string; video_filename: string; created_at: string }>).map((video) => ({
        hash: video.video_sha256, filename: video.video_filename, createdAt: video.created_at,
      }));
    const feedbackRows = db.prepare(`SELECT id, session_id, model, feedback_json, created_at FROM session_teacher_feedback
      WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId) as Array<{
        id: string; session_id: string; model: string; feedback_json: string; created_at: string;
      }>;
    const teacherFeedback: SessionTeacherFeedback[] = [];
    for (const item of feedbackRows) {
      try {
        const feedback: unknown = JSON.parse(item.feedback_json);
        if (isTeacherFeedback(feedback)) teacherFeedback.push({ id: item.id, sessionId: item.session_id, model: item.model, feedback, createdAt: item.created_at });
        else db.prepare("DELETE FROM session_teacher_feedback WHERE id = ?").run(item.id);
      } catch { db.prepare("DELETE FROM session_teacher_feedback WHERE id = ?").run(item.id); }
    }
    const critiqueRows = db.prepare(`SELECT c.cache_key, c.model, c.critique_json, sc.created_at
      FROM session_critiques sc JOIN critiques c ON c.cache_key = sc.cache_key
      WHERE sc.session_id = ? ORDER BY sc.created_at DESC`).all(sessionId) as Array<{
        cache_key: string; model: string; critique_json: string; created_at: string;
      }>;
    const aiCritiques: SessionCritique[] = [];
    for (const item of critiqueRows) {
      try {
        const critique: unknown = JSON.parse(item.critique_json);
        if (isDanceCritique(critique)) aiCritiques.push({ key: item.cache_key, model: item.model, critique, createdAt: item.created_at });
        else db.prepare("DELETE FROM session_critiques WHERE session_id = ? AND cache_key = ?").run(sessionId, item.cache_key);
      } catch { db.prepare("DELETE FROM session_critiques WHERE session_id = ? AND cache_key = ?").run(sessionId, item.cache_key); }
    }
    return {
      session: { id: row.id, studentId: row.student_id, studentName: row.student_name, companyId: row.company_id, name: row.session_name || `${row.session_date} - ${row.student_name}`, sessionDate: row.session_date, location: row.location, createdAt: row.created_at },
      videos, teacherFeedback, aiCritiques,
    };
  } finally { db.close(); }
}

export function attachSessionVideo(sessionId: string, videoHash: string, filename: string): boolean {
  const db = openDanceDatabase();
  try {
    db.prepare(`INSERT INTO session_videos (session_id, video_sha256, video_filename) VALUES (?, ?, ?)
      ON CONFLICT(session_id, video_sha256) DO UPDATE SET video_filename = excluded.video_filename`)
      .run(sessionId, videoHash, filename);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("FOREIGN KEY")) return false;
    throw error;
  } finally { db.close(); }
}

export function attachSessionCritique(sessionId: string, critiqueKey: string): boolean {
  const db = openDanceDatabase();
  try {
    db.prepare("INSERT OR IGNORE INTO session_critiques (session_id, cache_key) VALUES (?, ?)").run(sessionId, critiqueKey);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("FOREIGN KEY")) return false;
    throw error;
  } finally { db.close(); }
}

export function saveSessionTeacherFeedback(input: { sessionId: string; model: string; feedback: TeacherFeedback }): SessionTeacherFeedback {
  const id = randomUUID();
  const db = openDanceDatabase();
  try {
    db.prepare("INSERT INTO session_teacher_feedback (id, session_id, model, feedback_json) VALUES (?, ?, ?, ?)")
      .run(id, input.sessionId, input.model, JSON.stringify(input.feedback));
    const row = db.prepare("SELECT created_at FROM session_teacher_feedback WHERE id = ?").get(id) as { created_at: string };
    return { id, sessionId: input.sessionId, model: input.model, feedback: input.feedback, createdAt: row.created_at };
  } finally { db.close(); }
}

export function findSessionTeacherFeedback(id: string): SessionTeacherFeedback | null {
  const db = openDanceDatabase();
  try {
    const row = db.prepare("SELECT id, session_id, model, feedback_json, created_at FROM session_teacher_feedback WHERE id = ?").get(id) as { id: string; session_id: string; model: string; feedback_json: string; created_at: string } | undefined;
    if (!row) return null;
    const feedback: unknown = JSON.parse(row.feedback_json);
    return isTeacherFeedback(feedback) ? { id: row.id, sessionId: row.session_id, model: row.model, feedback, createdAt: row.created_at } : null;
  } finally { db.close(); }
}

export function updateSessionTeacherFeedback(id: string, feedback: TeacherFeedback): SessionTeacherFeedback | null {
  const db = openDanceDatabase();
  try {
    const existing = db.prepare("SELECT session_id, model, created_at FROM session_teacher_feedback WHERE id = ?").get(id) as { session_id: string; model: string; created_at: string } | undefined;
    if (!existing) return null;
    db.prepare("UPDATE session_teacher_feedback SET feedback_json = ? WHERE id = ?").run(JSON.stringify(feedback), id);
    return { id, sessionId: existing.session_id, model: existing.model, feedback, createdAt: existing.created_at };
  } finally { db.close(); }
}

export function deleteSessionTeacherFeedback(id: string): boolean {
  const db = openDanceDatabase();
  try { return db.prepare("DELETE FROM session_teacher_feedback WHERE id = ?").run(id).changes > 0; }
  finally { db.close(); }
}
