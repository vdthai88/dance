CREATE TABLE IF NOT EXISTS video_dancer_selections (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  video_sha256 text NOT NULL,
  detection_json jsonb,
  selected_key text,
  selected_description text,
  reference_seconds double precision,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_sha256),
  CHECK (reference_seconds IS NULL OR reference_seconds >= 0)
);
ALTER TABLE critiques ADD COLUMN IF NOT EXISTS earlier_subject_key text;
ALTER TABLE critiques ADD COLUMN IF NOT EXISTS newer_subject_key text;
