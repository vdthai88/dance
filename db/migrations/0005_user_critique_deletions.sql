-- Critiques are cached by video hash and may be shared across accounts.
-- Track deletion per account so one user's choice cannot erase another's feedback.
CREATE TABLE IF NOT EXISTS user_critique_deletions (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  cache_key text NOT NULL REFERENCES critiques(cache_key) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cache_key)
);
