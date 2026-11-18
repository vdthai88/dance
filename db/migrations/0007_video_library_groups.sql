CREATE TABLE IF NOT EXISTS video_library_groups (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  collapsed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE TABLE IF NOT EXISTS video_library_group_items (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  video_id text NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  group_id text NOT NULL,
  PRIMARY KEY (user_id, video_id),
  FOREIGN KEY (group_id, user_id) REFERENCES video_library_groups(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS video_library_group_items_group_idx ON video_library_group_items(group_id);
ALTER TABLE critiques ADD COLUMN IF NOT EXISTS earlier_song_start double precision NOT NULL DEFAULT 0;
ALTER TABLE critiques ADD COLUMN IF NOT EXISTS newer_song_start double precision NOT NULL DEFAULT 0;
