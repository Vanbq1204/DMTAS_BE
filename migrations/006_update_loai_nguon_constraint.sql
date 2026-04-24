
-- Migration to update loai_nguon constraint
ALTER TABLE incoming_documents DROP CONSTRAINT IF EXISTS incoming_documents_loai_nguon_check;

ALTER TABLE incoming_documents 
ADD CONSTRAINT incoming_documents_loai_nguon_check 
CHECK (loai_nguon IN ('cap_tren', 'lien_thong', 'trong_he_thong', 'noi_bo', 'so_vb_den', 'email'));
