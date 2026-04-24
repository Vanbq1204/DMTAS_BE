
ALTER TABLE incoming_documents 
ADD COLUMN lanh_dao_id INTEGER REFERENCES users(id),
ADD COLUMN ghi_chu_phan_phoi TEXT;

CREATE INDEX idx_inc_doc_lanh_dao ON incoming_documents(lanh_dao_id);
