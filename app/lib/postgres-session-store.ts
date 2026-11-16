import { randomUUID } from "node:crypto";
import { getPostgresPool } from "../../db/postgres";
import { isDanceCritique, isTeacherFeedback } from "./gemini-critique";
import type { TeacherFeedback } from "./gemini-critique";
import { ensurePgStudentProfile } from "./postgres-profile-store";
import type {
  PracticeSession,
  SessionCritique,
  SessionSnapshot,
  SessionTeacherFeedback,
  StudentProfile,
} from "./session-store";

type SqlStudentRow = {
  id: string; display_name: string; organization_id: string | null;
  organization_name: string | null; created_at: Date | string;
};

function asIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapStudentRows(rows: SqlStudentRow[]): StudentProfile[] {
  return rows.map((row) => ({
    id: row.id, name: row.display_name, organizationId: row.organization_id,
    organizationName: row.organization_name, createdAt: asIso(row.created_at),
  }));
}

export async function listPgStudentsForUser(userId: string): Promise<StudentProfile[]> {
  const pool = getPostgresPool();
  const hasStudentRole = await pool.query("SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = 'student'", [userId]);
  if (hasStudentRole.rowCount) {
    await ensurePgStudentProfile(userId);
  }
  const { rows } = await pool.query(`SELECT s.id, s.display_name, s.organization_id, o.display_name AS organization_name, s.created_at
    FROM students s LEFT JOIN organizations o ON o.id = s.organization_id
    WHERE s.user_id = $1 ORDER BY s.display_name`, [userId]);
  return mapStudentRows(rows as SqlStudentRow[]);
}

export async function listPgStudentsForTeacher(userId: string, companyId?: string | null): Promise<StudentProfile[]> {
  const pool = getPostgresPool();
  const query = companyId
    ? { text: `SELECT DISTINCT s.id, s.display_name, s.organization_id, o.display_name AS organization_name, s.created_at
        FROM students s JOIN student_company_assignments sca ON sca.student_id = s.id
        LEFT JOIN organizations o ON o.id = s.organization_id
        JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = $1
        WHERE sca.company_id = $2 AND cm.role IN ('owner', 'admin', 'teacher') ORDER BY s.display_name`, values: [userId, companyId] }
    : { text: `SELECT DISTINCT s.id, s.display_name, s.organization_id, o.display_name AS organization_name, s.created_at
        FROM students s LEFT JOIN organizations o ON o.id = s.organization_id
        LEFT JOIN student_teacher_assignments sta ON sta.student_id = s.id AND sta.teacher_user_id = $1
        LEFT JOIN student_company_assignments sca ON sca.student_id = s.id
        LEFT JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = $1
        WHERE sta.teacher_user_id IS NOT NULL OR cm.role IN ('owner', 'admin', 'teacher') ORDER BY s.display_name`, values: [userId] };
  const { rows } = await pool.query(query);
  return mapStudentRows(rows as SqlStudentRow[]);
}

export async function pgCanAccessStudent(userId: string, studentId: string, asTeacher: boolean, companyId?: string | null): Promise<boolean> {
  const pool = getPostgresPool();
  if (!asTeacher) {
    const { rowCount } = companyId
      ? await pool.query(`SELECT 1 FROM students s JOIN student_company_assignments sca ON sca.student_id = s.id
          WHERE s.id = $1 AND s.user_id = $2 AND sca.company_id = $3`, [studentId, userId, companyId])
      : await pool.query("SELECT 1 FROM students WHERE id = $1 AND user_id = $2", [studentId, userId]);
    return Boolean(rowCount);
  }
  const { rowCount } = companyId
    ? await pool.query(`SELECT 1 FROM student_company_assignments sca
        JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = $1
        WHERE sca.student_id = $2 AND sca.company_id = $3 AND cm.role IN ('owner', 'admin', 'teacher')`, [userId, studentId, companyId])
    : await pool.query(`SELECT 1 FROM students s
        LEFT JOIN student_teacher_assignments sta ON sta.student_id = s.id AND sta.teacher_user_id = $1
        LEFT JOIN student_company_assignments sca ON sca.student_id = s.id
        LEFT JOIN company_memberships cm ON cm.company_id = sca.company_id AND cm.user_id = $1
        WHERE s.id = $2 AND (sta.teacher_user_id IS NOT NULL OR cm.role IN ('owner', 'admin', 'teacher'))`, [userId, studentId]);
  return Boolean(rowCount);
}

export async function pgCanAccessSession(userId: string, sessionId: string, asTeacher: boolean): Promise<boolean> {
  const { rows } = await getPostgresPool().query("SELECT student_id FROM practice_sessions WHERE id = $1", [sessionId]);
  const studentId = rows[0]?.student_id as string | undefined;
  return studentId ? pgCanAccessStudent(userId, studentId, asTeacher) : false;
}

export async function createPgStudent(input: { name: string; teacherUserId: string; organizationId?: string | null; studentUserId?: string | null }): Promise<StudentProfile> {
  const client = await getPostgresPool().connect();
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO students (id, display_name, user_id, organization_id) VALUES ($1, $2, $3, $4)", [id, input.name.trim(), input.studentUserId ?? null, input.organizationId ?? null]);
    await client.query("INSERT INTO student_teacher_assignments (student_id, teacher_user_id, permission) VALUES ($1, $2, 'manage') ON CONFLICT DO NOTHING", [id, input.teacherUserId]);
    if (input.organizationId) await client.query("INSERT INTO student_company_assignments (student_id, company_id, permission) VALUES ($1, $2, 'manage') ON CONFLICT DO NOTHING", [id, input.organizationId]);
    if (input.studentUserId) await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'student') ON CONFLICT DO NOTHING", [input.studentUserId]);
    const { rows } = await client.query(`SELECT s.created_at, s.organization_id, o.display_name AS organization_name
      FROM students s LEFT JOIN organizations o ON o.id = s.organization_id WHERE s.id = $1`, [id]);
    await client.query("COMMIT");
    const row = rows[0] as { created_at: Date | string; organization_id: string | null; organization_name: string | null };
    return { id, name: input.name.trim(), organizationId: row.organization_id, organizationName: row.organization_name, createdAt: asIso(row.created_at) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function mapPgSession(row: { id: string; student_id: string; company_id: string | null; student_name: string; session_name: string; session_date: Date | string; location: string; created_at: Date | string }): PracticeSession {
  const sessionDate = asIso(row.session_date).slice(0, 10);
  return { id: row.id, studentId: row.student_id, studentName: row.student_name, companyId: row.company_id,
    name: row.session_name || `${sessionDate} - ${row.student_name}`, sessionDate, location: row.location, createdAt: asIso(row.created_at) };
}

export async function listPgSessions(studentId: string, companyId?: string | null): Promise<PracticeSession[]> {
  const query = companyId
    ? { text: `SELECT s.id, s.student_id, s.company_id, p.display_name AS student_name, s.session_name, s.session_date, s.location, s.created_at
        FROM practice_sessions s JOIN students p ON p.id = s.student_id WHERE s.student_id = $1 AND s.company_id = $2 ORDER BY s.session_date DESC, s.created_at DESC`, values: [studentId, companyId] }
    : { text: `SELECT s.id, s.student_id, s.company_id, p.display_name AS student_name, s.session_name, s.session_date, s.location, s.created_at
        FROM practice_sessions s JOIN students p ON p.id = s.student_id WHERE s.student_id = $1 ORDER BY s.session_date DESC, s.created_at DESC`, values: [studentId] };
  const { rows } = await getPostgresPool().query(query);
  return rows.map((row) => mapPgSession(row as Parameters<typeof mapPgSession>[0]));
}

export async function createPgPracticeSession(input: { studentId: string; companyId: string; sessionDate: string; location: string }): Promise<PracticeSession | null> {
  const pool = getPostgresPool();
  const { rows: students } = await pool.query(`SELECT s.display_name, o.display_name AS organization_name
    FROM students s LEFT JOIN organizations o ON o.id = $1 WHERE s.id = $2`, [input.companyId, input.studentId]);
  const student = students[0] as { display_name: string; organization_name: string | null } | undefined;
  if (!student) return null;
  const id = randomUUID();
  const name = [input.sessionDate, student.display_name, student.organization_name].filter(Boolean).join(" - ");
  const { rows } = await pool.query(`INSERT INTO practice_sessions (id, student_id, company_id, session_name, session_date, location)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at`, [id, input.studentId, input.companyId, name, input.sessionDate, input.location.trim()]);
  return { id, studentId: input.studentId, studentName: student.display_name, companyId: input.companyId, name,
    sessionDate: input.sessionDate, location: input.location.trim(), createdAt: asIso(rows[0].created_at as Date | string) };
}

export async function getPgSessionSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
  const pool = getPostgresPool();
  const { rows } = await pool.query(`SELECT s.id, s.student_id, s.company_id, p.display_name AS student_name, s.session_name, s.session_date, s.location, s.created_at
    FROM practice_sessions s JOIN students p ON p.id = s.student_id WHERE s.id = $1`, [sessionId]);
  if (!rows[0]) return null;
  const session = mapPgSession(rows[0] as Parameters<typeof mapPgSession>[0]);
  const [videoResult, feedbackResult, critiqueResult] = await Promise.all([
    pool.query("SELECT sha256, original_filename, created_at FROM videos WHERE session_id = $1 AND storage_status <> 'deleted' ORDER BY created_at", [sessionId]),
    pool.query("SELECT id, session_id, model, feedback_json, created_at FROM session_teacher_feedback WHERE session_id = $1 ORDER BY created_at DESC", [sessionId]),
    pool.query(`SELECT c.cache_key, c.model, c.critique_json, sc.created_at FROM session_critiques sc
      JOIN critiques c ON c.cache_key = sc.cache_key WHERE sc.session_id = $1 ORDER BY sc.created_at DESC`, [sessionId]),
  ]);
  const teacherFeedback: SessionTeacherFeedback[] = feedbackResult.rows.flatMap((item) => {
    const feedback = item.feedback_json as unknown;
    return isTeacherFeedback(feedback) ? [{ id: item.id as string, sessionId: item.session_id as string, model: item.model as string, feedback, createdAt: asIso(item.created_at as Date | string) }] : [];
  });
  const aiCritiques: SessionCritique[] = critiqueResult.rows.flatMap((item) => {
    const critique = item.critique_json as unknown;
    return isDanceCritique(critique) ? [{ key: item.cache_key as string, model: item.model as string, critique, createdAt: asIso(item.created_at as Date | string) }] : [];
  });
  return { session, videos: videoResult.rows.map((item) => ({ hash: item.sha256 as string, filename: item.original_filename as string, createdAt: asIso(item.created_at as Date | string) })), teacherFeedback, aiCritiques };
}

/** Metadata-only until the R2 storage phase lands. The original bytes remain in the browser/local source today. */
export async function attachPgSessionVideo(sessionId: string, userId: string, videoHash: string, filename: string, contentType?: string | null): Promise<boolean> {
  const pool = getPostgresPool();
  const session = await pool.query("SELECT 1 FROM practice_sessions WHERE id = $1", [sessionId]);
  if (!session.rowCount) return false;
  await pool.query(`INSERT INTO videos (id, session_id, uploaded_by_user_id, original_filename, content_type, sha256, storage_status)
    VALUES ($1, $2, $3, $4, $5, $6, 'reupload_required')
    ON CONFLICT (session_id, sha256) DO UPDATE SET original_filename = excluded.original_filename, content_type = excluded.content_type`,
  [randomUUID(), sessionId, userId, filename, contentType ?? null, videoHash]);
  return true;
}

export async function getPgSessionVideoStorageContext(sessionId: string): Promise<{ companyId: string | null; studentId: string } | null> {
  const { rows } = await getPostgresPool().query("SELECT company_id, student_id FROM practice_sessions WHERE id = $1", [sessionId]);
  const row = rows[0] as { company_id: string | null; student_id: string } | undefined;
  return row ? { companyId: row.company_id, studentId: row.student_id } : null;
}

export async function savePgSessionVideo(input: { sessionId: string; userId: string; videoHash: string; filename: string; contentType: string | null; byteSize: number; objectKey: string }): Promise<boolean> {
  const exists = await getPostgresPool().query("SELECT 1 FROM practice_sessions WHERE id = $1", [input.sessionId]);
  if (!exists.rowCount) return false;
  await getPostgresPool().query(`INSERT INTO videos (id, session_id, uploaded_by_user_id, object_key, original_filename, content_type, byte_size, sha256, storage_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ready')
    ON CONFLICT (session_id, sha256) DO UPDATE SET object_key=excluded.object_key, original_filename=excluded.original_filename,
      content_type=excluded.content_type, byte_size=excluded.byte_size, storage_status='ready'`,
  [randomUUID(), input.sessionId, input.userId, input.objectKey, input.filename, input.contentType, input.byteSize, input.videoHash]);
  return true;
}

export async function findPgSessionVideo(sessionId: string, hash: string): Promise<{ objectKey: string | null; contentType: string | null; filename: string; storageStatus: string } | null> {
  const { rows } = await getPostgresPool().query(`SELECT object_key, content_type, original_filename, storage_status
    FROM videos WHERE session_id = $1 AND sha256 = $2 ORDER BY created_at DESC LIMIT 1`, [sessionId, hash]);
  const row = rows[0] as { object_key: string | null; content_type: string | null; original_filename: string; storage_status: string } | undefined;
  return row ? { objectKey: row.object_key, contentType: row.content_type, filename: row.original_filename, storageStatus: row.storage_status } : null;
}

export async function savePgSessionTeacherFeedback(input: { sessionId: string; model: string; feedback: TeacherFeedback }): Promise<SessionTeacherFeedback> {
  const id = randomUUID();
  const { rows } = await getPostgresPool().query(`INSERT INTO session_teacher_feedback (id, session_id, model, feedback_json)
    VALUES ($1, $2, $3, $4::jsonb) RETURNING created_at`, [id, input.sessionId, input.model, JSON.stringify(input.feedback)]);
  return { id, sessionId: input.sessionId, model: input.model, feedback: input.feedback, createdAt: asIso(rows[0].created_at as Date | string) };
}

export async function findPgSessionTeacherFeedback(id: string): Promise<SessionTeacherFeedback | null> {
  const { rows } = await getPostgresPool().query("SELECT id, session_id, model, feedback_json, created_at FROM session_teacher_feedback WHERE id = $1", [id]);
  const row = rows[0] as { id: string; session_id: string; model: string; feedback_json: unknown; created_at: Date | string } | undefined;
  return row && isTeacherFeedback(row.feedback_json)
    ? { id: row.id, sessionId: row.session_id, model: row.model, feedback: row.feedback_json, createdAt: asIso(row.created_at) }
    : null;
}

export async function updatePgSessionTeacherFeedback(id: string, feedback: TeacherFeedback): Promise<SessionTeacherFeedback | null> {
  const { rows } = await getPostgresPool().query(`UPDATE session_teacher_feedback SET feedback_json = $2::jsonb
    WHERE id = $1 RETURNING session_id, model, created_at`, [id, JSON.stringify(feedback)]);
  const row = rows[0] as { session_id: string; model: string; created_at: Date | string } | undefined;
  return row ? { id, sessionId: row.session_id, model: row.model, feedback, createdAt: asIso(row.created_at) } : null;
}

export async function deletePgSessionTeacherFeedback(id: string): Promise<boolean> {
  return Boolean((await getPostgresPool().query("DELETE FROM session_teacher_feedback WHERE id = $1", [id])).rowCount);
}
