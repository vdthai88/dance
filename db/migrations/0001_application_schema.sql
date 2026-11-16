-- One application schema for PostgreSQL / Neon.
-- Run Better Auth's generated auth migration first. It creates "user",
-- account, session, and verification, which this application schema references.

CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY, name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
  organization_name text NOT NULL DEFAULT '', birth_year integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY, display_name text NOT NULL,
  organization_type text NOT NULL CHECK (organization_type IN ('studio', 'private_company', 'other')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_display_name_ci_key ON organizations (lower(display_name));

CREATE TABLE IF NOT EXISTS company_memberships (
  company_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'teacher', 'staff')),
  is_default boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_company_per_user ON company_memberships (user_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS students (
  id text PRIMARY KEY, display_name text NOT NULL,
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  organization_id text REFERENCES organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS students_display_name_ci_key ON students (lower(display_name));

CREATE TABLE IF NOT EXISTS teacher_profiles (
  id text PRIMARY KEY, user_id text UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  organization_id text REFERENCES organizations(id) ON DELETE SET NULL,
  is_company_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_company_assignments (
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'manage' CHECK (permission IN ('view', 'manage')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, company_id)
);
CREATE INDEX IF NOT EXISTS student_company_assignments_company_idx ON student_company_assignments (company_id, student_id);

CREATE TABLE IF NOT EXISTS student_teacher_assignments (
  student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  permission text NOT NULL DEFAULT 'manage' CHECK (permission IN ('view', 'manage')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, teacher_user_id)
);

CREATE TABLE IF NOT EXISTS company_join_requests (
  id text PRIMARY KEY, company_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  requested_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS connection_requests (
  id text PRIMARY KEY, student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('teacher', 'company')),
  target_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  target_company_id text REFERENCES organizations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  CHECK ((target_type = 'teacher' AND target_user_id IS NOT NULL AND target_company_id IS NULL)
      OR (target_type = 'company' AND target_company_id IS NOT NULL AND target_user_id IS NULL))
);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY, token text NOT NULL UNIQUE,
  company_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id text REFERENCES students(id) ON DELETE CASCADE,
  email text NOT NULL, invitation_role text NOT NULL CHECK (invitation_role IN ('teacher', 'student')),
  invited_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  expires_at timestamptz NOT NULL, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id text PRIMARY KEY, student_id text NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  company_id text REFERENCES organizations(id) ON DELETE SET NULL,
  session_name text NOT NULL DEFAULT '', session_date date NOT NULL,
  location text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS practice_sessions_student_company_idx ON practice_sessions (student_id, company_id, session_date DESC);

-- object_key remains null for legacy SQLite rows whose original file was never stored.
CREATE TABLE IF NOT EXISTS videos (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  uploaded_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  object_key text UNIQUE, original_filename text NOT NULL, content_type text,
  byte_size bigint, sha256 text NOT NULL,
  storage_status text NOT NULL DEFAULT 'ready' CHECK (storage_status IN ('uploading', 'ready', 'reupload_required', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS videos_session_idx ON videos (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS critiques (
  cache_key text PRIMARY KEY, earlier_sha256 text NOT NULL, newer_sha256 text,
  earlier_filename text NOT NULL DEFAULT '', newer_filename text,
  model text NOT NULL, critique_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_critiques (
  session_id text NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  cache_key text NOT NULL REFERENCES critiques(cache_key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (session_id, cache_key)
);

CREATE TABLE IF NOT EXISTS session_teacher_feedback (
  id text PRIMARY KEY, session_id text NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  model text NOT NULL, feedback_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_feedback (
  id text PRIMARY KEY, video_sha256 text NOT NULL, video_filename text NOT NULL,
  model text NOT NULL, feedback_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
