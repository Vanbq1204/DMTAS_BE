
const db = require('../config/db');
const fs = require('fs');

// Helper: Response format
const ok = (res, data, message = 'Thành công', statusCode = 200) =>
    res.status(statusCode).json({ success: true, data, message });

const fail = (res, message = 'Thất bại', statusCode = 400) =>
    res.status(statusCode).json({ success: false, data: null, message });

/** File đính kèm gốc + file kèm ý kiến phối hợp (doc_type incoming_phoi_hop), kèm tên/chức vụ người upload */
const fetchIncomingAttachedFiles = async (dbClient, documentId) => {
    const { rows } = await dbClient.query(
        `SELECT df.*, u.full_name AS uploaded_by_name, up.title AS uploaded_by_chuc_vu
         FROM document_files df
         LEFT JOIN users u ON df.uploaded_by = u.id
         LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
         WHERE df.document_id = $1 AND df.doc_type IN ('incoming', 'incoming_phoi_hop')
         ORDER BY df.uploaded_at ASC NULLS LAST, df.id ASC`,
        [documentId]
    );
    return rows;
};

// Helper: Log History
const logHistory = async (client, { document_id, hanh_dong, noi_dung, tu_trang_thai, den_trang_thai, thuc_hien_boi, meta }) => {
    const query = `
        INSERT INTO document_history 
        (document_id, doc_type, hanh_dong, noi_dung, tu_trang_thai, den_trang_thai, thuc_hien_boi, thuc_hien_luc, meta)
        VALUES ($1, 'incoming', $2, $3, $4, $5, $6, NOW(), $7)
    `;
    const params = [document_id, hanh_dong, noi_dung, tu_trang_thai, den_trang_thai, thuc_hien_boi, meta || {}];
    if (client) {
        await client.query(query, params);
    } else {
        await db.query(query, params);
    }
};

// ─── GET /api/van-thu/van-ban-den ─────────────────────────────────────────────
const getIncomingDocuments = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            loai_nguon,
            category,
            tab,
            the_loai,
            date_filter, // 'today', 'yesterday', 'week', 'month'
            sort_field = 'ngay_den',
            sort_dir = 'desc'
        } = req.query;

        const userId = req.user.id;
        const orgId = req.user.orgId;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const conditions = ['d.is_deleted = false'];
        const params = [];
        let idx = 1;

        const categoryToVaiTro = {
            chu_tri: 'xu_ly',
            theo_doi: 'dau_moi',
            phoi_hop: 'phoi_hop',
            nhan_de_biet: 'biet',
        };
        const assignmentRole = categoryToVaiTro[category];

        // Scoping to clerk's organization/books only for normal source listing.
        // For role-based processing tabs (chu_tri/theo_doi/phoi_hop/nhan_de_biet),
        // use assignment-based scope instead.
        if (assignmentRole) {
            let statusFilter = `da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly', 'hoan_thanh', 'da_chuyen_tiep')`;
            if (category === 'nhan_de_biet') {
                if (tab === 'da_xem') {
                    statusFilter = `da.trang_thai = 'hoan_thanh'`;
                } else {
                    statusFilter = `da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`;
                }
            } else if (category === 'phoi_hop') {
                if (tab === 'da_y_kien') {
                    statusFilter = `da.trang_thai = 'hoan_thanh'`;
                } else if (tab === 'da_chuyen') {
                    statusFilter = `da.trang_thai = 'da_chuyen_tiep'`;
                } else {
                    statusFilter = `da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`;
                }
            }
            conditions.push(`
                d.id IN (
                    SELECT da.document_id
                    FROM document_assignments da
                    WHERE da.assigned_to = $${idx}
                      AND da.vai_tro = $${idx + 1}
                      AND ${statusFilter}
                )
            `);
            params.push(userId, assignmentRole);
            idx += 2;
        } else if (orgId) {
            conditions.push(`(dbk.created_by = $${idx} OR dbk.department_id = $${idx + 1} OR dbk.org_id = $${idx + 1})`);
            params.push(userId, orgId);
            idx += 2;
        } else {
            conditions.push(`(dbk.created_by = $${idx} OR dbk.department_id IS NULL)`);
            params.push(userId);
            idx += 1;
        }

        // Filter by loai_nguon / internal docs
        if (loai_nguon) {
            if (loai_nguon === 'van_ban_den_noi_bo') {
                // Documents assigned to the clerk's organization or user specifically
                conditions.push(`d.id IN (SELECT document_id FROM document_assignments WHERE org_id = $${idx} OR assigned_to = $${idx + 1})`);
                params.push(orgId);
                params.push(req.user.id);
                idx += 2;
            } else if (loai_nguon !== 'Tất cả') {
                conditions.push(`d.loai_nguon = $${idx++}`);
                params.push(loai_nguon);
            }
        }

        // Filter by the_loai
        if (the_loai && the_loai !== 'Tất cả') {
            conditions.push(`d.the_loai = $${idx++}`);
            params.push(the_loai);
        }

        // Search
        if (search) {
            conditions.push(`(d.so_hieu ILIKE $${idx} OR d.trich_yeu ILIKE $${idx} OR d.co_quan_bh ILIKE $${idx} OR d.so_den ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        // Date Filter
        if (date_filter) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (date_filter === 'today') {
                conditions.push(`d.ngay_den = $${idx++}`);
                params.push(today);
            } else if (date_filter === 'yesterday') {
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                conditions.push(`d.ngay_den = $${idx++}`);
                params.push(yesterday);
            } else if (date_filter === 'week') {
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                conditions.push(`d.ngay_den >= $${idx++}`);
                params.push(weekAgo);
            } else if (date_filter === 'month') {
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                conditions.push(`d.ngay_den >= $${idx++}`);
                params.push(monthStart);
            }
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const orderClause = `ORDER BY d.${sort_field} ${sort_dir === 'asc' ? 'ASC' : 'DESC'}`;

        // Count total
        const countRes = await db.query(
            `SELECT COUNT(*) FROM incoming_documents d LEFT JOIN document_books dbk ON d.so_van_ban_id = dbk.id ${whereClause}`,
            params
        );
        const total = parseInt(countRes.rows[0].count);

        // Fetch data with Leader Name, book entry status, and current active processor
        const docsRes = await db.query(
            `SELECT d.*, u.full_name as leader_name, dbe.trang_thai as book_entry_status,
                    curr.processor_name as current_processor_name,
                    curr.processor_org as current_processor_org
             FROM incoming_documents d
             LEFT JOIN document_books dbk ON d.so_van_ban_id = dbk.id
             LEFT JOIN document_book_entries dbe ON d.id = dbe.document_id AND dbe.book_id = dbk.id
             LEFT JOIN users u ON d.lanh_dao_id = u.id
             LEFT JOIN LATERAL (
                 SELECT u2.full_name as processor_name,
                        COALESCE(
                            (SELECT oun_a.name FROM organizations o_a JOIN org_unit_names oun_a ON o_a.name_id = oun_a.id WHERE o_a.id = da2.org_id),
                            (SELECT oun_p.name FROM user_positions up2 JOIN organizations o_p ON up2.org_id = o_p.id JOIN org_unit_names oun_p ON o_p.name_id = oun_p.id WHERE up2.user_id = da2.assigned_to ORDER BY up2.is_primary DESC, up2.id ASC LIMIT 1)
                        ) as processor_org
                 FROM document_assignments da2
                 LEFT JOIN users u2 ON da2.assigned_to = u2.id
                 WHERE da2.document_id = d.id
                   AND da2.vai_tro = 'xu_ly'
                   AND da2.trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep')
                 ORDER BY da2.assigned_at DESC
                 LIMIT 1
             ) curr ON true
             ${whereClause} 
             ${orderClause} 
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, parseInt(limit), offset]
        );

        // Fetch files for each document (optional optimization: join or separate query)
        // For simplicity, let's just fetch docs first. The frontend might need files details.
        // We can do a quick lookup for files.
        const docs = docsRes.rows;

        // Populate files and processing results
        for (const doc of docs) {
            // Original document files
            doc.files = await fetchIncomingAttachedFiles(db, doc.id);
            
            // Result files from specialists (ket_qua)
            const resultFilesRes = await db.query(
                `SELECT df.*, u.full_name as uploaded_by_name 
                 FROM document_files df
                 LEFT JOIN users u ON df.uploaded_by = u.id
                 WHERE df.document_id = $1 AND df.doc_type = 'ket_qua'
                 ORDER BY df.uploaded_at DESC`,
                [doc.id]
            );
            doc.result_files = resultFilesRes.rows;
            
            // Get latest processing result from history
            const resultRes = await db.query(
                `SELECT h.noi_dung, h.thuc_hien_luc as created_at, u.full_name as nguoi_thuc_hien
                 FROM document_history h
                 LEFT JOIN users u ON h.thuc_hien_boi = u.id
                 WHERE h.document_id = $1 AND h.hanh_dong = 'KET_THUC_XU_LY'
                 ORDER BY h.thuc_hien_luc DESC
                 LIMIT 1`,
                [doc.id]
            );
            doc.ket_qua_xu_ly = resultRes.rows.length > 0 ? resultRes.rows[0] : null;
        }

        // Count by category (sidebar badges cho các tab xử lý)
        const countByCategory = {};
        const roleCountQueries = [
            { key: 'chu_tri', vai_tro: 'xu_ly' },
            { key: 'theo_doi', vai_tro: 'dau_moi' },
            { key: 'phoi_hop', vai_tro: 'phoi_hop' },
            { key: 'nhan_de_biet', vai_tro: 'biet' },
        ];
        for (const rc of roleCountQueries) {
            const cRes = await db.query(
                `SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
                 JOIN document_assignments da ON d.id = da.document_id
                 WHERE d.is_deleted = false AND da.assigned_to = $1 AND da.vai_tro = $2 AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
                [userId, rc.vai_tro]
            );
            countByCategory[rc.key] = parseInt(cRes.rows[0].count);
        }

        return ok(res, {
            documents: docs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            },
            countByCategory
        });

    } catch (error) {
        console.error('getIncomingDocuments error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── POST /api/van-thu/van-ban-den ────────────────────────────────────────────
const createIncomingDocument = async (req, res) => {
    try {
        const {
            so_hieu,
            ngay_ban_hanh,
            ngay_den,
            co_quan_bh,
            nguoi_ky,
            trich_yeu,
            the_loai,
            loai_nguon,
            muc_khan,
            muc_mat,
            linh_vuc,
            chuc_vu,
            phuong_thuc_nhan,
            phai_tra_loi,
            co_ban_giay,
            so_van_ban_id,
            so_den, // Now passed from frontend or generated
            han_xu_ly,
            lanh_dao_id,
            ghi_chu_phan_phoi
        } = req.body;

        // Handle files from multer
        const files = req.files ? req.files.map(f => ({
            ten_file: f.originalname,
            duong_dan: f.filename,
            loai_file: f.originalname.split('.').pop().toLowerCase(), // use extension instead of mimetype
            kich_thuoc: f.size
        })) : [];

        // Validation basic
        if (!so_hieu || !trich_yeu || !the_loai || !so_van_ban_id) {
            return fail(res, 'Thiếu thông tin bắt buộc');
        }

        // Logic for so_den
        let finalSoDen = so_den;
        let soDenSo = 0;

        // Parse lanh_dao_id properly
        const parsedLanhDaoId = (lanh_dao_id === "" || !lanh_dao_id || lanh_dao_id === "null" || lanh_dao_id === "undefined") ? null : parseInt(lanh_dao_id);
        const parsedHanXuLy = (han_xu_ly === "" || !han_xu_ly || han_xu_ly === "null") ? null : han_xu_ly;
        const parsedNgayBanHanh = (ngay_ban_hanh === "" || !ngay_ban_hanh) ? null : ngay_ban_hanh;
        const parsedNgayDen = (ngay_den === "" || !ngay_den) ? new Date() : ngay_den;

        // If so_den is not provided, or we want to enforce consistency with the book
        if (so_van_ban_id) {
            const bookRes = await db.query('SELECT current_number, symbol, id FROM document_books WHERE id = $1', [so_van_ban_id]);
            if (bookRes.rows.length === 0) return fail(res, 'Sổ văn bản không tồn tại');

            const book = bookRes.rows[0];
            const currentYear = new Date().getFullYear();

            // Calculate initial soDenSo (default next number)
            soDenSo = (book.current_number || 0) + 1;

            if (!finalSoDen) {
                // Auto generate: Symbol-Number-Year
                finalSoDen = `${book.symbol}-${soDenSo}-${currentYear}`;

                // Check existence loop
                let exists = await db.query('SELECT id FROM incoming_documents WHERE so_den = $1', [finalSoDen]);
                while (exists.rows.length > 0) {
                    soDenSo++;
                    finalSoDen = `${book.symbol}-${soDenSo}-${currentYear}`;
                    exists = await db.query('SELECT id FROM incoming_documents WHERE so_den = $1', [finalSoDen]);
                }
            } else {
                // User provided so_den
                // Validate uniqueness
                const exists = await db.query('SELECT id FROM incoming_documents WHERE so_den = $1', [finalSoDen]);
                if (exists.rows.length > 0) {
                    return fail(res, `Số đến "${finalSoDen}" đã tồn tại.`);
                }
                // Try to extract number for sorting
                const match = String(finalSoDen).match(/\d+/);
                if (match) soDenSo = parseInt(match[0]);
            }

            // Update book current_number
            await db.query('UPDATE document_books SET current_number = GREATEST(current_number, $1) WHERE id = $2', [soDenSo, so_van_ban_id]);
        }

        // Mappings for constraints (Map Vietnamese display names to snake_case DB keys)
        const mappings = {
            the_loai: {
                'Công văn': 'cong_van',
                'Quyết định': 'quyet_dinh',
                'Thông báo': 'thong_bao',
                'Báo cáo': 'bao_cao',
                'Chỉ thị': 'chi_thi',
                'Tờ trình': 'to_trinh',
                'Nghị quyết': 'nghi_quyet',
                'Biên bản': 'bien_ban',
                'Công điện': 'cong_dien',
                'Hợp đồng': 'hop_dong',
                'Kế hoạch': 'ke_hoach',
                'Thông cáo': 'thong_cao'
            },
            muc_khan: {
                'Thường': 'thuong',
                'Khẩn': 'khan',
                'Thượng khẩn': 'thuong_khan'
            },
            muc_mat: {
                'Thường': 'thuong',
                'Mật': 'mat',
                'Tối mật': 'toi_mat'
            }
        };

        // Helper to map and sanitize
        const mapValue = (mapping, val, defaultVal) => {
            if (!val) return defaultVal;
            const normalized = val.trim();
            if (mapping[normalized]) return mapping[normalized];

            // Slugify as fallback
            return normalized.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[đĐ]/g, 'd')
                .replace(/[^a-z0-0]/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_+|_+$/g, '');
        };

        const finalTheLoai = mapValue(mappings.the_loai, the_loai, 'cong_van');
        const finalMucKhan = mapValue(mappings.muc_khan, muc_khan, 'thuong');
        const finalMucMat = mapValue(mappings.muc_mat, muc_mat, 'thuong');
        const finalTrangThai = 'moi_tiep_nhan'; // Default for new incoming docs

        console.log('--- DEBUG INSERT ---');
        console.log('Original:', { the_loai, muc_khan, muc_mat });
        console.log('Mapped:', { finalTheLoai, finalMucKhan, finalMucMat });

        // Insert document
        const insertRes = await db.query(
            `INSERT INTO incoming_documents 
            (so_den, so_hieu, ngay_ban_hanh, ngay_den, co_quan_bh, nguoi_ky, trich_yeu, the_loai, loai_nguon, muc_khan, muc_mat, trang_thai, created_by, is_deleted, created_at,
             linh_vuc, chuc_vu, phuong_thuc_nhan, phai_tra_loi, co_ban_giay, so_van_ban_id, so_den_so, han_xu_ly, lanh_dao_id, ghi_chu_phan_phoi)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, NOW(),
                    $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
            RETURNING id`,
            [
                finalSoDen,
                so_hieu,
                parsedNgayBanHanh,
                parsedNgayDen,
                co_quan_bh,
                nguoi_ky,
                trich_yeu,
                finalTheLoai,
                loai_nguon || 'so_vb_den',
                finalMucKhan,
                finalMucMat,
                finalTrangThai,
                req.user ? req.user.id : null,
                linh_vuc,
                chuc_vu,
                phuong_thuc_nhan,
                phai_tra_loi === 'true' || phai_tra_loi === true,
                co_ban_giay === 'true' || co_ban_giay === true,
                so_van_ban_id,
                soDenSo,
                parsedHanXuLy,
                parsedLanhDaoId,
                ghi_chu_phan_phoi
            ]
        );

        const docId = insertRes.rows[0].id;

        // Create entry in document_book_entries if so_van_ban_id is provided
        if (so_van_ban_id) {
            await db.query(
                `INSERT INTO document_book_entries 
                (document_id, doc_type, book_id, so_den, so_den_so, vao_so_boi, vao_so_luc, trang_thai)
                VALUES ($1, 'incoming', $2, $3, $4, $5, NOW(), 'dang_xu_ly')
                ON CONFLICT (document_id, book_id) DO NOTHING`,
                [docId, so_van_ban_id, finalSoDen, soDenSo, req.user ? req.user.id : null]
            );
        }

        // Insert files
        if (files && files.length > 0) {
            for (const f of files) {
                // Use Buffer to fix encoding issues for Vietnamese filenames manually if needed, 
                // but usually multer handles UTF-8 correctly if client sends it right.
                // If we really need manual fix: Buffer.from(f.ten_file, 'latin1').toString('utf8');
                // However, previous fix might have been double-decoding or wrong.
                // Let's try simple assignment or safer decode.

                let originalName = f.ten_file;
                try {
                    // Check if it looks like latin1 garbled utf8
                    if (/[ÃÂÊÔ]/.test(originalName) === false && /[\u00C0-\u00FF]/.test(originalName)) {
                        originalName = Buffer.from(f.ten_file, 'latin1').toString('utf8');
                    }
                } catch (e) { }

                await db.query(
                    `INSERT INTO document_files (document_id, doc_type, ten_file, duong_dan, loai_file, kich_thuoc, uploaded_by, uploaded_at)
                     VALUES ($1, 'incoming', $2, $3, $4, $5, $6, NOW())`,
                    [docId, originalName, f.duong_dan || '', f.loai_file || 'unknown', f.kich_thuoc || 0, req.user ? req.user.id : null]
                );
            }
        }

        // Log History
        await logHistory(null, {
            document_id: docId,
            hanh_dong: 'TAO_MOI',
            noi_dung: `Tiếp nhận văn bản mới: ${so_hieu} - ${trich_yeu}`,
            tu_trang_thai: null,
            den_trang_thai: finalTrangThai,
            thuc_hien_boi: req.user ? req.user.id : null
        });

        // Nếu có chọn lãnh đạo chỉ đạo ngay từ đầu -> Log thêm dòng Phân công
        if (parsedLanhDaoId) {
            const leaderRes = await db.query('SELECT full_name FROM users WHERE id = $1', [parsedLanhDaoId]);
            if (leaderRes.rows.length > 0) {
                const leaderName = leaderRes.rows[0].full_name;
                await logHistory(null, {
                    document_id: docId,
                    hanh_dong: 'PHAN_CONG',
                    noi_dung: 'Chuyển lãnh đạo chỉ đạo',
                    tu_trang_thai: finalTrangThai,
                    den_trang_thai: finalTrangThai,
                    thuc_hien_boi: req.user ? req.user.id : null,
                    meta: {
                        receivers: [{ name: leaderName, role: 'Chỉ đạo' }]
                    }
                });
            }
        }

        return ok(res, { id: docId, so_den }, 'Tiếp nhận văn bản thành công', 201);

    } catch (error) {
        console.error('createIncomingDocument error:', error);
        fs.appendFileSync('error.log', `[${new Date().toISOString()}] createIncomingDocument error: ${error.stack}\n`);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── GET /api/van-thu/so-van-ban-den ──────────────────────────────────────────
const getIncomingDocumentBooks = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.orgId;

        // Note: book_type in DB is 'Văn bản đến' based on debug data
        let query = `
            SELECT id, name, current_number, symbol 
            FROM document_books 
            WHERE book_type = 'Văn bản đến' 
        `;
        const params = [];

        // Logic:
        // 1. Own books (created_by = userId)
        // 2. Department books (org_id = orgId OR department_id = orgId)

        if (orgId) {
            query += ` AND (created_by = $1 OR department_id = $2 OR org_id = $2)`;
            params.push(userId, orgId);
        } else {
            query += ` AND (created_by = $1 OR department_id IS NULL)`;
            params.push(userId);
        }

        query += ` ORDER BY created_at DESC`;

        const books = await db.query(query, params);
        return ok(res, books.rows);
    } catch (error) {
        console.error('getIncomingDocumentBooks error:', error);
        return fail(res, 'Lỗi server');
    }
};

// ─── GET /api/van-thu/lanh-dao ────────────────────────────────────────────────
const getLeaders = async (req, res) => {
    try {
        // orgId từ JWT payload = user_positions.org_id (đơn vị tổ chức của user)
        const orgId = req.user.orgId;

        let query, params;

        if (orgId) {
            // Tìm lãnh đạo cùng org_id với văn thư hiện tại
            // Dùng bảng user_positions để xác định ai thuộc đơn vị nào
            query = `
                SELECT DISTINCT u.id, u.full_name, u.role, up.title
                FROM users u
                INNER JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
                WHERE u.role = 'lanh_dao'
                AND u.is_active = true
                AND up.org_id = $1
                ORDER BY u.full_name ASC
            `;
            params = [orgId];
        } else {
            // Fallback: Nếu không xác định được đơn vị (Admin hoặc thiếu data),
            // trả về tất cả lãnh đạo để chức năng vẫn sử dụng được
            query = `
                SELECT DISTINCT u.id, u.full_name, u.role, up.title
                FROM users u
                INNER JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
                WHERE u.role = 'lanh_dao'
                AND u.is_active = true
                ORDER BY u.full_name ASC
            `;
            params = [];
        }

        const leaders = await db.query(query, params);
        return ok(res, leaders.rows);
    } catch (error) {
        console.error('getLeaders error:', error);
        return fail(res, 'Lỗi server');
    }
};

// ─── GET /api/van-thu/document-symbols ────────────────────────────────────────
const getDocumentSymbols = async (req, res) => {
    try {
        // Fetch all symbols for auto-suggestion logic
        const symbols = await db.query(`
            SELECT id, name, document_type 
            FROM document_symbols 
            ORDER BY display_order ASC
        `);
        return ok(res, symbols.rows);
    } catch (error) {
        console.error('getLeaders error:', error);
        return fail(res, 'Lỗi server');
    }
};

// ─── UPDATE DOCUMENT ──────────────────────────────────────────────────────────
const updateIncomingDocument = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            so_van_ban_id,
            so_den,
            so_hieu,
            ngay_ban_hanh,
            ngay_den,
            co_quan_bh,
            nguoi_ky,
            trich_yeu,
            the_loai,
            linh_vuc,
            chuc_vu,
            muc_khan,
            muc_mat,
            trang_thai,
            phuong_thuc_nhan,
            phai_tra_loi,
            co_ban_giay,
            so_den_so,
            han_xu_ly,
            lanh_dao_id,
            ghi_chu_phan_phoi,
            loai_nguon
        } = req.body;

        // Get old status
        const oldDocRes = await db.query('SELECT trang_thai, so_hieu FROM incoming_documents WHERE id = $1', [id]);
        if (oldDocRes.rows.length === 0) return fail(res, 'Văn bản không tồn tại', 404);
        const oldStatus = oldDocRes.rows[0].trang_thai;
        const oldSoHieu = oldDocRes.rows[0].so_hieu;

        // Basic mapping for enums/values
        // Note: Similar logic to create
        const finalTheLoai = the_loai || 'cong_van';
        const finalMucKhan = muc_khan === 'Thường' ? 'thuong' :
            muc_khan === 'Khẩn' ? 'khan' :
                muc_khan === 'Thượng khẩn' ? 'thuong_khan' : 'thuong';
        const finalMucMat = muc_mat || 'thuong';
        const finalTrangThai = trang_thai || oldStatus;

        await db.query(
            `UPDATE incoming_documents SET
                so_den = $1, so_hieu = $2, ngay_ban_hanh = $3, ngay_den = $4, co_quan_bh = $5,
                nguoi_ky = $6, trich_yeu = $7, the_loai = $8, linh_vuc = $9, chuc_vu = $10,
                muc_khan = $11, muc_mat = $12, trang_thai = $13, phuong_thuc_nhan = $14,
                phai_tra_loi = $15, co_ban_giay = $16, so_van_ban_id = $17, so_den_so = $18,
                han_xu_ly = $19, lanh_dao_id = $20, ghi_chu_phan_phoi = $21, loai_nguon = $22,
                updated_at = NOW()
            WHERE id = $23`,
            [
                so_den, so_hieu,
                (ngay_ban_hanh === "" || !ngay_ban_hanh) ? null : ngay_ban_hanh,
                (ngay_den === "" || !ngay_den) ? new Date() : ngay_den,
                co_quan_bh, nguoi_ky, trich_yeu, finalTheLoai, linh_vuc, chuc_vu,
                finalMucKhan, finalMucMat, finalTrangThai, phuong_thuc_nhan,
                phai_tra_loi === 'true' || phai_tra_loi === true,
                co_ban_giay === 'true' || co_ban_giay === true,
                so_van_ban_id, so_den_so,
                (han_xu_ly === "" || !han_xu_ly || han_xu_ly === "null") ? null : han_xu_ly,
                (lanh_dao_id === "" || !lanh_dao_id || lanh_dao_id === "null" || lanh_dao_id === "undefined") ? null : parseInt(lanh_dao_id),
                ghi_chu_phan_phoi, loai_nguon,
                id
            ]
        );

        // Handle Files: For now, we only ADD new files. Deleting old files is a separate UI action usually.
        // If files were uploaded
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                let originalName = file.originalname;
                try {
                    if (/[ÃÂÊÔ]/.test(originalName) === false && /[\u00C0-\u00FF]/.test(originalName)) {
                        originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
                    }
                } catch (e) { }

                const filePath = file.filename;
                const fileType = originalName.split('.').pop().toLowerCase(); // simple extension extraction
                const fileSize = file.size;

                await db.query(
                    `INSERT INTO document_files (document_id, doc_type, ten_file, duong_dan, loai_file, kich_thuoc, uploaded_at, uploaded_by)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
                    [id, 'incoming', originalName, filePath, fileType, fileSize, req.user ? req.user.id : null]
                );
            }
        }

        // Log History
        await logHistory(null, {
            document_id: id,
            hanh_dong: 'CAP_NHAT',
            noi_dung: `Cập nhật thông tin văn bản (Số hiệu: ${so_hieu})`,
            tu_trang_thai: oldStatus,
            den_trang_thai: finalTrangThai,
            thuc_hien_boi: req.user ? req.user.id : null
        });

        return ok(res, { id }, 'Cập nhật thành công');
    } catch (error) {
        console.error('updateIncomingDocument error:', error);
        return fail(res, 'Lỗi cập nhật văn bản');
    }
};

// ─── DELETE DOCUMENT ──────────────────────────────────────────────────────────
const deleteIncomingDocument = async (req, res) => {
    try {
        const { id } = req.params;
        const oldDocRes = await db.query('SELECT trang_thai FROM incoming_documents WHERE id = $1', [id]);
        if (oldDocRes.rows.length === 0) return fail(res, 'Văn bản không tồn tại', 404);
        const oldStatus = oldDocRes.rows[0].trang_thai;

        await db.query(`UPDATE incoming_documents SET is_deleted = true WHERE id = $1`, [id]);

        // Log History
        await logHistory(null, {
            document_id: id,
            hanh_dong: 'XOA',
            noi_dung: 'Xóa văn bản (soft delete)',
            tu_trang_thai: oldStatus,
            den_trang_thai: 'deleted',
            thuc_hien_boi: req.user ? req.user.id : null
        });

        return ok(res, null, 'Xóa văn bản thành công');
    } catch (error) {
        console.error('deleteIncomingDocument error:', error);
        return fail(res, 'Lỗi xóa văn bản');
    }
};

// ─── GET /api/lanh-dao/van-ban-den ────────────────────────────────────────────
// Lấy danh sách văn bản đến được phân công cho lãnh đạo hiện tại
const getLeaderIncomingDocuments = async (req, res) => {
    try {
        const leaderId = req.user.id;
        const {
            page = 1,
            limit = 10,
            search,
            category, // 'chu_tri' | 'theo_doi' | 'phoi_hop' | 'nhan_de_biet' | 'qua_han'
            tab = 'cho_xu_ly', // 'cho_xu_ly' | 'dang_xu_ly' | 'da_xu_ly' | 'da_chuyen' | 'da_thu_hoi'
            sort_field = 'ngay_den',
            sort_dir = 'desc'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        // Leaders can see docs officially assigned to them (lanh_dao_id = user.id)
        // OR docs assigned to them via document_assignments table.
        // We will do a LEFT JOIN and check either condition.
        const conditions = ['d.is_deleted = false', `(d.lanh_dao_id = $1 OR da.assigned_to = $1)`];
        const params = [leaderId];
        let idx = 2;

        // Category + Tab filters (kết hợp để đảm bảo logic nhất quán)
        if (category === 'qua_han') {
            conditions.push(`d.han_xu_ly IS NOT NULL`);
            conditions.push(`d.han_xu_ly < CURRENT_DATE`);
            conditions.push(`d.trang_thai NOT IN ('hoan_thanh', 'luu_tru')`);

        } else if (category === 'chu_tri') {
            if (tab === 'da_chuyen') {
                // Đã chuyển xử lý: VB mà lãnh đạo này đã phân công tiếp cho người khác
                conditions.push(`d.lanh_dao_id = $1`);
                conditions.push(`d.trang_thai = 'da_giao_xu_ly'`);
            } else if (tab === 'da_thu_hoi') {
                conditions.push(`d.trang_thai = 'luu_tru'`);
            } else {
                // Chờ xử lý / Đang xử lý / Đã xử lý: áp dụng filter chủ trì
                conditions.push(`(
                    (d.lanh_dao_id = $1 AND d.trang_thai NOT IN ('da_giao_xu_ly', 'hoan_thanh', 'luu_tru'))
                    OR
                    (da.assigned_to = $1 AND da.vai_tro = 'xu_ly' AND da.trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep'))
                )`);

                if (tab === 'cho_xu_ly') {
                    conditions.push(`(d.trang_thai IN ('moi_tiep_nhan', 'cho_lanh_dao_xem', 'dang_xu_ly', 'da_giao_xu_ly') OR da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly'))`);
                } else if (tab === 'dang_xu_ly') {
                    conditions.push(`(d.trang_thai IN ('dang_xu_ly', 'da_giao_xu_ly') OR da.trang_thai = 'dang_xu_ly')`);
                } else if (tab === 'da_xu_ly') {
                    conditions.push(`(d.trang_thai IN ('hoan_thanh', 'cho_duyet_ket_qua') OR da.trang_thai = 'hoan_thanh')`);
                }
            }

        } else if (category === 'phoi_hop') {
            conditions.push(`da.vai_tro = 'phoi_hop'`);
            if (tab === 'da_y_kien') {
                conditions.push(`da.trang_thai = 'hoan_thanh'`);
            } else if (tab === 'da_chuyen') {
                conditions.push(`da.trang_thai = 'da_chuyen_tiep'`);
            } else {
                conditions.push(`da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`);
            }

        } else if (category === 'nhan_de_biet') {
            conditions.push(`da.vai_tro = 'biet'`);
            if (tab === 'da_xem' || tab === 'da_xu_ly') {
                conditions.push(`da.trang_thai = 'hoan_thanh'`);
            } else {
                conditions.push(`da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`);
            }

        } else if (category === 'theo_doi') {
            conditions.push(`da.vai_tro = 'dau_moi'`);
            conditions.push(`da.assigned_to = $1`);
            if (tab === 'da_xu_ly') {
                conditions.push(`(d.trang_thai IN ('hoan_thanh', 'cho_duyet_ket_qua') OR da.trang_thai = 'hoan_thanh')`);
            } else {
                conditions.push(`da.trang_thai != 'hoan_thanh'`);
            }

        } else {
            // Fallback khi không có category cụ thể
            if (tab === 'cho_xu_ly') {
                conditions.push(`(d.trang_thai IN ('moi_tiep_nhan', 'cho_lanh_dao_xem', 'dang_xu_ly', 'da_giao_xu_ly') OR da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly'))`);
            } else if (tab === 'dang_xu_ly') {
                conditions.push(`(d.trang_thai IN ('dang_xu_ly') OR da.trang_thai = 'dang_xu_ly')`);
            } else if (tab === 'da_xu_ly') {
                conditions.push(`(d.trang_thai IN ('hoan_thanh', 'cho_duyet_ket_qua') OR da.trang_thai = 'hoan_thanh')`);
            } else if (tab === 'da_chuyen') {
                conditions.push(`d.trang_thai = 'da_giao_xu_ly'`);
            } else if (tab === 'da_thu_hoi') {
                conditions.push(`d.trang_thai = 'luu_tru'`);
            }
        }

        // Search
        if (search) {
            conditions.push(`(d.so_hieu ILIKE $${idx} OR d.trich_yeu ILIKE $${idx} OR d.co_quan_bh ILIKE $${idx} OR d.so_den ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const allowedSort = ['ngay_den', 'ngay_ban_hanh', 'so_den', 'han_xu_ly'];
        const safeSort = allowedSort.includes(sort_field) ? sort_field : 'ngay_den';
        const orderClause = `ORDER BY d.${safeSort} ${sort_dir === 'asc' ? 'ASC' : 'DESC'}`;

        const joinClause = `LEFT JOIN document_assignments da ON d.id = da.document_id AND da.assigned_to = $1`;

        // Count total
        const countRes = await db.query(
            `SELECT COUNT(DISTINCT d.id) 
             FROM incoming_documents d 
             ${joinClause} 
             ${whereClause}`,
            params
        );
        const total = parseInt(countRes.rows[0].count);

        // Fetch data
        const docsRes = await db.query(
            `SELECT DISTINCT d.*, u.full_name as leader_name, 
                    da.vai_tro as assign_vai_tro, da.trang_thai as assign_trang_thai, da.chi_dao as assign_chi_dao,
                    curr.processor_name as current_processor_name,
                    curr.processor_org as current_processor_org
             FROM incoming_documents d
             ${joinClause}
             LEFT JOIN users u ON d.lanh_dao_id = u.id
             LEFT JOIN LATERAL (
                 SELECT u2.full_name as processor_name,
                        COALESCE(
                            (SELECT oun_a.name FROM organizations o_a JOIN org_unit_names oun_a ON o_a.name_id = oun_a.id WHERE o_a.id = da2.org_id),
                            (SELECT oun_p.name FROM user_positions up2 JOIN organizations o_p ON up2.org_id = o_p.id JOIN org_unit_names oun_p ON o_p.name_id = oun_p.id WHERE up2.user_id = da2.assigned_to ORDER BY up2.is_primary DESC, up2.id ASC LIMIT 1)
                        ) as processor_org
                 FROM document_assignments da2
                 LEFT JOIN users u2 ON da2.assigned_to = u2.id
                 WHERE da2.document_id = d.id
                   AND da2.vai_tro = 'xu_ly'
                   AND da2.trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep')
                 ORDER BY da2.assigned_at DESC
                 LIMIT 1
             ) curr ON true
             ${whereClause} 
             ${orderClause} 
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, parseInt(limit), offset]
        );

        const docs = docsRes.rows;

        // Populate files and processing results
        for (const doc of docs) {
            // Original document files
            doc.files = await fetchIncomingAttachedFiles(db, doc.id);
            
            // Result files from specialists (ket_qua)
            const resultFilesRes = await db.query(
                `SELECT df.*, u.full_name as uploaded_by_name 
                 FROM document_files df
                 LEFT JOIN users u ON df.uploaded_by = u.id
                 WHERE df.document_id = $1 AND df.doc_type = 'ket_qua'
                 ORDER BY df.uploaded_at DESC`,
                [doc.id]
            );
            doc.result_files = resultFilesRes.rows;
            
            // Get latest processing result from history
            const resultRes = await db.query(
                `SELECT h.noi_dung, h.thuc_hien_luc as created_at, u.full_name as nguoi_thuc_hien
                 FROM document_history h
                 LEFT JOIN users u ON h.thuc_hien_boi = u.id
                 WHERE h.document_id = $1 AND h.hanh_dong = 'KET_THUC_XU_LY'
                 ORDER BY h.thuc_hien_luc DESC
                 LIMIT 1`,
                [doc.id]
            );
            doc.ket_qua_xu_ly = resultRes.rows.length > 0 ? resultRes.rows[0] : null;
        }

        // Count by category (for sidebar badges)
        const countByCategory = {};

        // Chủ trì = VB chỉ định trực tiếp (lanh_dao_id) HOẶC phân công qua assignments (vai_tro = xu_ly)
        const chuTriRes = await db.query(`
            SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
            LEFT JOIN document_assignments da ON d.id = da.document_id AND da.assigned_to = $1
            WHERE d.is_deleted = false
              AND (
                  (d.lanh_dao_id = $1 AND d.trang_thai NOT IN ('da_giao_xu_ly', 'hoan_thanh', 'luu_tru'))
                  OR
                  (da.assigned_to = $1 AND da.vai_tro = 'xu_ly' AND da.trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep'))
              )`, [leaderId]);
        countByCategory.chu_tri = parseInt(chuTriRes.rows[0].count);

        // Theo dõi = lãnh đạo có assignment dau_moi cho chính họ (chưa kết thúc theo dõi)
        const theodoiRes = await db.query(
            `SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             WHERE d.is_deleted = false 
               AND da.assigned_to = $1 
               AND da.vai_tro = 'dau_moi'
               AND da.trang_thai != 'hoan_thanh'`,
            [leaderId]
        );
        countByCategory.theo_doi = parseInt(theodoiRes.rows[0].count);

        // Quá hạn = VB thuộc lãnh đạo (trực tiếp hoặc qua assignments) đã quá hạn
        const quaHanRes = await db.query(`
            SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
            LEFT JOIN document_assignments da ON d.id = da.document_id AND da.assigned_to = $1
            WHERE d.is_deleted = false
              AND (d.lanh_dao_id = $1 OR da.assigned_to = $1)
              AND d.trang_thai NOT IN ('hoan_thanh', 'luu_tru')
              AND d.han_xu_ly IS NOT NULL AND d.han_xu_ly < CURRENT_DATE`,
            [leaderId]
        );
        countByCategory.qua_han = parseInt(quaHanRes.rows[0].count);

        // Phối hợp
        const phoiHopRes = await db.query(
            `SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             WHERE d.is_deleted = false AND da.assigned_to = $1 AND da.vai_tro = 'phoi_hop' AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
            [leaderId]
        );
        countByCategory.phoi_hop = parseInt(phoiHopRes.rows[0].count);

        // Nhận để biết (chưa xem)
        const nhanDeBietRes = await db.query(
            `SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             WHERE d.is_deleted = false AND da.assigned_to = $1 AND da.vai_tro = 'biet' AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
            [leaderId]
        );
        countByCategory.nhan_de_biet = parseInt(nhanDeBietRes.rows[0].count);

        return ok(res, {
            documents: docs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            },
            countByCategory
        });
    } catch (error) {
        console.error('getLeaderIncomingDocuments error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── GET /api/lanh-dao/assignment-targets ────────────────────────────────────
// Lấy danh sách dùng cho popup Phân công văn bản (theo cấp của lãnh đạo)
const getAssignmentTargets = async (req, res) => {
    try {
        const userId = req.user.id;
        const orgId = req.user.orgId;

        if (!orgId) {
            return fail(res, 'Không xác định được phòng ban của lãnh đạo', 400);
        }

        // Lấy cấp của lãnh đạo hiện tại (dựa vào cấu hình role_configs, 1 là cao nhất)
        const currentRoleRes = await db.query(`
            SELECT rc.level 
            FROM user_positions up 
            JOIN role_configs rc ON up.role_config_id = rc.id 
            WHERE up.user_id = $1 AND up.org_id = $2 AND up.is_primary = true
        `, [userId, orgId]);
        const currentRoleLevel = currentRoleRes.rows.length > 0 ? currentRoleRes.rows[0].level : 99;

        // 1. Phân Lãnh đạo cố định (cùng orgId, role lanh_dao, khác userId)
        const fixedLeadersQuery = `
            SELECT u.id, u.full_name as name, up.title, u.role
            FROM users u
            JOIN user_positions up ON u.id = up.user_id AND up.is_primary = true
            WHERE up.org_id = $1 AND u.role = 'lanh_dao' AND u.id != $2 AND u.is_active = true
            ORDER BY u.full_name
        `;
        const { rows: fixedLeaders } = await db.query(fixedLeadersQuery, [orgId, userId]);

        // 2. Chuyên viên / Nhân viên trực thuộc phòng ban hiện tại (cùng orgId, không phải lanh_dao)
        const currentStaffQuery = `
            SELECT u.id, u.full_name as name, up.title, u.role
            FROM users u
            JOIN user_positions up ON u.id = up.user_id AND up.is_primary = true
            WHERE up.org_id = $1 AND u.role != 'lanh_dao' AND u.is_active = true
            ORDER BY u.full_name
        `;
        const { rows: currentStaff } = await db.query(currentStaffQuery, [orgId]);

        // 3. Tìm các phòng ban cấp dưới (Dựa vào cấp lãnh đạo)
        let childOrgIds = [];
        if (currentRoleLevel === 1) {
            // Lãnh đạo cấp 1 (toàn trường): Lấy TẤT CẢ các phòng ban có chứa bất kỳ lãnh đạo nào cấp thấp hơn (> 1)
            const orgsRes = await db.query(`
                SELECT DISTINCT up.org_id
                FROM user_positions up
                JOIN role_configs rc ON up.role_config_id = rc.id
                JOIN users u ON up.user_id = u.id AND u.role = 'lanh_dao'
                WHERE rc.level > 1 AND u.is_active = true AND up.is_primary = true
            `);
            childOrgIds = orgsRes.rows.map(r => r.org_id);
        } else {
            // Lãnh đạo cấp 2, 3...: Lấy các phòng ban LÀ CON/CHÁU của tổ chức hiện tại, và phải có lãnh đạo cấp thấp hơn
            const orgsRes = await db.query(`
                WITH RECURSIVE descendants AS (
                    SELECT id, parent_id
                    FROM organizations
                    WHERE parent_id = $1 AND is_active = true
                    UNION ALL
                    SELECT o.id, o.parent_id
                    FROM organizations o
                    INNER JOIN descendants d ON o.parent_id = d.id
                    WHERE o.is_active = true
                )
                SELECT DISTINCT up.org_id
                FROM descendants d
                JOIN user_positions up ON d.id = up.org_id AND up.is_primary = true
                JOIN role_configs rc ON up.role_config_id = rc.id
                JOIN users u ON up.user_id = u.id AND u.role = 'lanh_dao'
                WHERE rc.level > $2 AND u.is_active = true
            `, [orgId, currentRoleLevel]);
            childOrgIds = orgsRes.rows.map(r => r.org_id);
        }

        let childUnits = [];

        // Nếu phòng ban hiện tại cũng có nhân viên / chuyên viên, bổ sung nhóm này vào đầu danh sách
        if (currentStaff.length > 0) {
            childUnits.push({
                id: orgId,
                name: 'Nhân viên trực thuộc đơn vị',
                type: 'org',
                children: currentStaff.map(s => ({
                    id: s.id,
                    name: s.name,
                    title: s.title,
                    type: 'user',
                    role: s.role,
                }))
            });
        }

        if (childOrgIds.length > 0) {
            // Lấy tất cả user (gồm lãnh đạo cấp dưới & chuyên viên) thuộc các phòng ban con đó
            const childStaffQuery = `
                SELECT u.id, u.full_name as name, up.title, up.org_id, un.name as org_name, u.role
                FROM users u
                JOIN user_positions up ON u.id = up.user_id AND up.is_primary = true
                JOIN organizations o ON up.org_id = o.id
                JOIN org_unit_names un ON o.name_id = un.id
                WHERE up.org_id = ANY($1) AND u.is_active = true
                ORDER BY o.level ASC, un.name ASC, 
                    CASE WHEN u.role = 'lanh_dao' THEN 1 ELSE 2 END ASC,
                    u.full_name ASC
            `;
            const { rows: childStaff } = await db.query(childStaffQuery, [childOrgIds]);

            // Nhóm staff theo phòng ban
            const orgMap = {};
            childStaff.forEach(s => {
                if (!orgMap[s.org_id]) {
                    orgMap[s.org_id] = {
                        id: s.org_id,
                        name: s.org_name,
                        type: 'org',
                        children: []
                    };
                }
                orgMap[s.org_id].children.push({
                    id: s.id,
                    name: s.name,
                    title: s.title || 'Chuyên viên',
                    type: 'user',
                    role: s.role,
                });
            });

            // Convert object map -> array và push vào childUnits
            Object.values(orgMap).forEach(org => childUnits.push(org));

        } else if (childUnits.length === 1 && childUnits[0].name === 'Nhân viên trực thuộc đơn vị') {
            // Lãnh đạo cấp thấp nhất (không có phòng ban con nào), danh sách vẫn giữ cấu trúc parent-child thay vì dàn phẳng
            // Do Component Modals/AssignmentModal.jsx dựa vào cấu trúc grouped by target
        } else if (childUnits.length === 0) {
            // Nếu không có bất kì ai
            childUnits = [];
        }

        return ok(res, {
            fixedLeaders,
            childUnits
        });
    } catch (error) {
        console.error('getAssignmentTargets error:', error);
        return fail(res, 'Lỗi khi lấy thông tin phân công', 500);
    }
};

// ─── POST /api/lanh-dao/assign ────────────────────────────────────
// Xử lý phân công văn bản
const assignDocument = async (req, res) => {
    let client;
    try {
        console.log('[assignDocument] Request received:', JSON.stringify(req.body));
        console.log('[assignDocument] User:', req.user?.id);
        client = await db.pool.connect();
        const { docId, y_kien_xu_ly, han_xu_ly, truc_tiep_theo_doi, assignments } = req.body;
        const userId = req.user.id;

        if (!docId || !assignments || assignments.length === 0) {
            return fail(res, 'Vui lòng cung cấp đủ thông tin phân công', 400);
        }

        // Kiểm tra xem user này có quyền phân công không (lanh_dao_id hoặc có assignment xu_ly cho user này)
        const docCheck = await client.query(
            `SELECT d.id, d.lanh_dao_id, d.trang_thai,
                    EXISTS(SELECT 1 FROM document_assignments da 
                           WHERE da.document_id = d.id AND da.assigned_to = $2 
                           AND da.vai_tro = 'xu_ly' AND da.trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep')) as has_xu_ly_assignment
             FROM incoming_documents d WHERE d.id = $1 AND d.is_deleted = false`,
            [docId, userId]
        );
        
        if (docCheck.rows.length === 0) {
            return fail(res, 'Văn bản không tồn tại', 404);
        }
        
        const doc = docCheck.rows[0];
        const canAssign = doc.lanh_dao_id === userId || doc.has_xu_ly_assignment;
        
        if (!canAssign) {
            return fail(res, 'Bạn không có quyền phân công văn bản này', 403);
        }

        await client.query('BEGIN');

        // Đếm số lượng assignment thực sự được thực hiện (insert mới hoặc reset)
        let changesCount = 0;
        let alreadyActiveCount = 0;
        let effectiveRoleAssignments = 0;
        const resolvedTargets = [];

        const userRoleCache = new Map();
        const getUserRoleById = async (uid) => {
            if (!uid) return null;
            if (userRoleCache.has(uid)) return userRoleCache.get(uid);
            const roleRes = await client.query('SELECT role FROM users WHERE id = $1', [uid]);
            const role = roleRes.rows[0]?.role || null;
            userRoleCache.set(uid, role);
            return role;
        };

        const resolveOrgRepresentatives = async (targetOrgId) => {
            const repRes = await client.query(
                `SELECT u.id, u.full_name, u.role, up.title,
                        COALESCE(u.is_representative, false) as is_representative
                 FROM user_positions up
                 JOIN users u ON up.user_id = u.id
                 WHERE up.org_id = $1
                   AND up.is_primary = true
                   AND u.is_active = true
                   AND (COALESCE(u.is_representative, false) = true OR u.role = 'van_thu')
                 ORDER BY
                    CASE
                        WHEN u.role = 'van_thu' THEN 0
                        WHEN u.role = 'lanh_dao' THEN 1
                        ELSE 2
                    END,
                    u.full_name ASC`,
                [targetOrgId]
            );
            return repRes.rows || [];
        };

        for (const assign of assignments) {
            const { target_id, target_type, chu_tri, theo_doi, phoi_hop, de_biet } = assign;

            let recipients = [];
            if (target_type === 'org') {
                const reps = await resolveOrgRepresentatives(target_id);
                if (!reps.length) {
                    await client.query('ROLLBACK');
                    return fail(res, 'Không tìm thấy người đại diện nhận văn bản trong đơn vị đã chọn', 400);
                }
                recipients = reps.map((r) => ({
                    orgId: target_id,
                    assignedTo: r.id,
                    assignedRole: r.role,
                    receiverLabel: `${r.full_name} (${r.title || r.role || 'Đại diện đơn vị'})`,
                }));
            } else {
                const assignedRole = await getUserRoleById(target_id);
                recipients = [{
                    orgId: null,
                    assignedTo: target_id,
                    assignedRole,
                    receiverLabel: `ID:${target_id}`,
                }];
            }

            for (const recipient of recipients) {
                const { orgId, assignedTo, assignedRole, receiverLabel } = recipient;

                // Trả về: 'inserted' | 'reset' | 'already_active'
                const insertAssignment = async (vai_tro) => {
                    const existingCheck = await client.query(
                        `SELECT id, trang_thai FROM document_assignments 
                         WHERE document_id = $1 
                           AND COALESCE(org_id, 0) = COALESCE($2::int, 0)
                           AND COALESCE(assigned_to, 0) = COALESCE($3::int, 0)
                           AND vai_tro = $4
                         ORDER BY
                             CASE WHEN trang_thai IN ('chua_xu_ly', 'dang_xu_ly') THEN 0 ELSE 1 END,
                             id DESC
                         LIMIT 1`,
                        [docId, orgId, assignedTo, vai_tro]
                    );

                    if (existingCheck.rows.length > 0) {
                        const existing = existingCheck.rows[0];
                        if (existing.trang_thai === 'chua_xu_ly' || existing.trang_thai === 'dang_xu_ly') {
                            return 'already_active';
                        }
                        await client.query(
                            `UPDATE document_assignments 
                             SET trang_thai = 'chua_xu_ly', chi_dao = $2, han_noi_bo = $3, assigned_by = $4, assigned_at = NOW()
                             WHERE id = $1`,
                            [existing.id, y_kien_xu_ly || null, han_xu_ly || null, userId]
                        );
                        return 'reset';
                    }

                    await client.query(
                        `INSERT INTO document_assignments 
                        (document_id, doc_type, org_id, assigned_to, vai_tro, chi_dao, han_noi_bo, assigned_by) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [docId, 'incoming', orgId, assignedTo, vai_tro, y_kien_xu_ly || null, han_xu_ly || null, userId]
                    );
                    return 'inserted';
                };

                const results = [];
                if (chu_tri) results.push(await insertAssignment('xu_ly'));
                if (theo_doi && assignedRole === 'lanh_dao') results.push(await insertAssignment('dau_moi'));
                if (phoi_hop) results.push(await insertAssignment('phoi_hop'));
                if (de_biet) results.push(await insertAssignment('biet'));
                effectiveRoleAssignments += results.length;

                const changed = results.filter(r => r === 'inserted' || r === 'reset').length;
                const alreadyActive = results.filter(r => r === 'already_active').length;
                changesCount += changed;
                alreadyActiveCount += alreadyActive;

                resolvedTargets.push({
                    target_type,
                    target_id,
                    assigned_to: assignedTo,
                    assigned_role: assignedRole,
                    chu_tri: !!chu_tri,
                    theo_doi: !!(theo_doi && assignedRole === 'lanh_dao'),
                    phoi_hop: !!phoi_hop,
                    de_biet: !!de_biet,
                    receiverLabel,
                });
            }
        }

        if (effectiveRoleAssignments === 0) {
            await client.query('ROLLBACK');
            return fail(res, 'Không có vai trò phân công hợp lệ cho đối tượng đã chọn', 400);
        }

        // Nếu tất cả đều đã phân công và đang active → báo lỗi, không tiếp tục
        if (changesCount === 0 && alreadyActiveCount > 0) {
            await client.query('ROLLBACK');
            return fail(res, 'Văn bản đã được phân công cho người này và đang trong quá trình xử lý. Không thể phân công lại.', 409);
        }

        // Nếu lãnh đạo chọn trực tiếp theo dõi → thêm/reset assignment dau_moi cho chính họ
        if (truc_tiep_theo_doi) {
            const existingDauMoi = await client.query(
                `SELECT id, trang_thai FROM document_assignments 
                 WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'dau_moi'`,
                [docId, userId]
            );
            if (existingDauMoi.rows.length > 0) {
                const dm = existingDauMoi.rows[0];
                if (dm.trang_thai === 'hoan_thanh') {
                    // Reset lại để theo dõi tiếp
                    await client.query(
                        `UPDATE document_assignments SET trang_thai = 'chua_xu_ly', assigned_at = NOW() WHERE id = $1`,
                        [dm.id]
                    );
                }
                // Nếu đang active → giữ nguyên
            } else {
                await client.query(
                    `INSERT INTO document_assignments 
                    (document_id, doc_type, assigned_to, vai_tro, chi_dao, han_noi_bo, assigned_by)
                    VALUES ($1, 'incoming', $2, 'dau_moi', $3, $4, $5)`,
                    [docId, userId, y_kien_xu_ly || null, han_xu_ly || null, userId]
                );
            }
        }

        // Cập nhật trạng thái văn bản sang da_giao_xu_ly để loại khỏi tab Chờ xử lý của lãnh đạo
        await client.query(
            "UPDATE incoming_documents SET trang_thai = 'da_giao_xu_ly' WHERE id = $1 AND trang_thai IN ('moi_tiep_nhan', 'cho_lanh_dao_xem', 'dang_xu_ly')",
            [docId]
        );

        // Update assignment của người phân công (nếu có) thành 'da_chuyen_tiep'
        // Điều này đảm bảo văn bản không còn hiện trong tab "Chủ trì xử lý" của họ
        await client.query(
            `UPDATE document_assignments 
             SET trang_thai = 'da_chuyen_tiep' 
             WHERE document_id = $1 
               AND assigned_to = $2 
               AND vai_tro = 'xu_ly' 
               AND trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep')`,
            [docId, userId]
        );

        // Log History
        // 1. Resolve names for logging
        const userIds = [...new Set(resolvedTargets.map(a => a.assigned_to).filter(Boolean))];
        const orgIds = [...new Set(resolvedTargets.filter(a => a.target_type === 'org').map(a => a.target_id))];

        // Add current user if truc_tiep_theo_doi
        if (truc_tiep_theo_doi) userIds.push(userId);

        let userMap = {};
        let orgMap = {};

        if (userIds.length > 0) {
            const uRes = await client.query('SELECT id, full_name FROM users WHERE id = ANY($1)', [userIds]);
            uRes.rows.forEach(r => userMap[r.id] = r.full_name);
        }
        if (orgIds.length > 0) {
            // Need to join org_unit_names to get proper name
            const oRes = await client.query(`
                SELECT o.id, un.name 
                FROM organizations o 
                JOIN org_unit_names un ON o.name_id = un.id 
                WHERE o.id = ANY($1)
            `, [orgIds]);
            oRes.rows.forEach(r => orgMap[r.id] = r.name);
        }

        const receivers = [];

        // Map resolved assignments to receivers list
        for (const a of resolvedTargets) {
            let name = a.target_type === 'user'
                ? userMap[a.assigned_to]
                : `${orgMap[a.target_id] || `Đơn vị ${a.target_id}`} -> ${userMap[a.assigned_to] || a.receiverLabel}`;
            let role = '';
            if (a.chu_tri) role = 'Chủ trì';
            else if (a.theo_doi) role = 'Theo dõi';
            else if (a.phoi_hop) role = 'Phối hợp';
            else if (a.de_biet) role = 'Để biết';

            receivers.push({ name: name || a.receiverLabel || `ID:${a.target_id}`, role });
        }

        if (truc_tiep_theo_doi) {
            receivers.push({ name: userMap[userId] || 'Tôi', role: 'Theo dõi' });
        }

        await logHistory(client, {
            document_id: docId,
            hanh_dong: 'PHAN_CONG',
            noi_dung: y_kien_xu_ly || 'Chuyển xử lý',
            tu_trang_thai: 'dang_xu_ly',
            den_trang_thai: 'da_giao_xu_ly',
            thuc_hien_boi: userId,
            meta: { receivers }
        });

        await client.query('COMMIT');
        return ok(res, 'Phân công thành công');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('assignDocument error:', error);
        return fail(res, 'Lỗi khi phân công văn bản', 500);
    } finally {
        if (client) client.release();
    }
};

// ─── GET /api/nhan-vien/van-ban-den ────────────────────────────────────────────
const getNhanVienIncomingDocuments = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            tab = 'cho_xu_ly',
            category = 'chu_tri',
            sort_field = 'ngay_den',
            sort_dir = 'desc'
        } = req.query;

        const userId = req.user.id;
        const orgId = req.user.orgId;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const conditions = ['d.is_deleted = false', 'da.assigned_to = $1'];
        const params = [userId];
        let idx = 2;

        // Map category to vai_tro
        if (category === 'chu_tri') {
            conditions.push(`da.vai_tro = 'xu_ly'`);
        } else if (category === 'phoi_hop') {
            conditions.push(`da.vai_tro = 'phoi_hop'`);
        } else if (category === 'nhan_de_biet') {
            conditions.push(`da.vai_tro = 'biet'`);
        }

        // Tab filter (maps to assignment status)
        if (tab === 'cho_xu_ly' || tab === 'chua_xem' || tab === 'cho_phoi_hop') {
            conditions.push(`da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`);
        } else if (tab === 'dang_xu_ly') {
            conditions.push(`da.trang_thai = 'dang_xu_ly'`);
        } else if (tab === 'da_xu_ly' || tab === 'da_xem' || tab === 'da_y_kien') {
            conditions.push(`da.trang_thai = 'hoan_thanh'`);
        } else if (tab === 'da_chuyen') {
            conditions.push(`da.trang_thai = 'da_chuyen_tiep'`);
        }

        // Search
        if (search) {
            conditions.push(`(d.so_hieu ILIKE $${idx} OR d.trich_yeu ILIKE $${idx} OR d.co_quan_bh ILIKE $${idx} OR d.so_den ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const whereClause = `WHERE ${conditions.join(' AND ')}`;
        const allowedSort = ['ngay_den', 'ngay_ban_hanh', 'so_den', 'han_xu_ly'];
        const safeSort = allowedSort.includes(sort_field) ? sort_field : 'ngay_den';
        const orderClause = `ORDER BY d.${safeSort} ${sort_dir === 'asc' ? 'ASC' : 'DESC'}`;

        // Count total
        const countRes = await db.query(
            `SELECT COUNT(*) 
             FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             ${whereClause}`,
            params
        );
        const total = parseInt(countRes.rows[0].count);

        // Fetch data
        const docsRes = await db.query(
            `SELECT d.*, u.full_name as leader_name, da.vai_tro, da.trang_thai as assign_status, da.chi_dao,
                    curr.processor_name as current_processor_name,
                    curr.processor_org as current_processor_org
             FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             LEFT JOIN users u ON d.lanh_dao_id = u.id
             LEFT JOIN LATERAL (
                 SELECT u2.full_name as processor_name,
                        COALESCE(
                            (SELECT oun_a.name FROM organizations o_a JOIN org_unit_names oun_a ON o_a.name_id = oun_a.id WHERE o_a.id = da2.org_id),
                            (SELECT oun_p.name FROM user_positions up2 JOIN organizations o_p ON up2.org_id = o_p.id JOIN org_unit_names oun_p ON o_p.name_id = oun_p.id WHERE up2.user_id = da2.assigned_to ORDER BY up2.is_primary DESC, up2.id ASC LIMIT 1)
                        ) as processor_org
                 FROM document_assignments da2
                 LEFT JOIN users u2 ON da2.assigned_to = u2.id
                 WHERE da2.document_id = d.id
                   AND da2.vai_tro = 'xu_ly'
                   AND da2.trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep')
                 ORDER BY da2.assigned_at DESC
                 LIMIT 1
             ) curr ON true
             ${whereClause} 
             ${orderClause} 
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, parseInt(limit), offset]
        );

        const docs = docsRes.rows;

        // Populate files
        for (const doc of docs) {
            doc.files = await fetchIncomingAttachedFiles(db, doc.id);
        }

        // Count by category (for sidebar badges)
        const chuTriRes = await db.query(
            `SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             WHERE d.is_deleted = false AND da.assigned_to = $1 AND da.vai_tro = 'xu_ly' AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
            [userId]
        );
        const phoiHopRes = await db.query(
            `SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             WHERE d.is_deleted = false AND da.assigned_to = $1 AND da.vai_tro = 'phoi_hop' AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
            [userId]
        );
        const nhanDeBietRes = await db.query(
            `SELECT COUNT(DISTINCT d.id) FROM incoming_documents d
             JOIN document_assignments da ON d.id = da.document_id
             WHERE d.is_deleted = false AND da.assigned_to = $1 AND da.vai_tro = 'biet' AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
            [userId]
        );
        const countByCategory = {
            chu_tri: parseInt(chuTriRes.rows[0].count),
            phoi_hop: parseInt(phoiHopRes.rows[0].count),
            nhan_de_biet: parseInt(nhanDeBietRes.rows[0].count),
        };

        return ok(res, {
            documents: docs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit))
            },
            countByCategory
        });
    } catch (error) {
        console.error('getNhanVienIncomingDocuments error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};


// ─── POST /api/nhan-vien/van-ban-den/:id/ket-thuc-xu-ly ──────────────────────
const ketThucXuLy = async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const { ket_qua_xu_ly } = req.body;
        const userId = req.user.id;

        // Verify document exists
        const docRes = await db.query('SELECT trang_thai FROM incoming_documents WHERE id = $1 AND is_deleted = false', [id]);
        if (docRes.rows.length === 0) return fail(res, 'Văn bản không tồn tại', 404);

        // Verify user has an active assignment for this document
        const assignRes = await db.query(
            `SELECT id FROM document_assignments WHERE document_id = $1 AND assigned_to = $2 AND trang_thai != 'hoan_thanh'`,
            [id, userId]
        );
        if (assignRes.rows.length === 0) return fail(res, 'Bạn không có phân công xử lý văn bản này', 403);

        const oldTrangThai = docRes.rows[0].trang_thai;

        // Handle uploaded files
        const files = req.files ? req.files.map(f => {
            let originalName = f.originalname;
            try {
                if (/[ÃÂÊÔ]/.test(originalName) === false && /[\u00C0-\u00FF]/.test(originalName)) {
                    originalName = Buffer.from(f.originalname, 'latin1').toString('utf8');
                }
            } catch (e) { }
            return {
                ten_file: originalName,
                duong_dan: f.filename,
                loai_file: originalName.split('.').pop().toLowerCase(),
                kich_thuoc: f.size
            };
        }) : [];

        client = await db.pool.connect();
        await client.query('BEGIN');

        // Insert result files to document_files with doc_type = 'ket_qua'
        for (const f of files) {
            await client.query(
                `INSERT INTO document_files (document_id, doc_type, ten_file, duong_dan, loai_file, kich_thuoc, uploaded_by, uploaded_at)
                 VALUES ($1, 'ket_qua', $2, $3, $4, $5, $6, NOW())`,
                [id, f.ten_file, f.duong_dan, f.loai_file, f.kich_thuoc, userId]
            );
        }

        // Mark this user's assignment(s) as done
        await client.query(
            `UPDATE document_assignments SET trang_thai = 'hoan_thanh' WHERE document_id = $1 AND assigned_to = $2`,
            [id, userId]
        );

        // Check if all xu_ly assignments are now completed
        // Bỏ qua 'da_chuyen_tiep' (assignment của văn thư đã chuyển tiếp đi) để không block trạng thái hoàn thành
        const pendingRes = await client.query(
            `SELECT COUNT(*) FROM document_assignments WHERE document_id = $1 AND vai_tro = 'xu_ly' AND trang_thai NOT IN ('hoan_thanh', 'da_chuyen_tiep')`,
            [id]
        );
        const allDone = parseInt(pendingRes.rows[0].count) === 0;
        const newStatus = allDone ? 'hoan_thanh' : oldTrangThai;

        // Log history
        await logHistory(client, {
            document_id: id,
            hanh_dong: 'KET_THUC_XU_LY',
            noi_dung: ket_qua_xu_ly || 'Hoàn thành xử lý',
            tu_trang_thai: oldTrangThai,
            den_trang_thai: newStatus,
            thuc_hien_boi: userId,
            meta: {
                ket_qua: ket_qua_xu_ly || '',
                files: files.map(f => ({ ten_file: f.ten_file, duong_dan: f.duong_dan }))
            }
        });

        // If all chu_tri assignments are done, update document status + book entries
        if (allDone) {
            await client.query(
                "UPDATE incoming_documents SET trang_thai = 'hoan_thanh', updated_at = NOW() WHERE id = $1",
                [id]
            );
            // Update all book entries for this document to 'da_xu_ly'
            await client.query(
                `UPDATE document_book_entries SET trang_thai = 'da_xu_ly', hoan_thanh_luc = NOW()
                 WHERE document_id = $1 AND doc_type = 'incoming'`,
                [id]
            );
        }

        await client.query('COMMIT');
        return ok(res, null, 'Kết thúc xử lý thành công');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('ketThucXuLy error:', error);
        return fail(res, 'Lỗi server', 500);
    } finally {
        if (client) client.release();
    }
};

/* ══════════════════════════════════════════════════════════
   GET DOCUMENT HISTORY — Lịch sử xử lý văn bản
   ══════════════════════════════════════════════════════════ */
const getDocumentHistory = async (req, res) => {
    const { id } = req.params;
    try {
        const historyRes = await db.query(`
            SELECT h.*, u.full_name as nguoi_thuc_hien, up.title as chuc_vu, un.name as don_vi
            FROM document_history h
            LEFT JOIN users u ON h.thuc_hien_boi = u.id
            LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
            LEFT JOIN organizations o ON up.org_id = o.id
            LEFT JOIN org_unit_names un ON o.name_id = un.id
            WHERE h.document_id = $1
            ORDER BY h.thuc_hien_luc ASC
        `, [id]);

        const ACTION_MAP = {
            'TAO_MOI': 'Tiếp nhận',
            'CAP_NHAT': 'Cập nhật',
            'XOA': 'Xóa',
            'PHAN_CONG': 'Chuyển xử lý',
            'Y_KIEN': 'Cho ý kiến',
            'KET_THUC_XU_LY': 'Đã xử lý',
            'DA_XEM': 'Đã xem để biết',
            'CHUYEN_DE_BIET': 'Chuyển xem để biết',
            'CHUYEN_PHOI_HOP': 'Chuyển phối hợp',
            'Y_KIEN_PHOI_HOP': 'Ý kiến phối hợp'
        };

        const timeline = historyRes.rows.map((row, idx) => {
            let receivers = [];
            if (row.meta && row.meta.receivers && Array.isArray(row.meta.receivers)) {
                receivers = row.meta.receivers.map(r => `${r.role}: ${r.name}`);
            }

            return {
                stt: idx + 1,
                ngay_gio: row.thuc_hien_luc,
                nguoi_thuc_hien: row.nguoi_thuc_hien || 'Hệ thống',
                chuc_vu: row.chuc_vu || '',
                don_vi: row.don_vi || '',
                thao_tac: ACTION_MAP[row.hanh_dong] || row.hanh_dong,
                nguoi_don_vi_nhan: receivers.length > 0 ? receivers : [],
                y_kien: row.noi_dung,
                files: (row.meta && row.meta.files) ? row.meta.files : []
            };
        });

        return ok(res, { timeline, total: timeline.length });
    } catch (error) {
        console.error('getDocumentHistory error:', error);
        return fail(res, 'Lỗi server: ' + error.message, 500);
    }
};

/* ══════════════════════════════════════════════════════════
   GET INTERNAL INCOMING DOCUMENTS (VĂN BẢN ĐẾN NỘI BỘ)
   ══════════════════════════════════════════════════════════ */
const getInternalIncomingDocuments = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', tab = 'cho_xu_ly' } = req.query;
        const userId = req.user.id;
        const offset = (page - 1) * limit;
        const params = [];
        let query = '';
        let countQuery = '';

        if (tab === 'cho_xu_ly') {
            // Documents assigned to the current user (Van Thu)
            query = `
                SELECT d.*, da.id as assignment_id, da.chi_dao, u.full_name as leader_name
                FROM incoming_documents d
                JOIN document_assignments da ON d.id = da.document_id
                LEFT JOIN users u ON da.assigned_by = u.id
                WHERE d.is_deleted = false 
                AND da.assigned_to = $1 
                AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')
                AND d.trang_thai != 'khong_vao_so'
            `;
            countQuery = `
                SELECT COUNT(*) 
                FROM incoming_documents d
                JOIN document_assignments da ON d.id = da.document_id
                WHERE d.is_deleted = false 
                AND da.assigned_to = $1 
                AND da.trang_thai IN ('chua_xu_ly', 'dang_xu_ly')
                AND d.trang_thai != 'khong_vao_so'
            `;
            params.push(userId);
        } else if (tab === 'khong_vao_so') {
            // Documents marked as 'khong_vao_so'
            // We might want to see ALL 'khong_vao_so' docs, or only those related to this user.
            // For Van Thu, seeing all is usually appropriate.
            query = `
                SELECT d.* 
                FROM incoming_documents d
                WHERE d.is_deleted = false 
                AND d.trang_thai = 'khong_vao_so'
            `;
            countQuery = `
                SELECT COUNT(*) 
                FROM incoming_documents d
                WHERE d.is_deleted = false 
                AND d.trang_thai = 'khong_vao_so'
            `;
        }

        // Search
        if (search) {
            const searchClause = ` AND (d.so_hieu ILIKE $${params.length + 1} OR d.trich_yeu ILIKE $${params.length + 1} OR d.co_quan_bh ILIKE $${params.length + 1})`;
            query += searchClause;
            countQuery += searchClause;
            params.push(`%${search}%`);
        }

        // Order and Limit
        query += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        // Execute Count
        const countRes = await db.query(countQuery, params);
        const total = parseInt(countRes.rows[0].count);

        // Execute Data
        const dataRes = await db.query(query, [...params, limit, offset]);

        // Populate files
        const docs = dataRes.rows;
        for (const doc of docs) {
            doc.files = await fetchIncomingAttachedFiles(db, doc.id);
        }

        return ok(res, {
            documents: docs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('getInternalIncomingDocuments error:', error);
        return fail(res, 'Lỗi server');
    }
};

/* ══════════════════════════════════════════════════════════
   MARK AS "KHÔNG VÀO SỔ"
   ══════════════════════════════════════════════════════════ */
const markAsKhongVaoSo = async (req, res) => {
    try {
        const { id } = req.params;
        const { ly_do } = req.body;
        const userId = req.user.id;

        if (!ly_do) return fail(res, 'Vui lòng nhập lý do không vào sổ');

        const docRes = await db.query('SELECT trang_thai FROM incoming_documents WHERE id = $1', [id]);
        if (docRes.rows.length === 0) return fail(res, 'Văn bản không tồn tại', 404);

        await db.query(
            `UPDATE incoming_documents SET trang_thai = 'khong_vao_so', ly_do_khong_vao_so = $1, updated_at = NOW() WHERE id = $2`,
            [ly_do, id]
        );

        // Log history
        await logHistory(null, {
            document_id: id,
            hanh_dong: 'CAP_NHAT',
            noi_dung: `Chuyển sang không vào sổ: ${ly_do}`,
            tu_trang_thai: docRes.rows[0].trang_thai,
            den_trang_thai: 'khong_vao_so',
            thuc_hien_boi: userId
        });

        return ok(res, null, 'Đã chuyển sang không vào sổ');
    } catch (error) {
        console.error('markAsKhongVaoSo error:', error);
        return fail(res, 'Lỗi server');
    }
};

/* ══════════════════════════════════════════════════════════
   GET TARGETS FOR NỘI BỘ FORWARD (lãnh đạo + nhân viên cùng org)
   ══════════════════════════════════════════════════════════ */
const getNoiBoForwardTargets = async (req, res) => {
    try {
        // Fix: Use req.user.orgId if available, otherwise check DB
        let orgId = req.user.orgId;
        const userId = req.user.id;

        if (!orgId) {
            const userRes = await db.query(
                `SELECT up.org_id FROM user_positions up WHERE up.user_id = $1 AND up.is_primary = true`,
                [userId]
            );
            if (userRes.rows.length > 0) {
                orgId = userRes.rows[0].org_id;
            }
        }

        if (!orgId) return fail(res, 'Không xác định được đơn vị', 400);

        const result = await db.query(`
            SELECT DISTINCT u.id, u.full_name, u.role, up.title
            FROM users u
            INNER JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
            WHERE up.org_id = $1 AND u.is_active = true
              AND u.role IN ('lanh_dao', 'nhan_vien') AND u.id != $2
            ORDER BY u.full_name
        `, [orgId, userId]);

        return ok(res, result.rows);
    } catch (error) {
        console.error('getNoiBoForwardTargets error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════════════════
   FORWARD DOCUMENTS (CHUYỂN TIẾP / VÀO SỔ)
   ══════════════════════════════════════════════════════════ */
const forwardInternalDocuments = async (req, res) => {
    let client;
    try {
        const { ids, target_ids, forward_type, so_van_ban_id, so_den_noi_bo } = req.body;
        const userId = req.user.id;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return fail(res, 'Chưa chọn văn bản nào');
        }
        if (!target_ids || !Array.isArray(target_ids) || target_ids.length === 0) {
            return fail(res, 'Chưa chọn người nhận để chuyển tiếp');
        }
        if (!forward_type || !['vao_so', 'khong_vao_so_forward'].includes(forward_type)) {
            return fail(res, 'Loại chuyển tiếp không hợp lệ');
        }
        if (forward_type === 'vao_so' && !so_van_ban_id) {
            return fail(res, 'Vui lòng chọn sổ văn bản');
        }

        // Lấy thông tin tất cả người nhận
        const targetsRes = await db.query(
            'SELECT id, full_name, role FROM users WHERE id = ANY($1)',
            [target_ids]
        );
        if (targetsRes.rows.length === 0) return fail(res, 'Người nhận không tồn tại', 404);
        const targetMap = {};
        targetsRes.rows.forEach(t => { targetMap[t.id] = t; });

        // Tìm lãnh đạo đầu tiên trong danh sách (nếu có) để set lanh_dao_id
        const firstLeader = targetsRes.rows.find(t => t.role === 'lanh_dao');

        // Tạo receivers list cho log
        const receivers = targetsRes.rows.map(t => ({ name: t.full_name, role: 'Xử lý' }));

        client = await db.pool.connect();
        await client.query('BEGIN');

        for (const id of ids) {
            const docRes = await client.query('SELECT trang_thai FROM incoming_documents WHERE id = $1', [id]);
            if (docRes.rows.length === 0) continue;

            const oldStatus = docRes.rows[0].trang_thai;
            const newStatus = 'dang_xu_ly';

            if (forward_type === 'vao_so') {
                // Fetch book and generate so_den for this entry (do NOT overwrite incoming_documents)
                const bookRes = await client.query(
                    'SELECT current_number, symbol, id FROM document_books WHERE id = $1',
                    [so_van_ban_id]
                );
                if (bookRes.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return fail(res, 'Sổ văn bản không tồn tại');
                }
                const book = bookRes.rows[0];
                const currentYear = new Date().getFullYear();

                let soDenSo = (book.current_number || 0) + 1;
                let finalSoDen = book.symbol
                    ? `${book.symbol}-${soDenSo}-${currentYear}`
                    : `${soDenSo}-${currentYear}`;

                // Unique check within this book's entries
                let existsInBook = await client.query(
                    'SELECT id FROM document_book_entries WHERE book_id = $1 AND so_den = $2',
                    [so_van_ban_id, finalSoDen]
                );
                while (existsInBook.rows.length > 0) {
                    soDenSo++;
                    finalSoDen = book.symbol
                        ? `${book.symbol}-${soDenSo}-${currentYear}`
                        : `${soDenSo}-${currentYear}`;
                    existsInBook = await client.query(
                        'SELECT id FROM document_book_entries WHERE book_id = $1 AND so_den = $2',
                        [so_van_ban_id, finalSoDen]
                    );
                }

                // Update book counter
                await client.query(
                    'UPDATE document_books SET current_number = GREATEST(current_number, $1) WHERE id = $2',
                    [soDenSo, so_van_ban_id]
                );

                // INSERT new book entry — preserves original so_van_ban_id on the document
                await client.query(
                    `INSERT INTO document_book_entries
                     (document_id, doc_type, book_id, so_den, so_den_so, so_den_noi_bo, vao_so_boi, vao_so_luc, trang_thai)
                     VALUES ($1, 'incoming', $2, $3, $4, $5, $6, NOW(), 'dang_xu_ly')`,
                    [id, so_van_ban_id, finalSoDen, soDenSo, so_den_noi_bo || null, userId]
                );

                // Update document so it appears in "Sổ văn bản đến" after vào sổ.
                // NOTE: We keep book entry details in document_book_entries, and also
                // set source/book on incoming_documents for existing list filters.
                await client.query(
                    `UPDATE incoming_documents 
                     SET trang_thai = $1, so_van_ban_id = $2, loai_nguon = 'so_vb_den', lanh_dao_id = $3, updated_at = NOW() 
                     WHERE id = $4`,
                    [newStatus, so_van_ban_id, firstLeader ? firstLeader.id : null, id]
                );
            } else {
                // khong_vao_so_forward — chuyển tiếp không vào sổ
                await client.query(
                    `UPDATE incoming_documents SET trang_thai = $1, lanh_dao_id = $2, updated_at = NOW() WHERE id = $3`,
                    [newStatus, firstLeader ? firstLeader.id : null, id]
                );
            }

            // Mark VanThu's assignment as 'da_chuyen_tiep' so doc leaves their queue
            await client.query(
                `UPDATE document_assignments SET trang_thai = 'da_chuyen_tiep' 
                 WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'xu_ly' AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
                [id, userId]
            );

            // Create assignment for each recipient
            for (const targetId of target_ids) {
                const checkAssign = await client.query(
                    `SELECT id FROM document_assignments WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'xu_ly'`,
                    [id, targetId]
                );
                if (checkAssign.rows.length === 0) {
                    await client.query(
                        `INSERT INTO document_assignments (document_id, doc_type, assigned_to, vai_tro, assigned_by, trang_thai)
                         VALUES ($1, 'incoming', $2, 'xu_ly', $3, 'chua_xu_ly')`,
                        [id, targetId, userId]
                    );
                }
            }

            // Log history
            await logHistory(client, {
                document_id: id,
                hanh_dong: 'PHAN_CONG',
                noi_dung: forward_type === 'vao_so'
                    ? `Văn thư chuyển tiếp + vào sổ${so_den_noi_bo ? ' (Số VB nội: ' + so_den_noi_bo + ')' : ''}`
                    : 'Văn thư chuyển tiếp văn bản nội bộ (không vào sổ)',
                tu_trang_thai: oldStatus,
                den_trang_thai: newStatus,
                thuc_hien_boi: userId,
                meta: { receivers }
            });
        }

        await client.query('COMMIT');
        return ok(res, null, 'Chuyển tiếp thành công');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('forwardInternalDocuments error:', error);
        return fail(res, 'Lỗi server');
    } finally {
        if (client) client.release();
    }
};

// ─── POST /api/lanh-dao/ket-thuc-theo-doi ────────────────────────────────────
const ketThucTheoDoi = async (req, res) => {
    try {
        const { docIds } = req.body; // Array of document IDs
        const userId = req.user.id;

        if (!docIds || !Array.isArray(docIds) || docIds.length === 0) {
            return fail(res, 'Vui lòng chọn ít nhất một văn bản', 400);
        }

        // Update all theo_doi assignments for this user
        await db.query(
            `UPDATE document_assignments 
             SET trang_thai = 'hoan_thanh' 
             WHERE document_id = ANY($1) 
               AND assigned_to = $2 
               AND vai_tro = 'dau_moi'
               AND trang_thai != 'hoan_thanh'`,
            [docIds, userId]
        );

        return ok(res, null, 'Kết thúc theo dõi thành công');
    } catch (error) {
        console.error('ketThucTheoDoi error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════════════════
   TẠO DỰ THẢO TỪ VĂN BẢN ĐẾN — đã chuyển sang duThaoController
   Giữ lại để tránh lỗi import cũ, sẽ redirect sang controller mới
   ══════════════════════════════════════════════════════════ */
const taoDuThaoTuVanBanDen = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const { trich_yeu, loai_van_ban, nguoi_ky, ghi_chu, don_vi_soan } = req.body;

    if (!trich_yeu) return fail(res, 'Trích yếu không được để trống', 400);

    try {
        // Create table if not exists
        await db.query(`
            CREATE TABLE IF NOT EXISTS van_ban_du_thao (
                id SERIAL PRIMARY KEY,
                incoming_document_id INTEGER REFERENCES incoming_documents(id),
                ma_du_thao VARCHAR(50),
                trich_yeu TEXT NOT NULL,
                loai_van_ban VARCHAR(100),
                nguoi_ky TEXT,
                don_vi_soan TEXT,
                ghi_chu TEXT,
                trang_thai VARCHAR(50) DEFAULT 'dang_soan_thao',
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                is_deleted BOOLEAN DEFAULT false
            )
        `);

        // Verify document and user assignment
        const docRes = await db.query(
            'SELECT so_hieu, trich_yeu FROM incoming_documents WHERE id = $1 AND is_deleted = false',
            [id]
        );
        if (docRes.rows.length === 0) return fail(res, 'Văn bản không tồn tại', 404);

        const doc = docRes.rows[0];

        // Generate draft code
        const year = new Date().getFullYear();
        const countRes = await db.query(
            'SELECT COUNT(*) FROM van_ban_du_thao WHERE EXTRACT(YEAR FROM created_at) = $1',
            [year]
        );
        const seq = (parseInt(countRes.rows[0].count) + 1).toString().padStart(4, '0');
        const maDuThao = `DT-${year}${seq}`;

        const insertRes = await db.query(
            `INSERT INTO van_ban_du_thao 
             (incoming_document_id, ma_du_thao, trich_yeu, loai_van_ban, nguoi_ky, don_vi_soan, ghi_chu, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [id, maDuThao, trich_yeu, loai_van_ban || null, nguoi_ky || null, don_vi_soan || null, ghi_chu || null, userId]
        );

        // Log history
        await logHistory(null, {
            document_id: id,
            hanh_dong: 'TAO_DU_THAO',
            noi_dung: `Đã tạo dự thảo ${maDuThao}: ${trich_yeu}`,
            tu_trang_thai: doc.trang_thai,
            den_trang_thai: doc.trang_thai,
            thuc_hien_boi: userId,
            meta: { du_thao_id: insertRes.rows[0].id, ma_du_thao: maDuThao }
        });

        return ok(res, insertRes.rows[0], 'Tạo dự thảo thành công');
    } catch (error) {
        console.error('taoDuThaoTuVanBanDen error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════════════════
   LẤY DANH SÁCH DỰ THẢO
   ══════════════════════════════════════════════════════════ */
const getDuThaoList = async (req, res) => {
    const userId = req.user.id;
    try {
        // Create table if not exists first
        await db.query(`
            CREATE TABLE IF NOT EXISTS van_ban_du_thao (
                id SERIAL PRIMARY KEY,
                incoming_document_id INTEGER REFERENCES incoming_documents(id),
                ma_du_thao VARCHAR(50),
                trich_yeu TEXT NOT NULL,
                loai_van_ban VARCHAR(100),
                nguoi_ky TEXT,
                don_vi_soan TEXT,
                ghi_chu TEXT,
                trang_thai VARCHAR(50) DEFAULT 'dang_soan_thao',
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                is_deleted BOOLEAN DEFAULT false
            )
        `);

        const result = await db.query(
            `SELECT d.*, u.full_name as nguoi_soan,
                    inc.so_hieu as van_ban_den_so_hieu, inc.trich_yeu as van_ban_den_trich_yeu
             FROM van_ban_du_thao d
             LEFT JOIN users u ON d.created_by = u.id
             LEFT JOIN incoming_documents inc ON d.incoming_document_id = inc.id
             WHERE d.created_by = $1 AND d.is_deleted = false
             ORDER BY d.created_at DESC`,
            [userId]
        );
        return ok(res, result.rows);
    } catch (error) {
        console.error('getDuThaoList error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── POST /:id/da-xem-de-biet ─── Đánh dấu đã xem (để biết) ────────────────
const markDeBietAsRead = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
        const result = await db.query(
            `UPDATE document_assignments
             SET trang_thai = 'hoan_thanh'
             WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'biet'
               AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')
             RETURNING id`,
            [id, userId]
        );

        if (result.rowCount === 0) {
            return fail(res, 'Không tìm thấy phân công hoặc đã xem', 404);
        }

        await logHistory(null, {
            document_id: id,
            hanh_dong: 'DA_XEM',
            noi_dung: 'Đã xem để biết',
            tu_trang_thai: 'chua_xu_ly',
            den_trang_thai: 'da_xem',
            thuc_hien_boi: userId,
            meta: {}
        });

        return ok(res, 'Đã đánh dấu đã xem');
    } catch (error) {
        console.error('markDeBietAsRead error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── POST /:id/chuyen-de-biet ─── Chuyển xem để biết cho người khác ─────────
const forwardDeBiet = async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { assignments } = req.body;

        if (!assignments || assignments.length === 0) {
            return fail(res, 'Vui lòng chọn đối tượng để chuyển', 400);
        }

        client = await db.pool.connect();
        await client.query('BEGIN');

        const resolvedTargets = [];

        for (const assign of assignments) {
            const { target_id, target_type } = assign;

            if (target_type === 'org') {
                const usersRes = await client.query(
                    `SELECT u.id, u.full_name, up.title
                     FROM user_positions up
                     JOIN users u ON up.user_id = u.id
                     WHERE up.org_id = $1 AND up.is_primary = true AND u.is_active = true
                     ORDER BY u.full_name`,
                    [target_id]
                );
                for (const user of usersRes.rows) {
                    if (user.id === userId) continue;
                    const existing = await client.query(
                        `SELECT id FROM document_assignments
                         WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'biet'
                           AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
                        [id, user.id]
                    );
                    if (existing.rows.length === 0) {
                        await client.query(
                            `INSERT INTO document_assignments
                            (document_id, doc_type, org_id, assigned_to, vai_tro, assigned_by)
                            VALUES ($1, 'incoming', $2, $3, 'biet', $4)`,
                            [id, target_id, user.id, userId]
                        );
                        resolvedTargets.push({ name: user.full_name, title: user.title });
                    }
                }
            } else {
                if (parseInt(target_id) === userId) continue;
                const existing = await client.query(
                    `SELECT id FROM document_assignments
                     WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'biet'
                       AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
                    [id, target_id]
                );
                if (existing.rows.length === 0) {
                    await client.query(
                        `INSERT INTO document_assignments
                        (document_id, doc_type, assigned_to, vai_tro, assigned_by)
                        VALUES ($1, 'incoming', $2, 'biet', $3)`,
                        [id, target_id, userId]
                    );
                    const userRes = await client.query('SELECT full_name FROM users WHERE id = $1', [target_id]);
                    resolvedTargets.push({ name: userRes.rows[0]?.full_name || `ID:${target_id}` });
                }
            }
        }

        // Mark own assignment as read
        await client.query(
            `UPDATE document_assignments
             SET trang_thai = 'hoan_thanh'
             WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'biet'
               AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
            [id, userId]
        );

        await logHistory(client, {
            document_id: id,
            hanh_dong: 'CHUYEN_DE_BIET',
            noi_dung: 'Chuyển xem để biết',
            tu_trang_thai: 'chua_xu_ly',
            den_trang_thai: 'da_xem',
            thuc_hien_boi: userId,
            meta: { receivers: resolvedTargets.map(t => ({ name: t.name, role: 'Để biết' })) }
        });

        await client.query('COMMIT');
        return ok(res, 'Chuyển xem để biết thành công');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('forwardDeBiet error:', error);
        return fail(res, 'Lỗi server', 500);
    } finally {
        if (client) client.release();
    }
};

// ─── GET /all-orgs-de-biet ─── Lấy tất cả phòng ban và user (cho modal chuyển để biết) ──
const getAllOrgsForDeBiet = async (req, res) => {
    try {
        const orgsRes = await db.query(`
            SELECT o.id, un.name as org_name,
                   json_agg(
                       json_build_object('id', u.id, 'name', u.full_name, 'title', COALESCE(up.title, u.role), 'role', u.role)
                       ORDER BY u.full_name
                   ) as users
            FROM organizations o
            JOIN org_unit_names un ON o.name_id = un.id
            JOIN user_positions up ON up.org_id = o.id AND up.is_primary = true
            JOIN users u ON up.user_id = u.id AND u.is_active = true
            WHERE o.is_active = true
            GROUP BY o.id, un.name
            ORDER BY un.name
        `);

        return ok(res, orgsRes.rows);
    } catch (error) {
        console.error('getAllOrgsForDeBiet error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── POST /:id/chuyen-phoi-hop ─── Chuyển phối hợp cho người khác ────────────
const forwardPhoiHop = async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { assignments } = req.body;

        if (!assignments || assignments.length === 0) {
            return fail(res, 'Vui lòng chọn đối tượng để chuyển', 400);
        }

        client = await db.pool.connect();
        await client.query('BEGIN');

        const resolvedTargets = [];

        for (const assign of assignments) {
            const { target_id, target_type } = assign;

            if (target_type === 'org') {
                const usersRes = await client.query(
                    `SELECT u.id, u.full_name, up.title
                     FROM user_positions up JOIN users u ON up.user_id = u.id
                     WHERE up.org_id = $1 AND up.is_primary = true AND u.is_active = true ORDER BY u.full_name`,
                    [target_id]
                );
                for (const user of usersRes.rows) {
                    if (user.id === userId) continue;
                    const existing = await client.query(
                        `SELECT id FROM document_assignments WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'phoi_hop' AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
                        [id, user.id]
                    );
                    if (existing.rows.length === 0) {
                        await client.query(
                            `INSERT INTO document_assignments (document_id, doc_type, org_id, assigned_to, vai_tro, assigned_by) VALUES ($1, 'incoming', $2, $3, 'phoi_hop', $4)`,
                            [id, target_id, user.id, userId]
                        );
                        resolvedTargets.push({ name: user.full_name, title: user.title });
                    }
                }
            } else {
                if (parseInt(target_id) === userId) continue;
                const existing = await client.query(
                    `SELECT id FROM document_assignments WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'phoi_hop' AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
                    [id, target_id]
                );
                if (existing.rows.length === 0) {
                    await client.query(
                        `INSERT INTO document_assignments (document_id, doc_type, assigned_to, vai_tro, assigned_by) VALUES ($1, 'incoming', $2, 'phoi_hop', $3)`,
                        [id, target_id, userId]
                    );
                    const userRes = await client.query('SELECT full_name FROM users WHERE id = $1', [target_id]);
                    resolvedTargets.push({ name: userRes.rows[0]?.full_name || `ID:${target_id}` });
                }
            }
        }

        await client.query(
            `UPDATE document_assignments SET trang_thai = 'da_chuyen_tiep' WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'phoi_hop' AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')`,
            [id, userId]
        );

        await logHistory(client, {
            document_id: id,
            hanh_dong: 'CHUYEN_PHOI_HOP',
            noi_dung: 'Chuyển phối hợp',
            tu_trang_thai: 'dang_xu_ly',
            den_trang_thai: 'da_chuyen_phoi_hop',
            thuc_hien_boi: userId,
            meta: { receivers: resolvedTargets.map(t => ({ name: t.name, role: 'Phối hợp' })) }
        });

        await client.query('COMMIT');
        return ok(res, 'Chuyển phối hợp thành công');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('forwardPhoiHop error:', error);
        return fail(res, 'Lỗi server', 500);
    } finally {
        if (client) client.release();
    }
};

// ─── POST /:id/y-kien-phoi-hop ─── Cho ý kiến phối hợp ─────────────────────
const choYKienPhoiHop = async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { y_kien } = req.body;
        const files = req.files || [];

        if (!y_kien || !y_kien.trim()) {
            return fail(res, 'Vui lòng nhập ý kiến phối hợp', 400);
        }

        client = await db.pool.connect();
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE document_assignments SET trang_thai = 'hoan_thanh'
             WHERE document_id = $1 AND assigned_to = $2 AND vai_tro = 'phoi_hop' AND trang_thai IN ('chua_xu_ly', 'dang_xu_ly')
             RETURNING id`,
            [id, userId]
        );

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return fail(res, 'Không tìm thấy phân công phối hợp', 404);
        }

        const fileMeta = [];
        for (const f of files) {
            await client.query(
                `INSERT INTO document_files (document_id, doc_type, ten_file, duong_dan, loai_file, kich_thuoc, uploaded_by)
                 VALUES ($1, 'incoming_phoi_hop', $2, $3, $4, $5, $6)`,
                [id, f.originalname, f.filename, f.originalname.split('.').pop().toLowerCase(), f.size, userId]
            );
            fileMeta.push({ ten_file: f.originalname, duong_dan: f.filename });
        }

        await logHistory(client, {
            document_id: id,
            hanh_dong: 'Y_KIEN_PHOI_HOP',
            noi_dung: y_kien,
            tu_trang_thai: 'dang_xu_ly',
            den_trang_thai: 'da_cho_y_kien',
            thuc_hien_boi: userId,
            meta: { files: fileMeta }
        });

        await client.query('COMMIT');
        return ok(res, 'Cho ý kiến phối hợp thành công');
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('choYKienPhoiHop error:', error);
        return fail(res, 'Lỗi server', 500);
    } finally {
        if (client) client.release();
    }
};

module.exports = {
    getIncomingDocumentBooks,
    getIncomingDocuments,
    createIncomingDocument,
    getLeaders,
    getDocumentSymbols,
    updateIncomingDocument,
    deleteIncomingDocument,
    getLeaderIncomingDocuments,
    getAssignmentTargets,
    assignDocument,
    getNhanVienIncomingDocuments,
    ketThucXuLy,
    getDocumentHistory,
    getInternalIncomingDocuments,
    markAsKhongVaoSo,
    forwardInternalDocuments,
    getNoiBoForwardTargets,
    ketThucTheoDoi,
    taoDuThaoTuVanBanDen,
    getDuThaoList,
    markDeBietAsRead,
    forwardDeBiet,
    getAllOrgsForDeBiet,
    forwardPhoiHop,
    choYKienPhoiHop
};

