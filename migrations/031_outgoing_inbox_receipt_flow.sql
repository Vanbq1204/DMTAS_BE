-- ============================================================================
-- MIGRATION 031: Luồng tiếp nhận nội bộ cho outgoing_internal_inbox
--   - Mở rộng trang_thai: thêm 'da_tiep_nhan', 'tu_choi', 'da_tra_lai'
--   - Thêm cột: ly_do, responded_at, hidden_for_sender
-- ============================================================================

ALTER TABLE outgoing_internal_inbox
    ADD COLUMN IF NOT EXISTS ly_do TEXT,
    ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hidden_for_sender BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop + recreate check constraint để thêm trạng thái mới
ALTER TABLE outgoing_internal_inbox DROP CONSTRAINT IF EXISTS outgoing_internal_inbox_trang_thai_chk;
ALTER TABLE outgoing_internal_inbox ADD CONSTRAINT outgoing_internal_inbox_trang_thai_chk
    CHECK (trang_thai IN (
        'chua_doc',
        'da_doc',
        'da_tiep_nhan',
        'tu_choi',
        'da_tra_lai'
    ));

CREATE INDEX IF NOT EXISTS idx_oii_hidden_for_sender ON outgoing_internal_inbox(hidden_for_sender);
CREATE INDEX IF NOT EXISTS idx_oii_responded_at     ON outgoing_internal_inbox(responded_at DESC);

COMMENT ON COLUMN outgoing_internal_inbox.ly_do            IS 'Lý do từ chối hoặc trả lại (do người nhận nhập).';
COMMENT ON COLUMN outgoing_internal_inbox.responded_at    IS 'Thời điểm người nhận thao tác tiếp nhận/từ chối/trả lại.';
COMMENT ON COLUMN outgoing_internal_inbox.hidden_for_sender IS 'True nếu người gửi (văn thư) đã xoá thông báo khỏi tab bị từ chối/bị trả lại.';
