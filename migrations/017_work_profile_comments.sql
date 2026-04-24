CREATE TABLE IF NOT EXISTS work_profile_comments (
    id          SERIAL PRIMARY KEY,
    profile_id  INTEGER NOT NULL REFERENCES work_profiles(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    vai_tro     VARCHAR(32) NOT NULL,
    noi_dung    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wpc_profile ON work_profile_comments(profile_id);
