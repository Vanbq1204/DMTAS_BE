-- Danh mục đầu mục hồ sơ dùng chung theo đơn vị (org), chỉ văn thư quản trị
ALTER TABLE work_profile_headings
ADD COLUMN IF NOT EXISTS org_id INTEGER;

ALTER TABLE work_profile_headings
ADD COLUMN IF NOT EXISTS created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Backfill org_id từ user_id cũ
UPDATE work_profile_headings h
SET org_id = up.org_id
FROM user_positions up
WHERE h.user_id = up.user_id
  AND up.is_primary = true
  AND h.org_id IS NULL;

-- fallback cho dữ liệu cũ thiếu mapping
UPDATE work_profile_headings
SET org_id = 1
WHERE org_id IS NULL;

ALTER TABLE work_profile_headings
ALTER COLUMN org_id SET NOT NULL;

-- Dọn unique cũ theo user/role và thay bằng unique theo org
ALTER TABLE work_profile_headings
DROP CONSTRAINT IF EXISTS work_profile_headings_user_role_ma_unique;

ALTER TABLE work_profile_headings
ADD CONSTRAINT work_profile_headings_org_ma_unique UNIQUE (org_id, ma_ky_hieu);

CREATE INDEX IF NOT EXISTS idx_work_profile_headings_org
ON work_profile_headings (org_id, is_active);
