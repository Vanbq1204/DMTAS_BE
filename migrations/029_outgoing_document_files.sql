-- ============================================================================
-- MIGRATION 029: outgoing_document_files
--   Bảng document_files gốc có FK cứng tới incoming_documents(id),
--   nên không thể dùng chung cho văn bản đi. Tạo bảng song song.
-- ============================================================================

CREATE TABLE IF NOT EXISTS outgoing_document_files (
    id            SERIAL PRIMARY KEY,
    document_id   INTEGER NOT NULL REFERENCES outgoing_documents(id) ON DELETE CASCADE,
    ten_file      VARCHAR(255) NOT NULL,
    duong_dan     VARCHAR(500) NOT NULL,
    loai_file     VARCHAR(20),
    kich_thuoc    BIGINT DEFAULT 0,
    uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outgoing_files_document_id ON outgoing_document_files(document_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_files_uploaded_by ON outgoing_document_files(uploaded_by);

COMMENT ON TABLE outgoing_document_files IS 'File đính kèm của văn bản đi.';
