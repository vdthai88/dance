-- Old hash-only cache entries have no reliable creator attribution. Preserve
-- them and existing session links, but exclude them from personal ReplAI lookups.
-- Do not assign old feedback to an account merely because it uploaded the file.
ALTER TABLE critiques ADD COLUMN IF NOT EXISTS owner_user_id text
  REFERENCES "user"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS critiques_owner_video_created_idx
  ON critiques (owner_user_id, earlier_sha256, created_at DESC);
