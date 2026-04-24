-- Mở rộng luồng đầu việc:
--   1. Người được giao có thể "nhận việc" (accepted) hoặc "từ chối" (rejected).
--   2. Sau khi nhận, nộp kết quả kèm file -> submission chờ duyệt.
--   3. Chủ trì và phụ trách đều phải duyệt (kèm ý kiến) thì task mới hoàn thành.
--   4. Nếu 1 trong 2 không duyệt -> submission bị reject, người nhận phải nộp lại.

-- ---------- work_profile_tasks ----------
ALTER TABLE work_profile_tasks
    ADD COLUMN IF NOT EXISTS accept_status  VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS accepted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- Ràng buộc giá trị
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'work_profile_tasks' AND constraint_name = 'work_profile_tasks_accept_status_check'
    ) THEN
        ALTER TABLE work_profile_tasks
            ADD CONSTRAINT work_profile_tasks_accept_status_check
            CHECK (accept_status IN ('pending','accepted','rejected'));
    END IF;
END$$;

-- Cho phép trang_thai có thêm 'cho_duyet'
ALTER TABLE work_profile_tasks DROP CONSTRAINT IF EXISTS work_profile_tasks_trang_thai_check;
ALTER TABLE work_profile_tasks
    ADD CONSTRAINT work_profile_tasks_trang_thai_check
    CHECK (trang_thai IN ('chua_xu_ly','dang_xu_ly','cho_duyet','da_hoan_thanh','tu_choi'));

CREATE INDEX IF NOT EXISTS idx_wpt_accept_status ON work_profile_tasks(accept_status);

COMMENT ON COLUMN work_profile_tasks.accept_status IS
  'pending=chờ người nhận xác nhận; accepted=đã nhận việc; rejected=đã từ chối (ẩn khỏi phối hợp của họ).';

-- ---------- work_profile_task_submissions ----------
-- Mỗi lần người nhận "Nộp kết quả" tạo 1 submission. Chủ trì và phụ trách duyệt riêng biệt.
-- Task coi như hoàn thành khi có 1 submission mà chu_tri_status='approved' VÀ phu_trach_status='approved'.
CREATE TABLE IF NOT EXISTS work_profile_task_submissions (
    id                   SERIAL PRIMARY KEY,
    task_id              INTEGER NOT NULL REFERENCES work_profile_tasks(id) ON DELETE CASCADE,
    submitted_by_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    noi_dung             TEXT,

    chu_tri_status       VARCHAR(16) NOT NULL DEFAULT 'pending',
    chu_tri_reviewer_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    chu_tri_comment      TEXT,
    chu_tri_reviewed_at  TIMESTAMPTZ,

    phu_trach_status     VARCHAR(16) NOT NULL DEFAULT 'pending',
    phu_trach_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    phu_trach_comment    TEXT,
    phu_trach_reviewed_at TIMESTAMPTZ,

    final_status         VARCHAR(16) NOT NULL DEFAULT 'pending',

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (chu_tri_status IN ('pending','approved','rejected')),
    CHECK (phu_trach_status IN ('pending','approved','rejected')),
    CHECK (final_status IN ('pending','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_wpts_task ON work_profile_task_submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_wpts_final ON work_profile_task_submissions(task_id, final_status);

COMMENT ON TABLE work_profile_task_submissions IS
  'Mỗi lần người nhận việc nộp kết quả tạo một submission. Chủ trì + phụ trách cùng duyệt.';

-- ---------- work_profile_files ----------
-- Gắn file vào một submission (kết quả kèm file báo cáo).
ALTER TABLE work_profile_files
    ADD COLUMN IF NOT EXISTS submission_id INTEGER REFERENCES work_profile_task_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wpf_submission ON work_profile_files(submission_id);

COMMENT ON COLUMN work_profile_files.submission_id IS
  'File kèm theo submission (kết quả nộp). loai_file nên là ''ket_qua_dau_viec''.';
