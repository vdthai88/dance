import { randomBytes, randomUUID } from "node:crypto";
import { openDanceDatabase } from "./critique-store";
import type { DanceCritique, TeacherFeedback } from "./gemini-critique";
import { isDanceCritique, isTeacherFeedback } from "./gemini-critique";

export type StudentProfile = { id: string; name: string; organizationId: string | null; organizationName: string | null; createdAt: string };
export type TeacherOrganization = { id: string; name: string; type: "studio" | "private_company" | "other" };
export type LocalTeacherProfile = { isCompanyOwner: boolean; companyRole: "owner" | "admin" | "teacher" | "staff" | null };
export type CompanyMember = { userId: string; name: string; email: string | null; role: "owner" | "admin" | "teacher" | "staff"; joinedAt: string };
export type Invitation = { token: string; email: string; role: "teacher" | "student"; studentId: string | null; status: "pending" | "accepted" | "revoked"; expiresAt: string; createdAt: string };
export type ConnectionOption = { type: "teacher" | "company"; id: string; name: string };
export type ConnectionRequest = { id: string; studentName: string; targetName: string; targetType: "teacher" | "company"; requestedAt: string };
export type PracticeSession = {
  id: string;
  studentId: string;
  studentName: string;
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

function mapStudentRows(rows: Array<{ id: string; display_name: string; organization_id: string | null; organization_name: string | null; created_at: string }>): StudentProfile[] {
  return rows.map((row) => ({ id: row.id, name: row.display_name, organizationId: row.organization_id, organizationName: row.organization_name, createdAt: row.created_at }));
}

export function listStudentsForUser(userId: string): StudentProfile[] {
  const db = openDanceDatabase();
  try {
    return mapStudentRows(db.prepare(`SELECT s.id, s.display_name, s.organization_id, o.display_name AS organization_name, s.created_at
      FROM students s LEFT JOIN organizations o ON o.id = s.organization_id WHERE s.user_id = ?
      ORDER BY s.display_name COLLATE NOCASE`).all(userId) as Array<{
      id: string; display_name: string; organization_id: string | null; organization_name: string | null; created_at: string;
    }>);
  } finally { db.close(); }
}

export function listStudentsForTeacher(userId: string): StudentProfile[] {
  const db = openDanceDatabase();
  try {
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

export function canAccessStudent(userId: string, studentId: string, asTeacher: boolean): boolean {
  const db = openDanceDatabase();
  try {
    if (!asTeacher) return Boolean(db.prepare("SELECT 1 FROM students WHERE id = ? AND user_id = ?").get(studentId, userId));
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
    const teachers = db.prepare(`SELECT DISTINCT tp.user_id AS id, COALESCE(u.name, tp.display_name) AS name FROM teacher_profiles tp LEFT JOIN "user" u ON u.id = tp.user_id WHERE tp.user_id IS NOT NULL`).all() as Array<{ id: string; name: string }>;
    const companies = db.prepare("SELECT id, display_name AS name FROM organizations ORDER BY display_name COLLATE NOCASE").all() as Array<{ id: string; name: string }>;
    return [...teachers.map((teacher) => ({ type: "teacher" as const, id: teacher.id, name: teacher.name })), ...companies.map((company) => ({ type: "company" as const, id: company.id, name: company.name }))];
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
      COALESCE(tu.name, tp.display_name, o.display_name) AS target_name
      FROM connection_requests cr JOIN students s ON s.id = cr.student_id
      LEFT JOIN teacher_profiles tp ON tp.user_id = cr.target_user_id LEFT JOIN "user" tu ON tu.id = cr.target_user_id
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
      if (request.target_type === "teacher") db.prepare("INSERT OR IGNORE INTO student_teacher_assignments (student_id, teacher_user_id, permission) VALUES (?, ?, 'manage')").run(request.student_id, request.target_user_id);
      else db.prepare("INSERT OR IGNORE INTO student_company_assignments (student_id, company_id, permission) VALUES (?, ?, 'manage')").run(request.student_id, request.target_company_id);
    }
    db.prepare("UPDATE connection_requests SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?").run(accept ? "accepted" : "declined", requestId);
    db.exec("COMMIT"); return true;
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; } finally { db.close(); }
}

export function listSessions(studentId: string): PracticeSession[] {
  const db = openDanceDatabase();
  try {
    return (db.prepare(`SELECT s.id, s.student_id, p.display_name AS student_name, s.session_date, s.location, s.created_at
      FROM practice_sessions s JOIN students p ON p.id = s.student_id
      WHERE s.student_id = ? ORDER BY s.session_date DESC, s.created_at DESC`).all(studentId) as Array<{
        id: string; student_id: string; student_name: string; session_date: string; location: string; created_at: string;
      }>).map((row) => ({
        id: row.id, studentId: row.student_id, studentName: row.student_name,
        sessionDate: row.session_date, location: row.location, createdAt: row.created_at,
      }));
  } finally { db.close(); }
}

export function createPracticeSession(input: { studentId: string; sessionDate: string; location: string }): PracticeSession | null {
  const id = randomUUID();
  const db = openDanceDatabase();
  try {
    const student = db.prepare("SELECT display_name FROM students WHERE id = ?").get(input.studentId) as { display_name: string } | undefined;
    if (!student) return null;
    db.prepare("INSERT INTO practice_sessions (id, student_id, session_date, location) VALUES (?, ?, ?, ?)")
      .run(id, input.studentId, input.sessionDate, input.location.trim());
    const row = db.prepare("SELECT created_at FROM practice_sessions WHERE id = ?").get(id) as { created_at: string };
    return { id, studentId: input.studentId, studentName: student.display_name, sessionDate: input.sessionDate, location: input.location.trim(), createdAt: row.created_at };
  } finally { db.close(); }
}

export function getSessionSnapshot(sessionId: string): SessionSnapshot | null {
  const db = openDanceDatabase();
  try {
    const row = db.prepare(`SELECT s.id, s.student_id, p.display_name AS student_name, s.session_date, s.location, s.created_at
      FROM practice_sessions s JOIN students p ON p.id = s.student_id WHERE s.id = ?`).get(sessionId) as {
        id: string; student_id: string; student_name: string; session_date: string; location: string; created_at: string;
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
      session: { id: row.id, studentId: row.student_id, studentName: row.student_name, sessionDate: row.session_date, location: row.location, createdAt: row.created_at },
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
