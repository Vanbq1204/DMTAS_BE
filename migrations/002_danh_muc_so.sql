-- Migration 002: Sổ văn bản và Ký hiệu văn bản

BEGIN;

-- Bảng Ký hiệu văn bản (Dùng cho sổ văn bản đi)
CREATE TABLE IF NOT EXISTS document_symbols (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    display_order INT DEFAULT 1,
    org_id INT REFERENCES organizations(id) ON DELETE CASCADE,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_document_symbols_org ON document_symbols(org_id);

-- Bảng Sổ văn bản
CREATE TABLE IF NOT EXISTS document_books (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    book_type VARCHAR(100) NOT NULL, -- incoming (Văn bản đến), outgoing (Văn bản đi), ...
    agency_id INT REFERENCES organizations(id) ON DELETE SET NULL,
    department_id INT REFERENCES organizations(id) ON DELETE SET NULL,
    current_number INT DEFAULT 1,
    auto_increment BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    org_id INT REFERENCES organizations(id) ON DELETE CASCADE,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_document_books_org ON document_books(org_id);
CREATE INDEX idx_document_books_type ON document_books(book_type);

-- Trigger auto update updated_at cho 2 bảng
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_document_symbols_modtime') THEN
        CREATE TRIGGER update_document_symbols_modtime
        BEFORE UPDATE ON document_symbols
        FOR EACH ROW EXECUTE PROCEDURE update_timestamp_column();
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_document_books_modtime') THEN
        CREATE TRIGGER update_document_books_modtime
        BEFORE UPDATE ON document_books
        FOR EACH ROW EXECUTE PROCEDURE update_timestamp_column();
    END IF;
END
$$;

COMMIT;
