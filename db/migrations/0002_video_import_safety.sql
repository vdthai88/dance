-- Lets legacy SQLite video metadata be imported idempotently.
CREATE UNIQUE INDEX IF NOT EXISTS videos_session_sha256_key ON videos (session_id, sha256);
