-- Bảng đầu việc (tasks) trong một hồ sơ công việc.
-- Chủ trì hoặc phụ trách tạo đầu việc; giao cho cá nhân hoặc phòng ban.
-- Khi giao cho phòng ban, backend resolve đại diện phòng ban
-- (users.is_representative = true + user_positions.is_primary = true + cùng org_id)
-- và gán vào assigned_user_id; assigned_org_id dùng để hiển thị.

CREATE TABLE IF NOT EXISTS work_profile_tasks (
    id                 SERIAL PRIMARY KEY,
    profile_id         INTEGER NOT NULL REFERENCES work_profiles(id) ON DELETE CASCADE,
    tieu_de            VARCHAR(500) NOT NULL,
    mo_ta              TEXT,
    nguoi_giao_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assignee_type      VARCHAR(16) NOT NULL CHECK (assignee_type IN ('ca_nhan', 'phong_ban')),
    assigned_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_org_id    INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
    han_xu_ly          DATE,
    trang_thai         VARCHAR(32) NOT NULL DEFAULT 'chua_xu_ly'
                       CHECK (trang_thai IN ('chua_xu_ly', 'dang_xu_ly', 'da_hoan_thanh', 'tu_choi')),
    ket_qua            TEXT,
    ngay_hoan_thanh    DATE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wpt_profile ON work_profile_tasks(profile_id);
CREATE INDEX IF NOT EXISTS idx_wpt_assigned_user ON work_profile_tasks(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_wpt_assigned_org ON work_profile_tasks(assigned_org_id);
CREATE INDEX IF NOT EXISTS idx_wpt_status ON work_profile_tasks(profile_id, trang_thai);

COMMENT ON TABLE  work_profile_tasks IS 'Đầu việc chi tiết trong một hồ sơ công việc, giao cho cá nhân hoặc phòng ban.';
COMMENT ON COLUMN work_profile_tasks.assigned_user_id IS 'Người nhận thực tế (cá nhân được chọn hoặc đại diện phòng ban resolved).';
COMMENT ON COLUMN work_profile_tasks.assigned_org_id  IS 'Phòng ban được giao (null nếu assignee_type = ca_nhan).';
