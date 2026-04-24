-- Đầu mục / danh mục loại hồ sơ công việc theo từng người dùng và role
CREATE TABLE IF NOT EXISTS work_profile_headings (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         VARCHAR(32) NOT NULL CHECK (role IN ('van_thu', 'lanh_dao', 'nhan_vien')),
    ten_loai     VARCHAR(255) NOT NULL,
    ma_ky_hieu   VARCHAR(64) NOT NULL,
    thu_tu       INTEGER NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT work_profile_headings_user_role_ma_unique UNIQUE (user_id, role, ma_ky_hieu)
);

CREATE INDEX IF NOT EXISTS idx_work_profile_headings_user_role
    ON work_profile_headings (user_id, role);

COMMENT ON TABLE work_profile_headings IS 'Danh mục loại hồ sơ + mã ký hiệu (tiền tố) cấu hình cá nhân theo role';
