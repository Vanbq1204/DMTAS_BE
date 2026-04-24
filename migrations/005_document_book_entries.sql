-- Migration 005: Create document_book_entries table
-- Purpose: Allow a document to be registered in multiple books (at different VanThu levels)
-- Also allows tracking "đã xử lý" status per book entry when processing is complete

CREATE TABLE IF NOT EXISTS document_book_entries (
    id SERIAL PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES incoming_documents(id) ON DELETE CASCADE,
    doc_type VARCHAR(30) NOT NULL DEFAULT 'incoming',
    book_id INTEGER NOT NULL REFERENCES document_books(id),
    so_den VARCHAR(100),               -- Số đến được cấp bởi sổ văn bản này
    so_den_so INTEGER,                 -- Số thứ tự trong sổ
    so_den_noi_bo VARCHAR(100),        -- Số văn bản đến nội bộ (trường mới cho VB nội)
    vao_so_boi INTEGER REFERENCES users(id),  -- Người thực hiện vào sổ
    vao_so_luc TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trang_thai VARCHAR(30) NOT NULL DEFAULT 'dang_xu_ly', -- 'dang_xu_ly' | 'da_xu_ly'
    hoan_thanh_luc TIMESTAMPTZ,        -- Khi cập nhật sang đã xử lý
    ghi_chu TEXT
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_dbe_document_id ON document_book_entries(document_id);
CREATE INDEX IF NOT EXISTS idx_dbe_book_id ON document_book_entries(book_id);
CREATE INDEX IF NOT EXISTS idx_dbe_vao_so_boi ON document_book_entries(vao_so_boi);
