const db = require('../config/db');

const ok = (res, data, message = 'Thành công', statusCode = 200) =>
    res.status(statusCode).json({ success: true, data, message });

const fail = (res, message = 'Thất bại', statusCode = 400) =>
    res.status(statusCode).json({ success: false, data: null, message });

// ─── Helper: log history ──────────────────────────────────────────────────────
const logHistory = async ({ document_id, hanh_dong, noi_dung, tu_trang_thai, den_trang_thai, thuc_hien_boi, meta }) => {
    try {
        await db.query(
            `INSERT INTO document_history
             (document_id, doc_type, hanh_dong, noi_dung, tu_trang_thai, den_trang_thai, thuc_hien_boi, thuc_hien_luc, meta)
             VALUES ($1, 'outgoing', $2, $3, $4, $5, $6, NOW(), $7)`,
            [document_id, hanh_dong, noi_dung, tu_trang_thai, den_trang_thai, thuc_hien_boi, meta || {}]
        );
    } catch (err) {
        console.warn('outgoing logHistory skipped:', err.message);
    }
};

// ─── Helper: shape row ────────────────────────────────────────────────────────
const shape = (r) => ({
    id: r.id,
    bookId: r.book_id,
    bookName: r.book_name || null,
    bookSymbol: r.book_symbol || null,
    soDi: r.so_di,
    soKyHieu: r.so_ky_hieu,
    soKyHieuFull: r.so_di && r.book_symbol ? `${r.so_di}/${r.book_symbol}` : (r.so_ky_hieu || ''),
    loaiVanBan: r.loai_van_ban,
    ngayBanHanh: r.ngay_ban_hanh,
    capBanHanh: r.cap_ban_hanh,
    nguoiKyId: r.nguoi_ky_id,
    nguoiKyTen: r.nguoi_ky_ten || r.nguoi_ky_full_name || null,
    chucVu: r.chuc_vu,
    donViTao: r.don_vi_tao,
    donViSoanThao: r.don_vi_soan_thao,
    nguoiSoanThaoId: r.nguoi_soan_thao_id,
    nguoiSoanThaoTen: r.nguoi_soan_thao_ten || r.nguoi_soan_thao_full_name || null,
    thoiHan: r.thoi_han,
    trichYeu: r.trich_yeu,
    danhMucHoSoLuuTru: r.danh_muc_ho_so_luu_tru,
    hinhThuc: r.hinh_thuc,
    linhVuc: r.linh_vuc,
    doKhan: r.do_khan,
    phuongThucGui: r.phuong_thuc_gui,
    soTrang: r.so_trang,
    soBanLuu: r.so_ban_luu,
    noiNhanBanLuu: r.noi_nhan_ban_luu,
    noiNhanBenNgoai: r.noi_nhan_ben_ngoai,
    noiNhanNoiBo: r.noi_nhan_noi_bo,
    loaiNghiepVu: r.loai_nghiep_vu,
    laQppl: r.la_qppl,
    coKemBanGiay: r.co_kem_ban_giay,
    phaiTraLoi: r.phai_tra_loi,
    laVanBanTraLoi: r.la_van_ban_tra_loi,
    trangThai: r.trang_thai,
    lyDoTraLai: r.ly_do_tra_lai,
    ngayCapSo: r.ngay_cap_so,
    ganDauSao: r.gan_dau_sao,
    createdBy: r.created_by,
    createdByName: r.created_by_full_name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    files: r.files || [],
});

// ─── Helper: fetch files cho document ────────────────────────────────────────
const fetchFiles = async (docId) => {
    const { rows } = await db.query(
        `SELECT df.id, df.ten_file, df.duong_dan, df.loai_file, df.kich_thuoc,
                df.uploaded_at, df.uploaded_by, u.full_name AS uploaded_by_name
         FROM outgoing_document_files df
         LEFT JOIN users u ON df.uploaded_by = u.id
         WHERE df.document_id = $1
         ORDER BY df.uploaded_at ASC NULLS LAST, df.id ASC`,
        [docId]
    );
    return rows.map((f) => ({
        id: f.id,
        tenFile: f.ten_file,
        duongDan: f.duong_dan,
        loaiFile: f.loai_file,
        kichThuoc: f.kich_thuoc,
        uploadedAt: f.uploaded_at,
        uploadedBy: f.uploaded_by,
        uploadedByName: f.uploaded_by_name,
    }));
};

// ─── Helper: parse boolean field gửi qua multipart/form-data ──────────────────
const parseBool = (v) => v === true || v === 'true' || v === '1' || v === 1;
const parseIntOrNull = (v) => {
    if (v === undefined || v === null || v === '' || v === 'null' || v === 'undefined') return null;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
};
const parseDateOrNull = (v) => {
    if (!v || v === 'null' || v === 'undefined') return null;
    return v;
};

// ─── Validation ───────────────────────────────────────────────────────────────
const VALID_TRANG_THAI = new Set([
    'cho_cap_ky_so',
    'so_van_ban_di_co_quan',
    'bi_tu_choi_tiep_nhan',
    'bi_tra_lai',
    'da_tra_lai',
]);
const VALID_LOAI_NGHIEP_VU = new Set(['van_ban_moi', 'thu_hoi', 'thay_the', 'cap_nhat']);
const VALID_DO_KHAN = new Set(['thuong', 'khan', 'thuong_khan']);
const VALID_PHUONG_THUC = new Set(['dien_tu', 'giay', 'ca_hai']);

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di — list
// Với tab 'bi_tu_choi_tiep_nhan' và 'bi_tra_lai': lấy từ outgoing_internal_inbox
// (mỗi người từ chối/trả lại = 1 bản sao).
// ═══════════════════════════════════════════════════════════════════════════════
const INBOX_TABS = { bi_tu_choi_tiep_nhan: 'tu_choi', bi_tra_lai: 'da_tra_lai' };

const list = async (req, res) => {
    try {
        const {
            tab = 'cho_cap_ky_so',
            search,
            page = 1,
            limit = 20,
            sort_field = 'created_at',
            sort_dir = 'desc',
        } = req.query;

        const userId = req.user?.id || null;

        // ── Helper: count cho 3 tab doc-based + 2 tab inbox-based ──
        const buildCounts = async () => {
            const counts = {
                cho_cap_ky_so: 0,
                so_van_ban_di_co_quan: 0,
                bi_tu_choi_tiep_nhan: 0,
                bi_tra_lai: 0,
                da_tra_lai: 0,
            };
            const countSql = `SELECT trang_thai, COUNT(*)::int AS cnt
                              FROM outgoing_documents WHERE is_deleted = false
                              GROUP BY trang_thai`;
            const countRes = await db.query(countSql);
            for (const r of countRes.rows) {
                if (counts.hasOwnProperty(r.trang_thai)) counts[r.trang_thai] = r.cnt;
            }
            if (userId) {
                const inboxCount = await db.query(
                    `SELECT trang_thai, COUNT(*)::int AS cnt
                     FROM outgoing_internal_inbox
                     WHERE sent_by = $1 AND hidden_for_sender = false
                       AND trang_thai IN ('tu_choi', 'da_tra_lai')
                     GROUP BY trang_thai`,
                    [userId]
                );
                for (const r of inboxCount.rows) {
                    if (r.trang_thai === 'tu_choi') counts.bi_tu_choi_tiep_nhan = r.cnt;
                    if (r.trang_thai === 'da_tra_lai') counts.bi_tra_lai = r.cnt;
                }
            }
            return counts;
        };

        // ── Tab inbox-based: bi_tu_choi_tiep_nhan | bi_tra_lai ──
        if (INBOX_TABS[tab] && userId) {
            const kind = INBOX_TABS[tab];
            const conditions = [
                'i.sent_by = $1',
                'i.trang_thai = $2',
                'i.hidden_for_sender = false',
                'd.is_deleted = false',
            ];
            const params = [userId, kind];
            let idx = 3;

            if (search && String(search).trim()) {
                conditions.push(
                    `(d.trich_yeu ILIKE $${idx} OR d.so_ky_hieu ILIKE $${idx} OR u.full_name ILIKE $${idx} OR COALESCE(i.ly_do,'') ILIKE $${idx})`
                );
                params.push(`%${search.trim()}%`);
                idx++;
            }

            const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
            const sql = `
                SELECT i.id AS inbox_id, i.trang_thai AS inbox_trang_thai, i.ly_do, i.responded_at,
                       u.id AS recipient_user_id, u.full_name AS recipient_name, u.chuc_vu AS recipient_chuc_vu,
                       d.*,
                       b.name AS book_name, b.symbol AS book_symbol,
                       uk.full_name AS nguoi_ky_full_name,
                       us.full_name AS nguoi_soan_thao_full_name,
                       uc.full_name AS created_by_full_name
                FROM outgoing_internal_inbox i
                JOIN outgoing_documents d ON d.id = i.outgoing_id
                JOIN users u ON u.id = i.user_id
                LEFT JOIN document_books b ON b.id = d.book_id
                LEFT JOIN users uk ON uk.id = d.nguoi_ky_id
                LEFT JOIN users us ON us.id = d.nguoi_soan_thao_id
                LEFT JOIN users uc ON uc.id = d.created_by
                WHERE ${conditions.join(' AND ')}
                ORDER BY i.responded_at DESC NULLS LAST, i.id DESC
                LIMIT $${idx++} OFFSET $${idx++}
            `;
            params.push(parseInt(limit, 10), offset);
            const { rows } = await db.query(sql, params);

            const counts = await buildCounts();

            const items = [];
            for (const row of rows) {
                const files = await fetchFiles(row.id);
                items.push({
                    ...shape({ ...row, files }),
                    inboxId: row.inbox_id,
                    inboxTrangThai: row.inbox_trang_thai,
                    inboxLyDo: row.ly_do,
                    inboxRespondedAt: row.responded_at,
                    recipient: {
                        id: row.recipient_user_id,
                        name: row.recipient_name,
                        chucVu: row.recipient_chuc_vu,
                    },
                });
            }

            return ok(res, { items, counts }, 'Lấy danh sách văn bản đi thành công');
        }

        // ── Tab doc-based ──
        const conditions = ['d.is_deleted = false'];
        const params = [];
        let idx = 1;

        const docTabs = new Set(['cho_cap_ky_so', 'so_van_ban_di_co_quan', 'da_tra_lai']);
        if (docTabs.has(tab)) {
            conditions.push(`d.trang_thai = $${idx++}`);
            params.push(tab);
        }

        if (search && String(search).trim()) {
            conditions.push(
                `(d.trich_yeu ILIKE $${idx} OR d.so_ky_hieu ILIKE $${idx} OR COALESCE(d.noi_nhan_noi_bo,'') ILIKE $${idx} OR COALESCE(d.noi_nhan_ben_ngoai,'') ILIKE $${idx})`
            );
            params.push(`%${search.trim()}%`);
            idx++;
        }

        const safeSortField = ['created_at', 'ngay_ban_hanh', 'so_di', 'updated_at'].includes(sort_field)
            ? sort_field
            : 'created_at';
        const safeSortDir = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const sql = `
            SELECT d.*,
                   b.name   AS book_name,
                   b.symbol AS book_symbol,
                   uk.full_name AS nguoi_ky_full_name,
                   us.full_name AS nguoi_soan_thao_full_name,
                   uc.full_name AS created_by_full_name
            FROM outgoing_documents d
            LEFT JOIN document_books b ON b.id = d.book_id
            LEFT JOIN users uk ON uk.id = d.nguoi_ky_id
            LEFT JOIN users us ON us.id = d.nguoi_soan_thao_id
            LEFT JOIN users uc ON uc.id = d.created_by
            WHERE ${conditions.join(' AND ')}
            ORDER BY d.${safeSortField} ${safeSortDir}, d.id DESC
            LIMIT $${idx++} OFFSET $${idx++}
        `;
        params.push(parseInt(limit, 10), offset);

        const { rows } = await db.query(sql, params);
        const counts = await buildCounts();

        const items = [];
        for (const row of rows) {
            const files = await fetchFiles(row.id);
            items.push(shape({ ...row, files }));
        }

        return ok(res, { items, counts }, 'Lấy danh sách văn bản đi thành công');
    } catch (err) {
        console.error('outgoingDocuments list error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/:id — detail
// ═══════════════════════════════════════════════════════════════════════════════
const detail = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return fail(res, 'ID không hợp lệ');

        const { rows } = await db.query(
            `SELECT d.*, b.name AS book_name, b.symbol AS book_symbol,
                    uk.full_name AS nguoi_ky_full_name,
                    us.full_name AS nguoi_soan_thao_full_name,
                    uc.full_name AS created_by_full_name
             FROM outgoing_documents d
             LEFT JOIN document_books b ON b.id = d.book_id
             LEFT JOIN users uk ON uk.id = d.nguoi_ky_id
             LEFT JOIN users us ON us.id = d.nguoi_soan_thao_id
             LEFT JOIN users uc ON uc.id = d.created_by
             WHERE d.id = $1 AND d.is_deleted = false`,
            [id]
        );
        if (!rows.length) return fail(res, 'Không tìm thấy văn bản đi', 404);

        const files = await fetchFiles(id);
        return ok(res, shape({ ...rows[0], files }));
    } catch (err) {
        console.error('outgoingDocuments detail error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /van-ban-di — create
// ═══════════════════════════════════════════════════════════════════════════════
const create = async (req, res) => {
    const client = await db.pool.connect();
    try {
        const b = req.body;
        const userId = req.user?.id || null;

        if (!b.trich_yeu || !String(b.trich_yeu).trim()) {
            client.release();
            return fail(res, 'Vui lòng nhập trích yếu');
        }

        const loaiNghiepVu = VALID_LOAI_NGHIEP_VU.has(b.loai_nghiep_vu) ? b.loai_nghiep_vu : 'van_ban_moi';
        const doKhan = VALID_DO_KHAN.has(b.do_khan) ? b.do_khan : 'thuong';
        const phuongThucGui = VALID_PHUONG_THUC.has(b.phuong_thuc_gui) ? b.phuong_thuc_gui : 'dien_tu';

        const files = req.files
            ? req.files.map((f) => {
                let name = f.originalname;
                try {
                    if (/[ÃÂÊÔ]/.test(name) === false && /[\u00C0-\u00FF]/.test(name)) {
                        name = Buffer.from(f.originalname, 'latin1').toString('utf8');
                    }
                } catch (_) {}
                return {
                    ten_file: name,
                    duong_dan: f.filename,
                    loai_file: (name.split('.').pop() || '').toLowerCase(),
                    kich_thuoc: f.size,
                };
            })
            : [];

        await client.query('BEGIN');

        // Tự cấp số đi ngay khi lưu (vào "Sổ văn bản đi cơ quan")
        const bookId = parseIntOrNull(b.book_id);
        let soDi = null;
        if (bookId) {
            const bookRes = await client.query(
                `SELECT current_number FROM document_books WHERE id = $1 FOR UPDATE`,
                [bookId]
            );
            soDi = ((bookRes.rows[0]?.current_number) || 0) + 1;
            await client.query(
                `UPDATE document_books SET current_number = GREATEST(current_number, $1) WHERE id = $2`,
                [soDi, bookId]
            );
        }

        const insertRes = await client.query(
            `INSERT INTO outgoing_documents (
                book_id, so_di, so_ky_hieu, loai_van_ban, ngay_ban_hanh, cap_ban_hanh,
                nguoi_ky_id, nguoi_ky_ten, chuc_vu,
                don_vi_tao, don_vi_soan_thao, nguoi_soan_thao_id, nguoi_soan_thao_ten,
                thoi_han, trich_yeu, danh_muc_ho_so_luu_tru,
                hinh_thuc, linh_vuc, do_khan, phuong_thuc_gui,
                so_trang, so_ban_luu, noi_nhan_ban_luu,
                noi_nhan_ben_ngoai, noi_nhan_noi_bo,
                loai_nghiep_vu, la_qppl, co_kem_ban_giay, phai_tra_loi, la_van_ban_tra_loi,
                trang_thai, ngay_cap_so, created_by, created_at, updated_at
             )
             VALUES (
                $1,  $2,  $3,  $4,  $5,  $6,
                $7,  $8,  $9,
                $10, $11, $12, $13,
                $14, $15, $16,
                $17, $18, $19, $20,
                $21, $22, $23,
                $24, $25,
                $26, $27, $28, $29, $30,
                'so_van_ban_di_co_quan', NOW(), $31, NOW(), NOW()
             )
             RETURNING id`,
            [
                bookId,
                soDi,
                b.so_ky_hieu || null,
                b.loai_van_ban || null,
                parseDateOrNull(b.ngay_ban_hanh),
                b.cap_ban_hanh || null,
                parseIntOrNull(b.nguoi_ky_id),
                b.nguoi_ky_ten || null,
                b.chuc_vu || null,
                b.don_vi_tao || null,
                b.don_vi_soan_thao || null,
                parseIntOrNull(b.nguoi_soan_thao_id),
                b.nguoi_soan_thao_ten || null,
                parseDateOrNull(b.thoi_han),
                String(b.trich_yeu).trim(),
                b.danh_muc_ho_so_luu_tru || null,
                b.hinh_thuc || null,
                b.linh_vuc || null,
                doKhan,
                phuongThucGui,
                parseIntOrNull(b.so_trang),
                parseIntOrNull(b.so_ban_luu),
                b.noi_nhan_ban_luu || null,
                b.noi_nhan_ben_ngoai || null,
                b.noi_nhan_noi_bo || null,
                loaiNghiepVu,
                parseBool(b.la_qppl),
                parseBool(b.co_kem_ban_giay),
                parseBool(b.phai_tra_loi),
                parseBool(b.la_van_ban_tra_loi),
                userId,
            ]
        );

        const docId = insertRes.rows[0].id;

        for (const f of files) {
            await client.query(
                `INSERT INTO outgoing_document_files (document_id, ten_file, duong_dan, loai_file, kich_thuoc, uploaded_by, uploaded_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [docId, f.ten_file, f.duong_dan, f.loai_file, f.kich_thuoc, userId]
            );
        }

        await client.query('COMMIT');

        await logHistory({
            document_id: docId,
            hanh_dong: 'TAO_MOI',
            noi_dung: `Tạo mới văn bản đi${soDi ? ` (Số đi: ${soDi})` : ''}: ${b.so_ky_hieu || ''} - ${String(b.trich_yeu).trim()}`,
            den_trang_thai: 'so_van_ban_di_co_quan',
            thuc_hien_boi: userId,
        });

        return ok(res, { id: docId, so_di: soDi }, 'Tạo văn bản đi thành công', 201);
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('outgoingDocuments create error:', err);
        return fail(res, 'Lỗi server', 500);
    } finally {
        client.release();
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /van-ban-di/:id — update
// ═══════════════════════════════════════════════════════════════════════════════
const update = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return fail(res, 'ID không hợp lệ');

        const existing = await db.query(
            `SELECT trang_thai FROM outgoing_documents WHERE id = $1 AND is_deleted = false`,
            [id]
        );
        if (!existing.rows.length) return fail(res, 'Không tìm thấy văn bản đi', 404);

        const b = req.body;
        const userId = req.user?.id || null;

        const loaiNghiepVu = VALID_LOAI_NGHIEP_VU.has(b.loai_nghiep_vu) ? b.loai_nghiep_vu : 'van_ban_moi';
        const doKhan = VALID_DO_KHAN.has(b.do_khan) ? b.do_khan : 'thuong';
        const phuongThucGui = VALID_PHUONG_THUC.has(b.phuong_thuc_gui) ? b.phuong_thuc_gui : 'dien_tu';

        await db.query(
            `UPDATE outgoing_documents SET
                book_id = $1, so_ky_hieu = $2, loai_van_ban = $3, ngay_ban_hanh = $4, cap_ban_hanh = $5,
                nguoi_ky_id = $6, nguoi_ky_ten = $7, chuc_vu = $8,
                don_vi_tao = $9, don_vi_soan_thao = $10, nguoi_soan_thao_id = $11, nguoi_soan_thao_ten = $12,
                thoi_han = $13, trich_yeu = $14, danh_muc_ho_so_luu_tru = $15,
                hinh_thuc = $16, linh_vuc = $17, do_khan = $18, phuong_thuc_gui = $19,
                so_trang = $20, so_ban_luu = $21, noi_nhan_ban_luu = $22,
                noi_nhan_ben_ngoai = $23, noi_nhan_noi_bo = $24,
                loai_nghiep_vu = $25, la_qppl = $26, co_kem_ban_giay = $27, phai_tra_loi = $28, la_van_ban_tra_loi = $29,
                updated_at = NOW()
             WHERE id = $30`,
            [
                parseIntOrNull(b.book_id),
                b.so_ky_hieu || null,
                b.loai_van_ban || null,
                parseDateOrNull(b.ngay_ban_hanh),
                b.cap_ban_hanh || null,
                parseIntOrNull(b.nguoi_ky_id),
                b.nguoi_ky_ten || null,
                b.chuc_vu || null,
                b.don_vi_tao || null,
                b.don_vi_soan_thao || null,
                parseIntOrNull(b.nguoi_soan_thao_id),
                b.nguoi_soan_thao_ten || null,
                parseDateOrNull(b.thoi_han),
                String(b.trich_yeu || '').trim(),
                b.danh_muc_ho_so_luu_tru || null,
                b.hinh_thuc || null,
                b.linh_vuc || null,
                doKhan,
                phuongThucGui,
                parseIntOrNull(b.so_trang),
                parseIntOrNull(b.so_ban_luu),
                b.noi_nhan_ban_luu || null,
                b.noi_nhan_ben_ngoai || null,
                b.noi_nhan_noi_bo || null,
                loaiNghiepVu,
                parseBool(b.la_qppl),
                parseBool(b.co_kem_ban_giay),
                parseBool(b.phai_tra_loi),
                parseBool(b.la_van_ban_tra_loi),
                id,
            ]
        );

        // Append new files if any
        if (req.files && req.files.length) {
            for (const f of req.files) {
                let name = f.originalname;
                try {
                    if (/[ÃÂÊÔ]/.test(name) === false && /[\u00C0-\u00FF]/.test(name)) {
                        name = Buffer.from(f.originalname, 'latin1').toString('utf8');
                    }
                } catch (_) {}
                await db.query(
                    `INSERT INTO outgoing_document_files (document_id, ten_file, duong_dan, loai_file, kich_thuoc, uploaded_by, uploaded_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                    [id, name, f.filename, (name.split('.').pop() || '').toLowerCase(), f.size, userId]
                );
            }
        }

        // Xoá file được yêu cầu xoá (deleted_file_ids = "1,2,3")
        const deletedIds = String(b.deleted_file_ids || '').split(',').map((s) => parseInt(s, 10)).filter(Boolean);
        if (deletedIds.length) {
            await db.query(
                `DELETE FROM outgoing_document_files WHERE document_id = $1 AND id = ANY($2::int[])`,
                [id, deletedIds]
            );
        }

        await logHistory({
            document_id: id,
            hanh_dong: 'CAP_NHAT',
            noi_dung: `Cập nhật văn bản đi #${id}`,
            thuc_hien_boi: userId,
        });

        return ok(res, { id }, 'Cập nhật văn bản đi thành công');
    } catch (err) {
        console.error('outgoingDocuments update error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /van-ban-di/:id — soft delete
// ═══════════════════════════════════════════════════════════════════════════════
const destroy = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return fail(res, 'ID không hợp lệ');

        await db.query(
            `UPDATE outgoing_documents SET is_deleted = true, updated_at = NOW() WHERE id = $1`,
            [id]
        );

        await logHistory({
            document_id: id,
            hanh_dong: 'XOA',
            noi_dung: `Xoá văn bản đi #${id}`,
            thuc_hien_boi: req.user?.id || null,
        });

        return ok(res, { id }, 'Đã xoá văn bản đi');
    } catch (err) {
        console.error('outgoingDocuments destroy error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /van-ban-di/:id/trang-thai — đổi trạng thái thủ công (vào sổ, trả lại, v.v.)
// ═══════════════════════════════════════════════════════════════════════════════
const changeStatus = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { trang_thai, ly_do } = req.body;
        if (!id) return fail(res, 'ID không hợp lệ');
        if (!VALID_TRANG_THAI.has(trang_thai)) return fail(res, 'Trạng thái không hợp lệ');

        const cur = await db.query(
            `SELECT trang_thai, book_id, so_di FROM outgoing_documents WHERE id = $1 AND is_deleted = false`,
            [id]
        );
        if (!cur.rows.length) return fail(res, 'Không tìm thấy văn bản đi', 404);
        const old = cur.rows[0];

        // Nếu chuyển sang "so_van_ban_di_co_quan" → cấp số đi
        let soDi = old.so_di;
        if (trang_thai === 'so_van_ban_di_co_quan' && !old.so_di && old.book_id) {
            const bookRes = await db.query(
                `SELECT current_number FROM document_books WHERE id = $1 FOR UPDATE`,
                [old.book_id]
            );
            soDi = ((bookRes.rows[0]?.current_number) || 0) + 1;
            await db.query(
                `UPDATE document_books SET current_number = GREATEST(current_number, $1) WHERE id = $2`,
                [soDi, old.book_id]
            );
        }

        await db.query(
            `UPDATE outgoing_documents SET trang_thai = $1,
                ly_do_tra_lai = COALESCE($2, ly_do_tra_lai),
                so_di = COALESCE($3, so_di),
                ngay_cap_so = CASE WHEN $1 = 'so_van_ban_di_co_quan' AND ngay_cap_so IS NULL THEN NOW() ELSE ngay_cap_so END,
                updated_at = NOW()
             WHERE id = $4`,
            [trang_thai, ly_do || null, soDi, id]
        );

        await logHistory({
            document_id: id,
            hanh_dong: 'DOI_TRANG_THAI',
            noi_dung: ly_do ? `Đổi trạng thái: ${ly_do}` : `Đổi trạng thái → ${trang_thai}`,
            tu_trang_thai: old.trang_thai,
            den_trang_thai: trang_thai,
            thuc_hien_boi: req.user?.id || null,
        });

        return ok(res, { id, trang_thai, so_di: soDi }, 'Cập nhật trạng thái thành công');
    } catch (err) {
        console.error('outgoingDocuments changeStatus error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /so-van-ban-di — danh sách sổ văn bản đi (book_type = 'Văn bản đi')
// ═══════════════════════════════════════════════════════════════════════════════
const getBooks = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, name, symbol, current_number
             FROM document_books
             WHERE book_type = 'Văn bản đi'
             ORDER BY name ASC`
        );
        return ok(res, rows);
    } catch (err) {
        console.error('outgoingDocuments getBooks error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/nguoi-ky — Người ký (chỉ role = lanh_dao)
// ═══════════════════════════════════════════════════════════════════════════════
const getSigners = async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const params = [];
        let whereExtra = '';
        if (search) {
            params.push(`%${search}%`);
            whereExtra = ` AND (u.full_name ILIKE $${params.length} OR COALESCE(up.title,'') ILIKE $${params.length})`;
        }
        const { rows } = await db.query(
            `SELECT DISTINCT u.id, u.full_name, u.role, up.title AS chuc_vu, u.chuc_vu AS chuc_vu_user
             FROM users u
             LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
             WHERE u.role = 'lanh_dao' AND u.is_active = true
             ${whereExtra}
             ORDER BY u.full_name ASC
             LIMIT 50`,
            params
        );
        // fallback chuc_vu nếu user_positions.title trống
        const mapped = rows.map((r) => ({
            id: r.id,
            full_name: r.full_name,
            role: r.role,
            chuc_vu: r.chuc_vu || r.chuc_vu_user || null,
        }));
        return ok(res, mapped);
    } catch (err) {
        console.error('outgoingDocuments getSigners error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/don-vi — Danh sách đơn vị soạn thảo (từ organizations)
//   Loại trừ cấp 1 (trường) để tránh chọn "Đại học Kinh tế Quốc dân" làm đơn vị soạn thảo.
// ═══════════════════════════════════════════════════════════════════════════════
const getOrganizations = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT o.id, o.parent_id, o.code, o.type, o.level,
                    un.name, po_un.name AS parent_name
             FROM organizations o
             JOIN org_unit_names un ON un.id = o.name_id
             LEFT JOIN organizations po ON po.id = o.parent_id
             LEFT JOIN org_unit_names po_un ON po_un.id = po.name_id
             WHERE o.is_active IS DISTINCT FROM false AND o.level >= 2
             ORDER BY o.level ASC, un.name ASC`
        );
        return ok(res, rows);
    } catch (err) {
        console.error('outgoingDocuments getOrganizations error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/users — Tìm kiếm người nhận nội bộ (dùng cho Nơi nhận > Cá nhân)
// ═══════════════════════════════════════════════════════════════════════════════
const searchInternalUsers = async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const params = [];
        let whereExtra = '';
        if (search) {
            params.push(`%${search}%`);
            whereExtra = ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
        }
        const { rows } = await db.query(
            `SELECT DISTINCT u.id, u.full_name, u.email, u.role,
                    COALESCE(up.title, u.chuc_vu) AS chuc_vu,
                    un.name AS org_name
             FROM users u
             LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
             LEFT JOIN organizations o ON o.id = up.org_id
             LEFT JOIN org_unit_names un ON un.id = o.name_id
             WHERE u.is_active = true ${whereExtra}
             ORDER BY u.full_name ASC
             LIMIT 50`,
            params
        );
        return ok(res, rows);
    } catch (err) {
        console.error('outgoingDocuments searchInternalUsers error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/:id/noi-nhan — Lấy danh sách người nhận nội bộ đã lưu
// ═══════════════════════════════════════════════════════════════════════════════
const getRecipients = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return fail(res, 'ID không hợp lệ');

        // users
        const userRows = await db.query(
            `SELECT r.recipient_id AS id, u.full_name, u.email,
                    un.name AS org_name,
                    COALESCE(up.title, u.chuc_vu) AS chuc_vu
             FROM outgoing_internal_recipients r
             JOIN users u ON u.id = r.recipient_id
             LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
             LEFT JOIN organizations o ON o.id = up.org_id
             LEFT JOIN org_unit_names un ON un.id = o.name_id
             WHERE r.outgoing_id = $1 AND r.recipient_type = 'user'
             ORDER BY u.full_name ASC`,
            [id]
        );

        // orgs
        const orgRows = await db.query(
            `SELECT r.recipient_id AS id, un.name, o.code
             FROM outgoing_internal_recipients r
             JOIN organizations o ON o.id = r.recipient_id
             LEFT JOIN org_unit_names un ON un.id = o.name_id
             WHERE r.outgoing_id = $1 AND r.recipient_type = 'org'
             ORDER BY un.name ASC`,
            [id]
        );

        // doc metadata
        const docRow = await db.query(
            `SELECT noi_nhan_ben_ngoai FROM outgoing_documents WHERE id = $1`,
            [id]
        );

        return ok(res, {
            users: userRows.rows,
            orgs: orgRows.rows,
            noi_nhan_ben_ngoai: docRow.rows[0]?.noi_nhan_ben_ngoai || '',
        });
    } catch (err) {
        console.error('outgoingDocuments getRecipients error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /van-ban-di/:id/gui-noi-bo — Gửi văn bản đi tới người nhận nội bộ
//   Body: { user_ids: [..], org_ids: [..], noi_nhan_ben_ngoai?: string }
// ═══════════════════════════════════════════════════════════════════════════════
const guiNoiBo = async (req, res) => {
    const client = await db.pool.connect();
    try {
        const id = parseInt(req.params.id, 10);
        const userId = req.user?.id || null;
        if (!id) return fail(res, 'ID không hợp lệ');

        const userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids.map(Number).filter(Boolean) : [];
        const orgIds  = Array.isArray(req.body.org_ids)  ? req.body.org_ids.map(Number).filter(Boolean)  : [];
        const ngoai   = typeof req.body.noi_nhan_ben_ngoai === 'string' ? req.body.noi_nhan_ben_ngoai : null;

        if (!userIds.length && !orgIds.length) {
            return fail(res, 'Chưa chọn người nhận nội bộ (cá nhân hoặc phòng ban)');
        }

        await client.query('BEGIN');

        const docRes = await client.query(
            `SELECT trang_thai FROM outgoing_documents WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (!docRes.rows.length) {
            await client.query('ROLLBACK');
            return fail(res, 'Không tìm thấy văn bản đi', 404);
        }
        const oldStatus = docRes.rows[0].trang_thai;

        // Xoá recipients cũ để ghi lại (trường hợp gửi lại)
        await client.query(`DELETE FROM outgoing_internal_recipients WHERE outgoing_id = $1`, [id]);

        // Lưu recipients: users
        for (const uid of userIds) {
            const u = await client.query(`SELECT full_name FROM users WHERE id = $1`, [uid]);
            const name = u.rows[0]?.full_name || null;
            await client.query(
                `INSERT INTO outgoing_internal_recipients (outgoing_id, recipient_type, recipient_id, recipient_name, created_by)
                 VALUES ($1, 'user', $2, $3, $4)
                 ON CONFLICT (outgoing_id, recipient_type, recipient_id) DO NOTHING`,
                [id, uid, name, userId]
            );
        }
        // Lưu recipients: orgs
        for (const oid of orgIds) {
            const o = await client.query(
                `SELECT un.name FROM organizations o LEFT JOIN org_unit_names un ON un.id = o.name_id WHERE o.id = $1`,
                [oid]
            );
            const name = o.rows[0]?.name || null;
            await client.query(
                `INSERT INTO outgoing_internal_recipients (outgoing_id, recipient_type, recipient_id, recipient_name, created_by)
                 VALUES ($1, 'org', $2, $3, $4)
                 ON CONFLICT (outgoing_id, recipient_type, recipient_id) DO NOTHING`,
                [id, oid, name, userId]
            );
        }

        // Fan-out inbox
        // 1) users trực tiếp
        for (const uid of userIds) {
            await client.query(
                `INSERT INTO outgoing_internal_inbox (outgoing_id, user_id, via_type, via_ref_id, sent_by, sent_at)
                 VALUES ($1, $2, 'user', NULL, $3, NOW())
                 ON CONFLICT (outgoing_id, user_id) DO NOTHING`,
                [id, uid, userId]
            );
        }
        // 2) users trong org (trừ chính user gửi để tránh loop)
        if (orgIds.length) {
            await client.query(
                `INSERT INTO outgoing_internal_inbox (outgoing_id, user_id, via_type, via_ref_id, sent_by, sent_at)
                 SELECT $1, up.user_id, 'org', up.org_id, $2, NOW()
                 FROM user_positions up
                 JOIN users u ON u.id = up.user_id
                 WHERE up.org_id = ANY($3::int[]) AND u.is_active = true
                 ON CONFLICT (outgoing_id, user_id) DO NOTHING`,
                [id, userId, orgIds]
            );
        }

        // Tổng hợp noi_nhan_noi_bo dạng text cho cột list
        const nameRes = await client.query(
            `SELECT recipient_name FROM outgoing_internal_recipients WHERE outgoing_id = $1 ORDER BY recipient_type, id`,
            [id]
        );
        const joinedNames = nameRes.rows.map((r) => r.recipient_name).filter(Boolean).join('; ');

        // Giữ nguyên trang_thai (ở sổ văn bản đi), chỉ cập nhật nội dung nơi nhận
        await client.query(
            `UPDATE outgoing_documents
             SET noi_nhan_noi_bo = $1,
                 noi_nhan_ben_ngoai = COALESCE($2, noi_nhan_ben_ngoai),
                 updated_at = NOW()
             WHERE id = $3`,
            [joinedNames, ngoai, id]
        );

        await client.query('COMMIT');

        await logHistory({
            document_id: id,
            hanh_dong: 'GUI_NOI_BO',
            noi_dung: `Gửi nội bộ tới ${userIds.length} cá nhân và ${orgIds.length} phòng ban`,
            tu_trang_thai: oldStatus,
            den_trang_thai: oldStatus,
            thuc_hien_boi: userId,
        });

        return ok(res, {
            id,
            user_count: userIds.length,
            org_count: orgIds.length,
        }, 'Đã gửi nội bộ thành công');
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('outgoingDocuments guiNoiBo error:', err);
        return fail(res, 'Lỗi server', 500);
    } finally {
        client.release();
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-noi-bo-tiep-nhan — Hộp thư tiếp nhận nội bộ (user hiện tại)
// ═══════════════════════════════════════════════════════════════════════════════
const listInternalInbox = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return fail(res, 'Chưa đăng nhập', 401);

        const {
            search,
            page = 1,
            limit = 20,
        } = req.query;

        const conditions = ['i.user_id = $1', 'd.is_deleted = false'];
        const params = [userId];
        let idx = 2;

        if (search && String(search).trim()) {
            conditions.push(
                `(d.trich_yeu ILIKE $${idx} OR d.so_ky_hieu ILIKE $${idx} OR COALESCE(d.nguoi_ky_ten,'') ILIKE $${idx})`
            );
            params.push(`%${search.trim()}%`);
            idx++;
        }

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        const sql = `
            SELECT i.id AS inbox_id, i.trang_thai AS inbox_trang_thai,
                   i.via_type, i.via_ref_id, i.sent_at, i.read_at,
                   sb.full_name AS sent_by_name,
                   un.name AS via_org_name,
                   d.id AS document_id,
                   d.book_id, d.so_di, d.so_ky_hieu, d.loai_van_ban,
                   d.ngay_ban_hanh, d.cap_ban_hanh,
                   d.nguoi_ky_id, d.nguoi_ky_ten, d.chuc_vu,
                   d.don_vi_tao, d.don_vi_soan_thao,
                   d.nguoi_soan_thao_id, d.nguoi_soan_thao_ten,
                   d.thoi_han, d.trich_yeu, d.danh_muc_ho_so_luu_tru,
                   d.hinh_thuc, d.linh_vuc, d.do_khan, d.phuong_thuc_gui,
                   d.so_trang, d.so_ban_luu, d.noi_nhan_ban_luu,
                   d.noi_nhan_ben_ngoai, d.noi_nhan_noi_bo,
                   d.loai_nghiep_vu, d.la_qppl, d.co_kem_ban_giay,
                   d.phai_tra_loi, d.la_van_ban_tra_loi,
                   d.trang_thai, d.ly_do_tra_lai, d.ngay_cap_so,
                   d.gan_dau_sao, d.created_by, d.created_at, d.updated_at,
                   b.name AS book_name, b.symbol AS book_symbol,
                   uk.full_name AS nguoi_ky_full_name,
                   us.full_name AS nguoi_soan_thao_full_name,
                   uc.full_name AS created_by_full_name
            FROM outgoing_internal_inbox i
            JOIN outgoing_documents d ON d.id = i.outgoing_id
            LEFT JOIN users sb ON sb.id = i.sent_by
            LEFT JOIN document_books b ON b.id = d.book_id
            LEFT JOIN users uk ON uk.id = d.nguoi_ky_id
            LEFT JOIN users us ON us.id = d.nguoi_soan_thao_id
            LEFT JOIN users uc ON uc.id = d.created_by
            LEFT JOIN organizations o ON o.id = i.via_ref_id AND i.via_type = 'org'
            LEFT JOIN org_unit_names un ON un.id = o.name_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY i.sent_at DESC, i.id DESC
            LIMIT $${idx++} OFFSET $${idx++}
        `;
        params.push(parseInt(limit, 10), offset);

        const { rows } = await db.query(sql, params);

        const countRes = await db.query(
            `SELECT COUNT(*)::int AS cnt,
                    SUM(CASE WHEN i.trang_thai = 'chua_doc' THEN 1 ELSE 0 END)::int AS unread
             FROM outgoing_internal_inbox i
             JOIN outgoing_documents d ON d.id = i.outgoing_id
             WHERE i.user_id = $1 AND d.is_deleted = false`,
            [userId]
        );

        const items = [];
        for (const row of rows) {
            const files = await fetchFiles(row.document_id);
            items.push({
                inboxId: row.inbox_id,
                inboxTrangThai: row.inbox_trang_thai,
                viaType: row.via_type,
                viaRefId: row.via_ref_id,
                viaOrgName: row.via_org_name,
                sentAt: row.sent_at,
                readAt: row.read_at,
                sentByName: row.sent_by_name,
                ...shape({ ...row, id: row.document_id, files }),
            });
        }

        return ok(res, {
            items,
            total: countRes.rows[0]?.cnt || 0,
            unread: countRes.rows[0]?.unread || 0,
        });
    } catch (err) {
        console.error('outgoingDocuments listInternalInbox error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /van-ban-noi-bo-tiep-nhan/:inboxId/da-doc — đánh dấu đã đọc (không đổi logic
// tiếp nhận; chỉ dùng lúc mở xem preview nhanh).
// ═══════════════════════════════════════════════════════════════════════════════
const markInboxAsRead = async (req, res) => {
    try {
        const inboxId = parseInt(req.params.inboxId, 10);
        const userId = req.user?.id;
        if (!inboxId) return fail(res, 'ID không hợp lệ');

        await db.query(
            `UPDATE outgoing_internal_inbox
             SET trang_thai = CASE WHEN trang_thai = 'chua_doc' THEN 'da_doc' ELSE trang_thai END,
                 read_at    = COALESCE(read_at, NOW())
             WHERE id = $1 AND user_id = $2`,
            [inboxId, userId]
        );

        return ok(res, { id: inboxId }, 'Đã đánh dấu đã đọc');
    } catch (err) {
        console.error('outgoingDocuments markInboxAsRead error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /van-ban-noi-bo-tiep-nhan/:inboxId/tiep-nhan — người nhận tiếp nhận VB
// ═══════════════════════════════════════════════════════════════════════════════
const tiepNhanInbox = async (req, res) => {
    try {
        const inboxId = parseInt(req.params.inboxId, 10);
        const userId = req.user?.id;
        if (!inboxId) return fail(res, 'ID không hợp lệ');

        const check = await db.query(
            `SELECT trang_thai, outgoing_id FROM outgoing_internal_inbox WHERE id = $1 AND user_id = $2`,
            [inboxId, userId]
        );
        if (!check.rows.length) return fail(res, 'Không tìm thấy văn bản trong hộp thư', 404);
        if (['tu_choi', 'da_tra_lai'].includes(check.rows[0].trang_thai)) {
            return fail(res, 'Văn bản đã được từ chối/trả lại, không thể tiếp nhận.');
        }

        await db.query(
            `UPDATE outgoing_internal_inbox
             SET trang_thai   = 'da_tiep_nhan',
                 responded_at = NOW(),
                 read_at      = COALESCE(read_at, NOW())
             WHERE id = $1 AND user_id = $2`,
            [inboxId, userId]
        );

        await logHistory({
            document_id: check.rows[0].outgoing_id,
            hanh_dong: 'TIEP_NHAN_NOI_BO',
            noi_dung: 'Người nhận đã tiếp nhận văn bản nội bộ',
            thuc_hien_boi: userId,
        });

        return ok(res, { id: inboxId }, 'Đã tiếp nhận văn bản');
    } catch (err) {
        console.error('outgoingDocuments tiepNhanInbox error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /van-ban-noi-bo-tiep-nhan/:inboxId/tu-choi — người nhận từ chối tiếp nhận
//   Body: { ly_do: string }
// ═══════════════════════════════════════════════════════════════════════════════
const tuChoiInbox = async (req, res) => {
    try {
        const inboxId = parseInt(req.params.inboxId, 10);
        const userId = req.user?.id;
        const lyDo = (req.body?.ly_do || '').trim();
        if (!inboxId) return fail(res, 'ID không hợp lệ');
        if (!lyDo) return fail(res, 'Vui lòng nhập lý do từ chối');

        const check = await db.query(
            `SELECT trang_thai, outgoing_id FROM outgoing_internal_inbox WHERE id = $1 AND user_id = $2`,
            [inboxId, userId]
        );
        if (!check.rows.length) return fail(res, 'Không tìm thấy văn bản trong hộp thư', 404);
        if (['da_tiep_nhan', 'da_tra_lai'].includes(check.rows[0].trang_thai)) {
            return fail(res, 'Văn bản đã được tiếp nhận/trả lại, không thể từ chối.');
        }

        await db.query(
            `UPDATE outgoing_internal_inbox
             SET trang_thai        = 'tu_choi',
                 ly_do             = $3,
                 responded_at      = NOW(),
                 hidden_for_sender = false
             WHERE id = $1 AND user_id = $2`,
            [inboxId, userId, lyDo]
        );

        await logHistory({
            document_id: check.rows[0].outgoing_id,
            hanh_dong: 'TU_CHOI_TIEP_NHAN',
            noi_dung: `Người nhận từ chối tiếp nhận. Lý do: ${lyDo}`,
            thuc_hien_boi: userId,
        });

        return ok(res, { id: inboxId }, 'Đã từ chối tiếp nhận');
    } catch (err) {
        console.error('outgoingDocuments tuChoiInbox error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// POST /van-ban-noi-bo-tiep-nhan/:inboxId/tra-lai — người nhận trả lại VB (sau khi
// đã tiếp nhận, xem xong, muốn trả về người gửi).
//   Body: { ly_do: string }
// ═══════════════════════════════════════════════════════════════════════════════
const traLaiInbox = async (req, res) => {
    try {
        const inboxId = parseInt(req.params.inboxId, 10);
        const userId = req.user?.id;
        const lyDo = (req.body?.ly_do || '').trim();
        if (!inboxId) return fail(res, 'ID không hợp lệ');
        if (!lyDo) return fail(res, 'Vui lòng nhập lý do trả lại');

        const check = await db.query(
            `SELECT trang_thai, outgoing_id FROM outgoing_internal_inbox WHERE id = $1 AND user_id = $2`,
            [inboxId, userId]
        );
        if (!check.rows.length) return fail(res, 'Không tìm thấy văn bản trong hộp thư', 404);
        if (check.rows[0].trang_thai !== 'da_tiep_nhan') {
            return fail(res, 'Chỉ có thể trả lại sau khi đã tiếp nhận.');
        }

        await db.query(
            `UPDATE outgoing_internal_inbox
             SET trang_thai        = 'da_tra_lai',
                 ly_do             = $3,
                 responded_at      = NOW(),
                 hidden_for_sender = false
             WHERE id = $1 AND user_id = $2`,
            [inboxId, userId, lyDo]
        );

        await logHistory({
            document_id: check.rows[0].outgoing_id,
            hanh_dong: 'TRA_LAI_VAN_BAN',
            noi_dung: `Người nhận trả lại văn bản. Lý do: ${lyDo}`,
            thuc_hien_boi: userId,
        });

        return ok(res, { id: inboxId }, 'Đã trả lại văn bản');
    } catch (err) {
        console.error('outgoingDocuments traLaiInbox error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /van-ban-di/inbox-notification/:inboxId — văn thư/người gửi ẩn thông báo
// bị từ chối / bị trả lại khỏi tab của mình.
// ═══════════════════════════════════════════════════════════════════════════════
const hideInboxNotification = async (req, res) => {
    try {
        const inboxId = parseInt(req.params.inboxId, 10);
        const userId = req.user?.id;
        if (!inboxId) return fail(res, 'ID không hợp lệ');

        const result = await db.query(
            `UPDATE outgoing_internal_inbox
             SET hidden_for_sender = true
             WHERE id = $1 AND sent_by = $2 AND trang_thai IN ('tu_choi', 'da_tra_lai')
             RETURNING id`,
            [inboxId, userId]
        );
        if (!result.rows.length) return fail(res, 'Không tìm thấy thông báo hoặc không có quyền xoá', 404);

        return ok(res, { id: inboxId }, 'Đã xoá thông báo khỏi tab');
    } catch (err) {
        console.error('outgoingDocuments hideInboxNotification error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/:id/tinh-trang-tiep-nhan — danh sách người nhận + trạng thái
// tiếp nhận (cho người gửi xem ai đã tiếp nhận / từ chối / chưa xem).
// ═══════════════════════════════════════════════════════════════════════════════
const getRecipientStatus = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return fail(res, 'ID không hợp lệ');

        const { rows } = await db.query(
            `SELECT i.id AS inbox_id, i.trang_thai, i.via_type, i.via_ref_id,
                    i.sent_at, i.read_at, i.responded_at, i.ly_do,
                    u.id AS user_id, u.full_name, u.email, u.chuc_vu,
                    un.name AS via_org_name
             FROM outgoing_internal_inbox i
             JOIN users u ON u.id = i.user_id
             LEFT JOIN organizations o ON o.id = i.via_ref_id AND i.via_type = 'org'
             LEFT JOIN org_unit_names un ON un.id = o.name_id
             WHERE i.outgoing_id = $1
             ORDER BY
                CASE i.trang_thai
                    WHEN 'tu_choi' THEN 1
                    WHEN 'da_tra_lai' THEN 2
                    WHEN 'da_tiep_nhan' THEN 3
                    WHEN 'da_doc' THEN 4
                    WHEN 'chua_doc' THEN 5
                    ELSE 6 END,
                i.sent_at DESC`,
            [id]
        );

        const items = rows.map((r) => ({
            inboxId: r.inbox_id,
            userId: r.user_id,
            userName: r.full_name,
            email: r.email,
            chucVu: r.chuc_vu,
            viaType: r.via_type,
            viaOrgName: r.via_org_name,
            trangThai: r.trang_thai,    // chua_doc | da_doc | da_tiep_nhan | tu_choi | da_tra_lai
            sentAt: r.sent_at,
            readAt: r.read_at,
            respondedAt: r.responded_at,
            lyDo: r.ly_do,
        }));

        // summary
        const summary = {
            total: items.length,
            chua_xem: items.filter((x) => x.trangThai === 'chua_doc').length,
            da_xem: items.filter((x) => x.trangThai === 'da_doc').length,
            da_tiep_nhan: items.filter((x) => x.trangThai === 'da_tiep_nhan').length,
            tu_choi: items.filter((x) => x.trangThai === 'tu_choi').length,
            da_tra_lai: items.filter((x) => x.trangThai === 'da_tra_lai').length,
        };

        return ok(res, { items, summary });
    } catch (err) {
        console.error('outgoingDocuments getRecipientStatus error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/notifications — tab "Bị từ chối" / "Bị trả lại" cho văn thư
//   Query: { kind: 'tu_choi' | 'da_tra_lai', search?, page?, limit? }
//   Mỗi người từ chối/trả lại = 1 bản sao (row).
// ═══════════════════════════════════════════════════════════════════════════════
const listSenderNotifications = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return fail(res, 'Chưa đăng nhập', 401);

        const kind = req.query.kind === 'da_tra_lai' ? 'da_tra_lai' : 'tu_choi';
        const { search, page = 1, limit = 20 } = req.query;

        const conditions = [
            'i.sent_by = $1',
            'i.trang_thai = $2',
            'i.hidden_for_sender = false',
            'd.is_deleted = false',
        ];
        const params = [userId, kind];
        let idx = 3;

        if (search && String(search).trim()) {
            conditions.push(
                `(d.trich_yeu ILIKE $${idx} OR d.so_ky_hieu ILIKE $${idx} OR u.full_name ILIKE $${idx} OR COALESCE(i.ly_do,'') ILIKE $${idx})`
            );
            params.push(`%${search.trim()}%`);
            idx++;
        }

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        const sql = `
            SELECT i.id AS inbox_id, i.trang_thai, i.ly_do, i.responded_at, i.sent_at,
                   u.id AS user_id, u.full_name AS user_name, u.chuc_vu AS user_chuc_vu,
                   d.id AS document_id, d.book_id, d.so_di, d.so_ky_hieu, d.loai_van_ban,
                   d.ngay_ban_hanh, d.trich_yeu, d.do_khan,
                   d.noi_nhan_ben_ngoai, d.noi_nhan_noi_bo,
                   d.nguoi_ky_ten, d.chuc_vu, d.gan_dau_sao,
                   b.name AS book_name, b.symbol AS book_symbol
            FROM outgoing_internal_inbox i
            JOIN outgoing_documents d ON d.id = i.outgoing_id
            JOIN users u ON u.id = i.user_id
            LEFT JOIN document_books b ON b.id = d.book_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY i.responded_at DESC NULLS LAST, i.id DESC
            LIMIT $${idx++} OFFSET $${idx++}
        `;
        params.push(parseInt(limit, 10), offset);

        const { rows } = await db.query(sql, params);

        // counts cho 2 kind
        const countRes = await db.query(
            `SELECT trang_thai, COUNT(*)::int AS cnt
             FROM outgoing_internal_inbox
             WHERE sent_by = $1 AND hidden_for_sender = false AND trang_thai IN ('tu_choi', 'da_tra_lai')
             GROUP BY trang_thai`,
            [userId]
        );
        const counts = { tu_choi: 0, da_tra_lai: 0 };
        for (const r of countRes.rows) {
            if (counts.hasOwnProperty(r.trang_thai)) counts[r.trang_thai] = r.cnt;
        }

        const items = [];
        for (const r of rows) {
            const files = await fetchFiles(r.document_id);
            items.push({
                inboxId: r.inbox_id,
                trangThai: r.trang_thai,
                lyDo: r.ly_do,
                respondedAt: r.responded_at,
                sentAt: r.sent_at,
                recipient: {
                    id: r.user_id,
                    name: r.user_name,
                    chucVu: r.user_chuc_vu,
                },
                id: r.document_id,
                bookId: r.book_id,
                bookName: r.book_name,
                bookSymbol: r.book_symbol,
                soDi: r.so_di,
                soKyHieu: r.so_ky_hieu,
                loaiVanBan: r.loai_van_ban,
                ngayBanHanh: r.ngay_ban_hanh,
                trichYeu: r.trich_yeu,
                doKhan: r.do_khan,
                noiNhanBenNgoai: r.noi_nhan_ben_ngoai,
                noiNhanNoiBo: r.noi_nhan_noi_bo,
                nguoiKyTen: r.nguoi_ky_ten,
                chucVu: r.chuc_vu,
                ganDauSao: r.gan_dau_sao,
                files,
            });
        }

        return ok(res, { items, counts }, 'Lấy danh sách thông báo thành công');
    } catch (err) {
        console.error('outgoingDocuments listSenderNotifications error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /van-ban-di/don-vi/:orgId/thanh-vien — Người soạn thảo theo đơn vị
//   Dùng user_positions.org_id (không phải users.department_id)
// ═══════════════════════════════════════════════════════════════════════════════
const getOrgMembers = async (req, res) => {
    try {
        const orgId = parseInt(req.params.orgId, 10);
        if (!orgId) return fail(res, 'ID đơn vị không hợp lệ');

        const { rows } = await db.query(
            `SELECT DISTINCT u.id, u.full_name, u.email, u.role,
                    COALESCE(up.title, u.chuc_vu) AS chuc_vu
             FROM users u
             INNER JOIN user_positions up ON up.user_id = u.id
             WHERE up.org_id = $1 AND u.is_active = true
             ORDER BY u.full_name ASC`,
            [orgId]
        );
        return ok(res, rows);
    } catch (err) {
        console.error('outgoingDocuments getOrgMembers error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

module.exports = {
    list,
    detail,
    create,
    update,
    destroy,
    changeStatus,
    getBooks,
    getSigners,
    getOrganizations,
    getOrgMembers,
    searchInternalUsers,
    getRecipients,
    getRecipientStatus,
    guiNoiBo,
    listInternalInbox,
    markInboxAsRead,
    tiepNhanInbox,
    tuChoiInbox,
    traLaiInbox,
    hideInboxNotification,
    listSenderNotifications,
};
