-- Soft delete cho work_profiles: chỉ xoá ở UI, DB vẫn giữ
ALTER TABLE work_profiles
    ADD COLUMN IF NOT EXISTS is_deleted   BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wp_is_deleted ON work_profiles(is_deleted);

COMMENT ON COLUMN work_profiles.is_deleted IS
    'Soft delete: true = đã ẩn khỏi giao diện. Chỉ cho phép xoá khi tinh_trang_xu_ly = ''da_ket_thuc''';
