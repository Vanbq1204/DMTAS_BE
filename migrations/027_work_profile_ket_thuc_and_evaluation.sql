-- ============================================================================
-- MIGRATION 027: Duyệt kết thúc 2 bước (phụ trách + chủ trì) và đánh giá thành viên
-- ============================================================================

-- ─── Bổ sung cột cho luồng duyệt kết thúc 2 bước ───
ALTER TABLE work_profiles
    ADD COLUMN IF NOT EXISTS phu_trach_ket_thuc_status   VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS phu_trach_ket_thuc_comment  TEXT,
    ADD COLUMN IF NOT EXISTS phu_trach_ket_thuc_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS chu_tri_ket_thuc_status     VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS chu_tri_ket_thuc_comment    TEXT,
    ADD COLUMN IF NOT EXISTS chu_tri_ket_thuc_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS evaluation_status           VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS evaluation_delegated_to_id  INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Cho phép check status
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_phu_trach_ket_thuc_chk') THEN
        ALTER TABLE work_profiles ADD CONSTRAINT wp_phu_trach_ket_thuc_chk
            CHECK (phu_trach_ket_thuc_status IN ('pending','approved'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_chu_tri_ket_thuc_chk') THEN
        ALTER TABLE work_profiles ADD CONSTRAINT wp_chu_tri_ket_thuc_chk
            CHECK (chu_tri_ket_thuc_status IN ('pending','approved'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wp_evaluation_status_chk') THEN
        ALTER TABLE work_profiles ADD CONSTRAINT wp_evaluation_status_chk
            CHECK (evaluation_status IN ('pending','done','skipped','delegated'));
    END IF;
END $$;

-- ─── Bảng đánh giá hiệu quả thành viên ───
CREATE TABLE IF NOT EXISTS work_profile_evaluations (
    id                   SERIAL PRIMARY KEY,
    profile_id           INTEGER NOT NULL REFERENCES work_profiles(id) ON DELETE CASCADE,
    evaluated_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    evaluator_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    evaluator_role       VARCHAR(16) NOT NULL,       -- 'phu_trach' | 'chu_tri' (khi được uỷ quyền)
    score                NUMERIC(4,2) NOT NULL,      -- thang điểm 0-10
    comment              TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, evaluated_user_id),
    CHECK (score >= 0 AND score <= 10),
    CHECK (evaluator_role IN ('phu_trach','chu_tri'))
);

CREATE INDEX IF NOT EXISTS idx_wp_evaluations_profile ON work_profile_evaluations(profile_id);
CREATE INDEX IF NOT EXISTS idx_wp_evaluations_user ON work_profile_evaluations(evaluated_user_id);

COMMENT ON TABLE work_profile_evaluations IS 'Lãnh đạo phụ trách (hoặc chủ trì được uỷ quyền) đánh giá hiệu quả từng thành viên khi kết thúc hồ sơ.';
