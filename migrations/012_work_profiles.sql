-- Lưu trữ hồ sơ công việc đã tạo/sửa/xóa trên DB
CREATE TABLE IF NOT EXISTS work_profiles (
    id                      SERIAL PRIMARY KEY,
    role                    VARCHAR(32) NOT NULL CHECK (role IN ('van_thu', 'lanh_dao', 'nhan_vien')),
    created_by_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    heading_id              INTEGER REFERENCES work_profile_headings(id) ON DELETE SET NULL,
    ky_hieu                 VARCHAR(128) NOT NULL,
    loai_ho_so              VARCHAR(255) NOT NULL,
    ma_ky_hieu_tien_to      VARCHAR(64),
    tieu_de                 VARCHAR(500) NOT NULL,
    noi_dung                TEXT,
    van_ban_den_id          INTEGER REFERENCES incoming_documents(id) ON DELETE SET NULL,
    lanh_dao_phu_trach_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    chu_tri_xu_ly_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    han_xu_ly               DATE,
    tinh_trang_xu_ly        VARCHAR(32) NOT NULL DEFAULT 'dang_xu_ly',
    nguoi_tao               VARCHAR(255),
    don_vi_tao              VARCHAR(255),
    ngay_tao                DATE NOT NULL DEFAULT CURRENT_DATE,
    participants            JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_profiles_role_created
    ON work_profiles (role, created_by_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_profiles_ky_hieu
    ON work_profiles (ky_hieu);

COMMENT ON TABLE work_profiles IS 'Hồ sơ công việc lưu trữ chính thức theo từng role';
