-- Migration: Create document_book_entries junction table
-- Allows a document to appear in multiple sổ văn bản simultaneously.
-- Previously, incoming_documents.so_van_ban_id pointed to only one book;
-- when forwarded to another clerk with "vào sổ", the original entry was overwritten.

CREATE TABLE IF NOT EXISTS document_book_entries (
    id          SERIAL PRIMARY KEY,
    document_id INTEGER      NOT NULL REFERENCES incoming_documents(id) ON DELETE CASCADE,
    book_id     INTEGER      NOT NULL REFERENCES document_books(id)     ON DELETE CASCADE,
    so_den      VARCHAR(200),
    so_den_so   INTEGER      DEFAULT 0,
    entered_at  TIMESTAMP    DEFAULT NOW(),
    entered_by  INTEGER      REFERENCES users(id),
    UNIQUE (document_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_dbe_document_id ON document_book_entries (document_id);
CREATE INDEX IF NOT EXISTS idx_dbe_book_id     ON document_book_entries (book_id);

-- Backfill: create entries for all existing registered documents
INSERT INTO document_book_entries (document_id, book_id, so_den, so_den_so, entered_at, entered_by)
SELECT id, so_van_ban_id, so_den, COALESCE(so_den_so, 0), created_at, created_by
FROM   incoming_documents
WHERE  so_van_ban_id IS NOT NULL
  AND  is_deleted    = false
ON CONFLICT (document_id, book_id) DO NOTHING;
