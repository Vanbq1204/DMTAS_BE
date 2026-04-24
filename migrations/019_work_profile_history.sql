CREATE TABLE IF NOT EXISTS work_profile_history (
    id              SERIAL PRIMARY KEY,
    profile_id      INTEGER NOT NULL REFERENCES work_profiles(id) ON DELETE CASCADE,
    hanh_dong       VARCHAR(60) NOT NULL,
    noi_dung        TEXT,
    tu_trang_thai   VARCHAR(40),
    den_trang_thai  VARCHAR(40),
    thuc_hien_boi   INTEGER REFERENCES users(id),
    meta            JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wph_profile ON work_profile_history(profile_id);
CREATE INDEX IF NOT EXISTS idx_wph_created ON work_profile_history(profile_id, created_at DESC);
