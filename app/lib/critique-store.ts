import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DanceCritique, TeacherFeedback } from "./gemini-critique";
import { isDanceCritique, isTeacherFeedback } from "./gemini-critique";
import { makeCritiqueKey } from "./critique-key";
export { makeCritiqueKey } from "./critique-key";

export type CritiqueVideos = {
  earlier: File;
  newer?: File;
};

export type CritiqueRecord = {
  key: string;
  earlierHash: string;
  newerHash: string | null;
  earlierFilename: string;
  newerFilename: string | null;
  model: string;
  critique: DanceCritique;
  earlierSongStart?: number;
  newerSongStart?: number;
};

export type SavedVideoCritique = {
  critique: DanceCritique;
  filename: string;
  model: string;
  createdAt: string;
};

export type SavedTeacherFeedback = {
  id: string;
  videoHash: string;
  filename: string;
  model: string;
  feedback: TeacherFeedback;
  createdAt: string;
};

export function openDanceDatabase() {
  const path = process.env.DANCE_DATABASE_PATH || join(process.cwd(), "data", "dance.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS critiques (
      cache_key TEXT PRIMARY KEY,
      earlier_sha256 TEXT NOT NULL,
      newer_sha256 TEXT,
      earlier_filename TEXT NOT NULL DEFAULT '',
      newer_filename TEXT,
      model TEXT NOT NULL,
      critique_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS teacher_feedback (
      id TEXT PRIMARY KEY,
      video_sha256 TEXT NOT NULL,
      video_filename TEXT NOT NULL,
      model TEXT NOT NULL,
      feedback_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_teacher_feedback_video
      ON teacher_feedback(video_sha256, created_at DESC);
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      organization_type TEXT NOT NULL CHECK (organization_type IN ('studio', 'private_company', 'other')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS teacher_profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      user_id TEXT,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      is_company_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_company_owner IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      user_id TEXT,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      company_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      session_name TEXT NOT NULL DEFAULT '',
      session_date TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_practice_sessions_student
      ON practice_sessions(student_id, session_date DESC);
    CREATE TABLE IF NOT EXISTS session_teacher_feedback (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      feedback_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_session_feedback_session
      ON session_teacher_feedback(session_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS session_videos (
      session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
      video_sha256 TEXT NOT NULL,
      video_filename TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(session_id, video_sha256)
    );
    CREATE TABLE IF NOT EXISTS session_critiques (
      session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
      cache_key TEXT NOT NULL REFERENCES critiques(cache_key) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(session_id, cache_key)
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS company_memberships (
      company_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'teacher', 'staff')),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(company_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS company_join_requests (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requester_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS student_teacher_assignments (
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      teacher_user_id TEXT NOT NULL,
      permission TEXT NOT NULL DEFAULT 'manage' CHECK (permission IN ('view', 'manage')),
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(student_id, teacher_user_id)
    );
    CREATE TABLE IF NOT EXISTS student_company_assignments (
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      permission TEXT NOT NULL DEFAULT 'manage' CHECK (permission IN ('view', 'manage')),
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(student_id, company_id)
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      student_id TEXT REFERENCES students(id) ON DELETE CASCADE,
      email TEXT NOT NULL COLLATE NOCASE,
      invitation_role TEXT NOT NULL CHECK (invitation_role IN ('teacher', 'student')),
      invited_by_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS connection_requests (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('teacher', 'company')),
      target_user_id TEXT,
      target_company_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at TEXT,
      CHECK ((target_type = 'teacher' AND target_user_id IS NOT NULL AND target_company_id IS NULL) OR (target_type = 'company' AND target_company_id IS NOT NULL AND target_user_id IS NULL))
    );
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      organization_name TEXT NOT NULL DEFAULT '',
      birth_year INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_request_open
      ON connection_requests(student_id, target_type, target_user_id, target_company_id, status);
    CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
    CREATE INDEX IF NOT EXISTS idx_student_teacher_assignments_teacher
      ON student_teacher_assignments(teacher_user_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_student_company_assignments_company
      ON student_company_assignments(company_id, student_id);
    CREATE INDEX IF NOT EXISTS idx_company_join_requests_company
      ON company_join_requests(company_id, status);
  `);
  db.exec("PRAGMA foreign_keys = ON");
  const studentColumns = db.prepare("PRAGMA table_info(students)").all() as Array<{ name: string }>;
  if (!studentColumns.some((column) => column.name === "organization_id")) {
    db.exec("ALTER TABLE students ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL");
  }
  if (!studentColumns.some((column) => column.name === "user_id")) {
    db.exec("ALTER TABLE students ADD COLUMN user_id TEXT");
  }
  const practiceSessionColumns = db.prepare("PRAGMA table_info(practice_sessions)").all() as Array<{ name: string }>;
  if (!practiceSessionColumns.some((column) => column.name === "company_id")) {
    db.exec("ALTER TABLE practice_sessions ADD COLUMN company_id TEXT REFERENCES organizations(id) ON DELETE SET NULL");
    db.exec("UPDATE practice_sessions SET company_id = (SELECT organization_id FROM students WHERE students.id = practice_sessions.student_id) WHERE company_id IS NULL");
  }
  if (!practiceSessionColumns.some((column) => column.name === "session_name")) {
    db.exec("ALTER TABLE practice_sessions ADD COLUMN session_name TEXT NOT NULL DEFAULT ''");
    db.exec(`UPDATE practice_sessions
      SET session_name = session_date || ' - ' || COALESCE((SELECT display_name FROM students WHERE students.id = practice_sessions.student_id), 'Student')
      WHERE session_name = ''`);
  }
  const teacherProfileColumns = db.prepare("PRAGMA table_info(teacher_profiles)").all() as Array<{ name: string }>;
  if (!teacherProfileColumns.some((column) => column.name === "is_company_owner")) {
    db.exec("ALTER TABLE teacher_profiles ADD COLUMN is_company_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_company_owner IN (0, 1))");
  }
  if (!teacherProfileColumns.some((column) => column.name === "user_id")) {
    db.exec("ALTER TABLE teacher_profiles ADD COLUMN user_id TEXT");
  }
  const companyMembershipColumns = db.prepare("PRAGMA table_info(company_memberships)").all() as Array<{ name: string }>;
  if (!companyMembershipColumns.some((column) => column.name === "is_default")) {
    db.exec("ALTER TABLE company_memberships ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))");
    db.exec(`UPDATE company_memberships SET is_default = 1
      WHERE (company_id, user_id) IN (SELECT organization_id, user_id FROM teacher_profiles WHERE organization_id IS NOT NULL)`);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_profiles_user ON teacher_profiles(user_id) WHERE user_id IS NOT NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user ON students(user_id) WHERE user_id IS NOT NULL");
  db.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)").run("student", "student");
  db.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)").run("teacher", "teacher");
  db.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES (?, ?)").run("admin", "admin");
  db.prepare(`INSERT OR IGNORE INTO student_company_assignments (student_id, company_id, permission)
    SELECT id, organization_id, 'manage' FROM students WHERE organization_id IS NOT NULL`).run();
  const columns = db.prepare("PRAGMA table_info(critiques)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "owner_user_id")) {
    db.exec("ALTER TABLE critiques ADD COLUMN owner_user_id TEXT");
  }
  if (!columns.some((column) => column.name === "earlier_filename")) {
    db.exec("ALTER TABLE critiques ADD COLUMN earlier_filename TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some((column) => column.name === "newer_filename")) {
    db.exec("ALTER TABLE critiques ADD COLUMN newer_filename TEXT");
  }
  const userProfileColumns = db.prepare("PRAGMA table_info(user_profiles)").all() as Array<{ name: string }>;
  if (!userProfileColumns.some((column) => column.name === "birth_year")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN birth_year INTEGER");
    if (userProfileColumns.some((column) => column.name === "birthdate")) {
      db.exec("UPDATE user_profiles SET birth_year = CAST(substr(birthdate, 1, 4) AS INTEGER) WHERE birth_year IS NULL AND birthdate IS NOT NULL");
    }
  }
  return db;
}

export function findTeacherFeedback(videoHash: string): SavedTeacherFeedback[] {
  const db = openDanceDatabase();
  try {
    const rows = db.prepare(`SELECT id, video_sha256, video_filename, model, feedback_json, created_at
      FROM teacher_feedback WHERE video_sha256 = ? ORDER BY created_at DESC`).all(videoHash) as Array<{
        id: string;
        video_sha256: string;
        video_filename: string;
        model: string;
        feedback_json: string;
        created_at: string;
      }>;
    const valid: SavedTeacherFeedback[] = [];
    for (const row of rows) {
      let feedback: unknown;
      try {
        feedback = JSON.parse(row.feedback_json);
      } catch {
        db.prepare("DELETE FROM teacher_feedback WHERE id = ?").run(row.id);
        continue;
      }
      if (!isTeacherFeedback(feedback)) {
        db.prepare("DELETE FROM teacher_feedback WHERE id = ?").run(row.id);
        continue;
      }
      valid.push({ id: row.id, videoHash: row.video_sha256, filename: row.video_filename, model: row.model, feedback, createdAt: row.created_at });
    }
    return valid;
  } finally {
    db.close();
  }
}

export function saveTeacherFeedback(input: Omit<SavedTeacherFeedback, "id" | "createdAt">): SavedTeacherFeedback {
  const result: SavedTeacherFeedback = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  const db = openDanceDatabase();
  try {
    db.prepare(`INSERT INTO teacher_feedback (id, video_sha256, video_filename, model, feedback_json)
      VALUES (?, ?, ?, ?, ?)`).run(result.id, result.videoHash, result.filename, result.model, JSON.stringify(result.feedback));
    const saved = db.prepare("SELECT created_at FROM teacher_feedback WHERE id = ?").get(result.id) as { created_at: string };
    result.createdAt = saved.created_at;
    return result;
  } finally {
    db.close();
  }
}

export async function fingerprintVideo(video: File): Promise<string> {
  const hash = createHash("sha256");
  const reader = video.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.digest("hex");
}

export function findCritique(key: string, userId: string): CritiqueRecord | null {
  const db = openDanceDatabase();
  try {
    const row = db.prepare(`SELECT cache_key, earlier_sha256, newer_sha256, earlier_filename, newer_filename, model, critique_json
      FROM critiques WHERE cache_key = ? AND owner_user_id = ?`).get(key, userId) as {
        cache_key: string;
        earlier_sha256: string;
        newer_sha256: string | null;
        earlier_filename: string;
        newer_filename: string | null;
        model: string;
        critique_json: string;
      } | undefined;
    if (!row) return null;
    let critique: unknown;
    try {
      critique = JSON.parse(row.critique_json);
    } catch {
      db.prepare("DELETE FROM critiques WHERE cache_key = ?").run(key);
      return null;
    }
    if (!isDanceCritique(critique)) {
      db.prepare("DELETE FROM critiques WHERE cache_key = ?").run(key);
      return null;
    }
    return {
      key: row.cache_key,
      earlierHash: row.earlier_sha256,
      newerHash: row.newer_sha256,
      earlierFilename: row.earlier_filename,
      newerFilename: row.newer_filename,
      model: row.model,
      critique,
    };
  } finally {
    db.close();
  }
}

export function findCritiqueForVideo(videoHash: string, userId: string): SavedVideoCritique | null {
  const db = openDanceDatabase();
  try {
    const row = db.prepare(`SELECT cache_key, earlier_filename, model, critique_json, created_at
      FROM critiques WHERE earlier_sha256 = ? AND owner_user_id = ? AND newer_sha256 IS NULL
      ORDER BY created_at DESC LIMIT 1`).get(videoHash, userId) as {
        cache_key: string;
        earlier_filename: string;
        model: string;
        critique_json: string;
        created_at: string;
      } | undefined;
    if (!row) return null;
    let critique: unknown;
    try {
      critique = JSON.parse(row.critique_json);
    } catch {
      db.prepare("DELETE FROM critiques WHERE cache_key = ?").run(row.cache_key);
      return null;
    }
    if (!isDanceCritique(critique)) {
      db.prepare("DELETE FROM critiques WHERE cache_key = ?").run(row.cache_key);
      return null;
    }
    return { critique, filename: row.earlier_filename, model: row.model, createdAt: row.created_at };
  } finally {
    db.close();
  }
}

export function saveCritique(record: CritiqueRecord, userId: string): void {
  if (record.key !== makeCritiqueKey(record.earlierHash, record.newerHash, userId)) throw new Error("The critique key does not belong to this account.");
  const db = openDanceDatabase();
  try {
    const result = db.prepare(`INSERT INTO critiques (cache_key, earlier_sha256, newer_sha256, earlier_filename, newer_filename, model, critique_json, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        earlier_filename = excluded.earlier_filename,
        newer_filename = excluded.newer_filename,
        model = excluded.model,
        critique_json = excluded.critique_json,
        created_at = CURRENT_TIMESTAMP WHERE critiques.owner_user_id = excluded.owner_user_id`)
      .run(record.key, record.earlierHash, record.newerHash, record.earlierFilename, record.newerFilename, record.model, JSON.stringify(record.critique), userId);
    if (!result.changes) throw new Error("The critique could not be saved for this account.");
  } finally {
    db.close();
  }
}
