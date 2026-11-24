CREATE TABLE student_roster_invites (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  teacher_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  recipient_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'delivery_failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE UNIQUE INDEX student_roster_invites_pending_key
  ON student_roster_invites (teacher_user_id, company_id, email) WHERE status = 'pending';
CREATE INDEX student_roster_invites_teacher_idx ON student_roster_invites (teacher_user_id, created_at DESC);
CREATE INDEX student_roster_invites_recipient_idx ON student_roster_invites (email, status);
