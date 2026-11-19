-- Role assignment dates already live in user_roles.created_at. Keep trial
-- enrollment separate so removing/re-adding a role cannot restart the trial.
CREATE TABLE IF NOT EXISTS user_pro_trials (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at > started_at)
);
