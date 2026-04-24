-- Rollback 023_work_profiles_soft_delete.sql
-- Không dùng soft delete nữa — xoá là xoá hẳn khỏi DB.
DROP INDEX IF EXISTS idx_wp_is_deleted;

ALTER TABLE work_profiles
    DROP COLUMN IF EXISTS is_deleted,
    DROP COLUMN IF EXISTS deleted_at,
    DROP COLUMN IF EXISTS deleted_by_id;
