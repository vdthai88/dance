-- ReplAI uploads belong to an account and need not belong to a coaching session.
ALTER TABLE videos ALTER COLUMN session_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS videos_personal_user_sha256_key
  ON videos (uploaded_by_user_id, sha256) WHERE session_id IS NULL;
CREATE INDEX IF NOT EXISTS videos_uploaded_by_created_idx
  ON videos (uploaded_by_user_id, created_at DESC);
