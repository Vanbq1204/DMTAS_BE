
-- Migration to add new fields to incoming_documents
ALTER TABLE incoming_documents
ADD COLUMN linh_vuc VARCHAR(255),
ADD COLUMN chuc_vu VARCHAR(255),
ADD COLUMN phuong_thuc_nhan VARCHAR(100),
ADD COLUMN phai_tra_loi BOOLEAN DEFAULT false,
ADD COLUMN co_ban_giay BOOLEAN DEFAULT false,
ADD COLUMN so_van_ban_id INTEGER REFERENCES document_books(id),
ADD COLUMN so_den_so INTEGER; -- Numerical part for sorting/increment logic
