
-- Migration to increase so_den length
ALTER TABLE incoming_documents ALTER COLUMN so_den TYPE VARCHAR(50);
