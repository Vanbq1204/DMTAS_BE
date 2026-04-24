-- ============================================================================
-- MIGRATION 030: outgoing_internal_recipients + outgoing_internal_inbox
--   Lưu danh sách người nhận nội bộ (cá nhân / phòng ban) của văn bản đi,
--   và fan-out thành hàng đợi tiếp nhận theo từng user cho tab
--   "Văn bản đến tiếp nhận nội bộ".
-- ============================================================================

-- 1) Người nhận nội bộ (ghi nhận việc gửi): user hoặc org/phòng ban
CREATE TABLE IF NOT EXISTS outgoing_internal_recipients (
    id              SERIAL PRIMARY KEY,
    outgoing_id     INTEGER NOT NULL REFERENCES outgoing_documents(id) ON DELETE CASCADE,
    recipient_type  VARCHAR(20) NOT NULL,
    recipient_id    INTEGER NOT NULL,
    recipient_name  VARCHAR(255),
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (outgoing_id, recipient_type, recipient_id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outgoing_internal_recipients_type_chk') THEN
        ALTER TABLE outgoing_internal_recipients
            ADD CONSTRAINT outgoing_internal_recipients_type_chk
            CHECK (recipient_type IN ('user', 'org'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oir_outgoing   ON outgoing_internal_recipients(outgoing_id);
CREATE INDEX IF NOT EXISTS idx_oir_recipient  ON outgoing_internal_recipients(recipient_type, recipient_id);

-- 2) Hộp thư nội bộ (fan-out đến từng user thực tế)
CREATE TABLE IF NOT EXISTS outgoing_internal_inbox (
    id            SERIAL PRIMARY KEY,
    outgoing_id   INTEGER NOT NULL REFERENCES outgoing_documents(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    via_type      VARCHAR(20) NOT NULL DEFAULT 'user',     -- 'user' | 'org'
    via_ref_id    INTEGER,                                 -- org_id nếu qua phòng ban
    trang_thai    VARCHAR(30) NOT NULL DEFAULT 'chua_doc', -- 'chua_doc' | 'da_doc' | 'da_xu_ly'
    sent_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at       TIMESTAMPTZ,
    UNIQUE (outgoing_id, user_id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outgoing_internal_inbox_via_type_chk') THEN
        ALTER TABLE outgoing_internal_inbox
            ADD CONSTRAINT outgoing_internal_inbox_via_type_chk
            CHECK (via_type IN ('user', 'org'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outgoing_internal_inbox_trang_thai_chk') THEN
        ALTER TABLE outgoing_internal_inbox
            ADD CONSTRAINT outgoing_internal_inbox_trang_thai_chk
            CHECK (trang_thai IN ('chua_doc', 'da_doc', 'da_xu_ly'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oii_user        ON outgoing_internal_inbox(user_id);
CREATE INDEX IF NOT EXISTS idx_oii_outgoing    ON outgoing_internal_inbox(outgoing_id);
CREATE INDEX IF NOT EXISTS idx_oii_trang_thai  ON outgoing_internal_inbox(trang_thai);
CREATE INDEX IF NOT EXISTS idx_oii_sent_at     ON outgoing_internal_inbox(sent_at DESC);

-- 3) Cho phép thêm trạng thái "da_gui_noi_bo" cho outgoing_documents
ALTER TABLE outgoing_documents DROP CONSTRAINT IF EXISTS outgoing_documents_trang_thai_chk;
ALTER TABLE outgoing_documents ADD CONSTRAINT outgoing_documents_trang_thai_chk
    CHECK (trang_thai IN (
        'cho_cap_ky_so',
        'so_van_ban_di_co_quan',
        'da_gui_noi_bo',
        'bi_tu_choi_tiep_nhan',
        'bi_tra_lai',
        'da_tra_lai'
    ));

COMMENT ON TABLE outgoing_internal_recipients IS 'Danh sách người nhận nội bộ (user / phòng ban) của văn bản đi.';
COMMENT ON TABLE outgoing_internal_inbox IS 'Hàng đợi tiếp nhận nội bộ theo từng user (fan-out từ văn bản đi).';
