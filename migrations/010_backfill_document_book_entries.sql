-- Migration 010: Backfill document_book_entries for existing documents
-- Purpose: Ensure all existing documents in books have corresponding entries
-- This is needed because older documents were created before the entry logic was added

INSERT INTO document_book_entries (document_id, doc_type, book_id, so_den, so_den_so, vao_so_boi, vao_so_luc, trang_thai)
SELECT 
    d.id,
    'incoming',
    d.so_van_ban_id,
    d.so_den,
    COALESCE(d.so_den_so, 0),
    d.created_by,
    d.created_at,
    CASE 
        WHEN d.trang_thai = 'hoan_thanh' THEN 'da_xu_ly'
        ELSE 'dang_xu_ly'
    END
FROM incoming_documents d
WHERE d.so_van_ban_id IS NOT NULL
  AND d.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM document_book_entries dbe 
      WHERE dbe.document_id = d.id AND dbe.book_id = d.so_van_ban_id
  )
ON CONFLICT (document_id, book_id) DO NOTHING;
