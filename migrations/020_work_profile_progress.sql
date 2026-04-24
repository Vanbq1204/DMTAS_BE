-- Thêm % tiến độ cho hồ sơ công việc
ALTER TABLE work_profiles
    ADD COLUMN IF NOT EXISTS tien_do INTEGER NOT NULL DEFAULT 0;

