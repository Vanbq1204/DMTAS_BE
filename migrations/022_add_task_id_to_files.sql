-- Liên kết file với 1 đầu việc cụ thể (nếu có)
ALTER TABLE work_profile_files
    ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES work_profile_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wpf_task ON work_profile_files(task_id);

COMMENT ON COLUMN work_profile_files.task_id IS
    'Đầu việc gắn với file (loai_file = ''tai_lieu_giao_viec'')';
