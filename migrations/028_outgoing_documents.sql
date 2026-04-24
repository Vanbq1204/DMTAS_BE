-- ============================================================================
-- MIGRATION 028: outgoing_documents (Văn bản đi)
-- ============================================================================

CREATE TABLE IF NOT EXISTS outgoing_documents (
    id                      SERIAL PRIMARY KEY,

    -- Sổ văn bản đi (document_books.book_type = 'Văn bản đi')
    book_id                 INTEGER REFERENCES document_books(id) ON DELETE SET NULL,

    -- Đánh số nội bộ trong sổ (chỉ cấp khi vào sổ)
    so_di                   INTEGER,

    -- Ký hiệu (người dùng nhập, ví dụ "SKHCN")
    so_ky_hieu              VARCHAR(150),

    -- Thông tin chính
    loai_van_ban            VARCHAR(100),               -- Công văn, Quyết định...
    ngay_ban_hanh           DATE,
    cap_ban_hanh            VARCHAR(255),
    nguoi_ky_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    nguoi_ky_ten            VARCHAR(255),               -- fallback khi người ký không phải user hệ thống
    chuc_vu                 VARCHAR(150),
    don_vi_tao              VARCHAR(255),
    don_vi_soan_thao        VARCHAR(255),
    nguoi_soan_thao_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    nguoi_soan_thao_ten     VARCHAR(255),
    thoi_han                DATE,
    trich_yeu               TEXT NOT NULL,

    -- Phân loại / điều khiển phát hành
    danh_muc_ho_so_luu_tru  VARCHAR(255),
    hinh_thuc               VARCHAR(100),
    linh_vuc                VARCHAR(150),
    do_khan                 VARCHAR(30)  NOT NULL DEFAULT 'thuong',
    phuong_thuc_gui         VARCHAR(30)  NOT NULL DEFAULT 'dien_tu',
    so_trang                INTEGER,
    so_ban_luu              INTEGER,
    noi_nhan_ban_luu        TEXT,

    -- Nơi nhận
    noi_nhan_ben_ngoai      TEXT,                       -- chuỗi tự do
    noi_nhan_noi_bo         TEXT,                       -- chuỗi tự do (tách bởi dấu ;)

    -- Loại nghiệp vụ
    loai_nghiep_vu          VARCHAR(30)  NOT NULL DEFAULT 'van_ban_moi',
                                                        -- van_ban_moi | thu_hoi | thay_the | cap_nhat
    la_qppl                 BOOLEAN      NOT NULL DEFAULT FALSE,
    co_kem_ban_giay         BOOLEAN      NOT NULL DEFAULT FALSE,
    phai_tra_loi            BOOLEAN      NOT NULL DEFAULT FALSE,
    la_van_ban_tra_loi      BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Luồng trạng thái Văn thư
    trang_thai              VARCHAR(50)  NOT NULL DEFAULT 'cho_cap_ky_so',
    ly_do_tra_lai           TEXT,
    ngay_cap_so             TIMESTAMPTZ,
    gan_dau_sao             BOOLEAN      NOT NULL DEFAULT FALSE,

    is_deleted              BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Ràng buộc giá trị trạng thái (5 tab của Văn thư)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outgoing_documents_trang_thai_chk') THEN
        ALTER TABLE outgoing_documents ADD CONSTRAINT outgoing_documents_trang_thai_chk
            CHECK (trang_thai IN (
                'cho_cap_ky_so',
                'so_van_ban_di_co_quan',
                'bi_tu_choi_tiep_nhan',
                'bi_tra_lai',
                'da_tra_lai'
            ));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outgoing_documents_loai_nghiep_vu_chk') THEN
        ALTER TABLE outgoing_documents ADD CONSTRAINT outgoing_documents_loai_nghiep_vu_chk
            CHECK (loai_nghiep_vu IN ('van_ban_moi','thu_hoi','thay_the','cap_nhat'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outgoing_documents_do_khan_chk') THEN
        ALTER TABLE outgoing_documents ADD CONSTRAINT outgoing_documents_do_khan_chk
            CHECK (do_khan IN ('thuong','khan','thuong_khan'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outgoing_documents_phuong_thuc_gui_chk') THEN
        ALTER TABLE outgoing_documents ADD CONSTRAINT outgoing_documents_phuong_thuc_gui_chk
            CHECK (phuong_thuc_gui IN ('dien_tu','giay','ca_hai'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_outgoing_docs_trang_thai ON outgoing_documents(trang_thai);
CREATE INDEX IF NOT EXISTS idx_outgoing_docs_book_id    ON outgoing_documents(book_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_docs_created_by ON outgoing_documents(created_by);
CREATE INDEX IF NOT EXISTS idx_outgoing_docs_created_at ON outgoing_documents(created_at DESC);

COMMENT ON TABLE outgoing_documents IS 'Văn bản đi của Văn thư (chờ cấp ký số, vào sổ, bị từ chối/trả lại).';
