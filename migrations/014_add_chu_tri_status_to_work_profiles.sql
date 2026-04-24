ALTER TABLE work_profiles
ADD COLUMN IF NOT EXISTS chu_tri_trang_thai VARCHAR(40) NOT NULL DEFAULT 'chua_xu_ly';
