CREATE TABLE IF NOT EXISTS work_profile_files (
    id          SERIAL PRIMARY KEY,
    profile_id  INTEGER NOT NULL REFERENCES work_profiles(id) ON DELETE CASCADE,
    loai_file   VARCHAR(40) NOT NULL,
    ten_file    VARCHAR(500),
    duong_dan   VARCHAR(500),
    kich_thuoc  INTEGER,
    doc_type    VARCHAR(40),
    ref_id      INTEGER,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wpf_profile ON work_profile_files(profile_id);
CREATE INDEX IF NOT EXISTS idx_wpf_loai ON work_profile_files(profile_id, loai_file);
