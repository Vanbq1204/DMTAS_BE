
-- Final robust migration for constraints
ALTER TABLE incoming_documents DROP CONSTRAINT IF EXISTS incoming_documents_loai_nguon_check;
ALTER TABLE incoming_documents DROP CONSTRAINT IF EXISTS incoming_documents_muc_khan_check;
ALTER TABLE incoming_documents DROP CONSTRAINT IF EXISTS incoming_documents_muc_mat_check;
ALTER TABLE incoming_documents DROP CONSTRAINT IF EXISTS incoming_documents_the_loai_check;
ALTER TABLE incoming_documents DROP CONSTRAINT IF EXISTS incoming_documents_trang_thai_check;

ALTER TABLE incoming_documents ADD CONSTRAINT incoming_documents_loai_nguon_check CHECK (loai_nguon IN ('cap_tren', 'lien_thong', 'trong_he_thong', 'noi_bo', 'so_vb_den', 'email'));
ALTER TABLE incoming_documents ADD CONSTRAINT incoming_documents_muc_khan_check CHECK (muc_khan IN ('thuong', 'khan', 'thuong_khan'));
ALTER TABLE incoming_documents ADD CONSTRAINT incoming_documents_muc_mat_check CHECK (muc_mat IN ('thuong', 'mat', 'toi_mat'));
ALTER TABLE incoming_documents ADD CONSTRAINT incoming_documents_trang_thai_check CHECK (trang_thai IN ('moi_tiep_nhan', 'cho_lanh_dao_xem', 'da_giao_xu_ly', 'dang_xu_ly', 'cho_duyet_ket_qua', 'hoan_thanh', 'luu_tru'));
-- Note: the_loai check is now handled by controller mapping, we can make it more flexible in DB
