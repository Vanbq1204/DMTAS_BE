const db = require('../config/db');
const path = require('path');
const fs   = require('fs');
const mammoth = require('mammoth');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { getObjectBuffer } = require('../utils/minioClient');

/* ──────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────── */
const ok   = (res, data, msg = 'OK') => res.json({ success: true,  message: msg, data });
const fail = (res, msg, code = 400)  => res.status(code).json({ success: false, message: msg });
const onlyOfficeSessions = new Map();

/* ──────────────────────────────────────────────
   KHỞI TẠO / MIGRATE BẢNG
   ────────────────────────────────────────────── */
const initTables = async () => {
    // Bảng lịch sử thao tác dự thảo
    await db.query(`
        CREATE TABLE IF NOT EXISTS van_ban_du_thao_lich_su (
            id                   SERIAL PRIMARY KEY,
            du_thao_id           INTEGER NOT NULL REFERENCES van_ban_du_thao(id) ON DELETE CASCADE,
            hanh_dong            VARCHAR(30) DEFAULT 'LUU',
            y_kien               TEXT,
            nguoi_thuc_hien_id   INTEGER REFERENCES users(id),
            nguoi_nhan_id        INTEGER REFERENCES users(id),
            trang_thai_label     VARCHAR(100) DEFAULT 'Đang soạn thảo',
            file_ids             INTEGER[],
            created_at           TIMESTAMP DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS van_ban_du_thao_chuyen (
            id            SERIAL PRIMARY KEY,
            du_thao_id    INTEGER NOT NULL REFERENCES van_ban_du_thao(id) ON DELETE CASCADE,
            nguoi_gui_id  INTEGER NOT NULL REFERENCES users(id),
            nguoi_nhan_id INTEGER NOT NULL REFERENCES users(id),
            loai_chuyen   VARCHAR(30) NOT NULL DEFAULT 'xu_ly',
            y_kien        TEXT,
            trang_thai    VARCHAR(30) DEFAULT 'cho_xu_ly',
            created_at    TIMESTAMP DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS van_ban_du_thao (
            id                  SERIAL PRIMARY KEY,
            incoming_document_id INTEGER REFERENCES incoming_documents(id),
            ma_du_thao          VARCHAR(50) UNIQUE,
            cap_ban_hanh        VARCHAR(200),
            nguoi_ky_id         INTEGER REFERENCES users(id),
            nguoi_ky_ten        VARCHAR(200),
            chuc_vu             VARCHAR(200),
            loai_van_ban        VARCHAR(100),
            do_khan             VARCHAR(50) DEFAULT 'Thường',
            trich_yeu           TEXT NOT NULL,
            y_kien              TEXT,
            trang_thai          VARCHAR(50) DEFAULT 'dang_soan_thao',
            created_by          INTEGER REFERENCES users(id),
            created_at          TIMESTAMP DEFAULT NOW(),
            updated_at          TIMESTAMP DEFAULT NOW(),
            is_deleted          BOOLEAN DEFAULT false
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS van_ban_du_thao_files (
            id          SERIAL PRIMARY KEY,
            du_thao_id  INTEGER NOT NULL REFERENCES van_ban_du_thao(id) ON DELETE CASCADE,
            loai_tep    VARCHAR(20) NOT NULL,
            ten_file    VARCHAR(500),
            duong_dan   VARCHAR(500),
            kich_thuoc  INTEGER,
            uploaded_by INTEGER REFERENCES users(id),
            uploaded_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // Thêm cột chuc_vu vào bảng users nếu chưa có
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS chuc_vu VARCHAR(200)`);
};

initTables().catch(err => console.error('duThaoController initTables error:', err));

/* ══════════════════════════════════════════════
   DANH SÁCH PHÒNG BAN (dùng cho Cấp ban hành)
   ══════════════════════════════════════════════ */
const getDepartments = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name, code FROM departments WHERE is_active IS DISTINCT FROM false ORDER BY name`
        );
        return ok(res, result.rows);
    } catch (err) {
        // Fallback nếu không có cột is_active
        try {
            const result = await db.query(`SELECT id, name, code FROM departments ORDER BY name`);
            return ok(res, result.rows);
        } catch (e) {
            console.error('getDepartments error:', e);
            return fail(res, 'Lỗi server', 500);
        }
    }
};

/* ══════════════════════════════════════════════
   THÔNG TIN USER HIỆN TẠI (Đơn vị dự thảo)
   ══════════════════════════════════════════════ */
const getMe = async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await db.query(
            `SELECT u.id, u.full_name, u.email, u.role, u.chuc_vu, u.department_id,
                    d.name AS department_name, d.code AS department_code,
                    -- Thử lấy qua user_positions nếu có
                    (SELECT un.name FROM user_positions up
                     JOIN organizations o ON o.id = up.org_id
                     JOIN org_unit_names un ON un.id = o.name_id
                     WHERE up.user_id = u.id AND up.is_primary = true LIMIT 1
                    ) AS org_unit_name
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             WHERE u.id = $1`,
            [userId]
        );
        if (!result.rows.length) return fail(res, 'Không tìm thấy người dùng', 404);
        return ok(res, result.rows[0]);
    } catch (err) {
        console.error('getMe error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   DANH SÁCH LOẠI VĂN BẢN (the_loai mapping)
   ══════════════════════════════════════════════ */
const getLoaiVanBan = async (req, res) => {
    // Danh sách đầy đủ — đồng bộ với mapping trong incomingDocumentController
    const loaiVanBanList = [
        { key: 'cong_van',    label: 'Công văn' },
        { key: 'quyet_dinh',  label: 'Quyết định' },
        { key: 'thong_bao',   label: 'Thông báo' },
        { key: 'bao_cao',     label: 'Báo cáo' },
        { key: 'to_trinh',    label: 'Tờ trình' },
        { key: 'chi_thi',     label: 'Chỉ thị' },
        { key: 'nghi_quyet',  label: 'Nghị quyết' },
        { key: 'bien_ban',    label: 'Biên bản' },
        { key: 'cong_dien',   label: 'Công điện' },
        { key: 'hop_dong',    label: 'Hợp đồng' },
        { key: 'ke_hoach',    label: 'Kế hoạch' },
        { key: 'thong_cao',   label: 'Thông cáo' },
        { key: 'giay_moi',    label: 'Giấy mời' },
        { key: 'huong_dan',   label: 'Hướng dẫn' },
        { key: 'dieu_le',     label: 'Điều lệ' },
        { key: 'quy_che',     label: 'Quy chế' },
        { key: 'quy_dinh',    label: 'Quy định' },
        { key: 'phieu_gui',   label: 'Phiếu gửi' },
        { key: 'don',         label: 'Đơn' },
        { key: 'khac',        label: 'Khác' },
    ];

    // Bổ sung các giá trị có trong DB nhưng chưa có trong danh sách tĩnh
    try {
        const dbRes = await db.query(
            `SELECT DISTINCT the_loai FROM incoming_documents WHERE the_loai IS NOT NULL AND the_loai != '' ORDER BY the_loai`
        );
        const existingKeys = new Set(loaiVanBanList.map(l => l.key));
        for (const row of dbRes.rows) {
            if (!existingKeys.has(row.the_loai)) {
                loaiVanBanList.push({ key: row.the_loai, label: row.the_loai });
            }
        }
    } catch { /* ignore */ }

    return ok(res, loaiVanBanList);
};

/* ──────────────────────────────────────────────
   HELPER: GHI LỊCH SỬ THAO TÁC
   ────────────────────────────────────────────── */
const logLichSu = async (duThaoId, userId, hanhDong, yKien, nguoiNhanId, trangThaiLabel, fileIds = []) => {
    await db.query(
        `INSERT INTO van_ban_du_thao_lich_su
         (du_thao_id, hanh_dong, y_kien, nguoi_thuc_hien_id, nguoi_nhan_id, trang_thai_label, file_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [duThaoId, hanhDong, yKien || null, userId, nguoiNhanId || null, trangThaiLabel,
         fileIds.length ? fileIds : null]
    );
};

const getDuThaoWithPermission = async (duThaoId, userId) => {
    const result = await db.query(
        `SELECT d.*,
                EXISTS (
                    SELECT 1
                    FROM van_ban_du_thao_chuyen c
                    WHERE c.du_thao_id = d.id
                      AND c.nguoi_nhan_id = $2
                      AND c.trang_thai = 'cho_xu_ly'
                ) AS is_active_receiver
         FROM van_ban_du_thao d
         WHERE d.id = $1 AND d.is_deleted = false`,
        [duThaoId, userId]
    );
    if (!result.rows.length) return null;
    const doc = result.rows[0];
    const isSignerInKyDuyet = Number(doc.nguoi_ky_id || 0) === Number(userId) && doc.trang_thai === 'dang_trinh_ky';
    const canEdit = (doc.trang_thai === 'dang_soan_thao' && Number(doc.created_by) === Number(userId))
                 || !!doc.is_active_receiver
                 || isSignerInKyDuyet;
    return { doc, canEdit };
};

const buildOnlyOfficeDocumentType = (ext = '') => {
    if (['.xls', '.xlsx', '.ods', '.csv'].includes(ext)) return 'cell';
    if (['.ppt', '.pptx', '.odp'].includes(ext)) return 'slide';
    return 'word';
};

const makeSafeFileName = (name = 'document.docx') =>
    path.basename(name).replace(/[^\w.\-\u00C0-\u024F\s]/g, '_');

/* ══════════════════════════════════════════════
   ONLYOFFICE CONFIG
   ══════════════════════════════════════════════ */
const getOnlyOfficeConfig = async (req, res) => {
    const userId = req.user.id;
    const userName = req.user.name || `User ${userId}`;
    const { id: duThaoId, fileId } = req.params;
    const yKien = (req.query?.y_kien || '').toString().trim();
    const requestedMode = (req.query?.mode || 'edit').toString().trim().toLowerCase();
    const mode = requestedMode === 'view' ? 'view' : 'edit';

    try {
        const perm = await getDuThaoWithPermission(duThaoId, userId);
        if (!perm) return fail(res, 'Không tìm thấy dự thảo', 404);

        const fileRes = await db.query(
            `SELECT id, du_thao_id, ten_file, duong_dan, uploaded_at
             FROM van_ban_du_thao_files
             WHERE id = $1 AND du_thao_id = $2`,
            [fileId, duThaoId]
        );
        if (!fileRes.rows.length) return fail(res, 'Không tìm thấy tệp', 404);
        const file = fileRes.rows[0];

        const ext = path.extname(file.ten_file || file.duong_dan || '').toLowerCase();
        const canUseOnlyOffice = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(ext);
        if (!canUseOnlyOffice) return fail(res, 'Định dạng này chưa hỗ trợ sửa bằng OnlyOffice', 400);
        if (mode === 'edit' && !perm.canEdit) return fail(res, 'Bạn không có quyền sửa văn bản này', 403);

        const docServerUrl = process.env.ONLYOFFICE_DOCUMENT_SERVER_URL || 'http://localhost:8081';
        const publicFileBaseUrl = process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:8080';
        const callbackBaseUrl = process.env.ONLYOFFICE_CALLBACK_BASE_URL || 'http://host.docker.internal:8080';
        const callbackId = crypto.randomUUID();
        onlyOfficeSessions.set(callbackId, {
            duThaoId: Number(duThaoId),
            fileId: Number(fileId),
            userId: Number(userId),
            yKien: yKien || 'Cập nhật nội dung qua OnlyOffice',
            createdAt: Date.now()
        });

        const uploadedAt = file.uploaded_at ? new Date(file.uploaded_at).getTime() : Date.now();
        const keyRaw = `${file.id}-${uploadedAt}-${file.duong_dan}`;
        const docKey = crypto.createHash('sha256').update(keyRaw).digest('hex').slice(0, 48);
        const documentType = buildOnlyOfficeDocumentType(ext);
        const callbackUrl = `${callbackBaseUrl}/api/onlyoffice/callback/${file.id}?cb_id=${callbackId}`;
        const fileUrl = `${publicFileBaseUrl}/uploads/${encodeURIComponent(file.duong_dan)}`;

        const config = {
            documentType,
            type: 'desktop',
            document: {
                title: file.ten_file,
                url: fileUrl,
                fileType: ext.replace('.', '') || 'docx',
                key: docKey,
                permissions: {
                    edit: mode === 'edit' && !!perm.canEdit,
                    download: true,
                    print: true
                }
            },
            editorConfig: {
                mode: mode === 'edit' && perm.canEdit ? 'edit' : 'view',
                callbackUrl,
                user: { id: String(userId), name: userName },
                customization: { autosave: true, forcesave: true }
            }
        };

        const tokenSecret = process.env.ONLYOFFICE_JWT_SECRET;
        if (tokenSecret) {
            const jwt = require('jsonwebtoken');
            config.token = jwt.sign(config, tokenSecret, { expiresIn: '2h' });
        }

        return ok(res, { ...config, callback_id: callbackId });
    } catch (err) {
        console.error('getOnlyOfficeConfig error:', err);
        return fail(res, `Lỗi lấy cấu hình OnlyOffice: ${err.message}`, 500);
    }
};

const setOnlyOfficeSessionNote = async (req, res) => {
    const userId = Number(req.user.id);
    const { id: duThaoId, fileId } = req.params;
    const cbId = (req.body?.cb_id || '').toString().trim();
    const yKien = (req.body?.y_kien || '').toString().trim();

    if (!cbId) return fail(res, 'Thiếu mã phiên chỉnh sửa', 400);
    const session = onlyOfficeSessions.get(cbId);
    if (!session) return fail(res, 'Phiên chỉnh sửa đã hết hạn, vui lòng mở lại file', 404);

    if (
        Number(session.userId) !== userId ||
        Number(session.duThaoId) !== Number(duThaoId) ||
        Number(session.fileId) !== Number(fileId)
    ) {
        return fail(res, 'Không có quyền cập nhật ý kiến cho phiên này', 403);
    }

    onlyOfficeSessions.set(cbId, {
        ...session,
        yKien: yKien || 'Cập nhật nội dung qua OnlyOffice',
    });
    return ok(res, { cb_id: cbId }, 'Đã cập nhật ý kiến phiên sửa');
};

/* ══════════════════════════════════════════════
   ONLYOFFICE CALLBACK
   ══════════════════════════════════════════════ */
const onlyOfficeCallback = async (req, res) => {
    const { fileId } = req.params;
    const { status, url } = req.body || {};
    const callbackId = req.query?.cb_id;
    const session = callbackId ? onlyOfficeSessions.get(callbackId) : null;

    try {
        if (![2, 6].includes(Number(status)) || !url) {
            return res.json({ error: 0 });
        }

        const fileRes = await db.query(
            `SELECT id, du_thao_id, ten_file, duong_dan, uploaded_by
             FROM van_ban_du_thao_files
             WHERE id = $1`,
            [fileId]
        );
        if (!fileRes.rows.length) return res.json({ error: 0 });
        const file = fileRes.rows[0];

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download callback file thất bại (${response.status})`);
        const buf = Buffer.from(await response.arrayBuffer());

        const currentExt = path.extname(file.ten_file || '').toLowerCase() || '.docx';
        const safeName = makeSafeFileName(file.ten_file || `van-ban${currentExt}`);
        const newStoredName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const newPath = path.join(uploadsDir, newStoredName);
        fs.writeFileSync(newPath, buf);

        const oldPath = path.join(uploadsDir, file.duong_dan);
        if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (_) {}
        }

        await db.query(
            `UPDATE van_ban_du_thao_files
             SET duong_dan = $1,
                 kich_thuoc = $2,
                 uploaded_at = NOW(),
                 uploaded_by = COALESCE($3, uploaded_by)
             WHERE id = $4`,
            [newStoredName, buf.length, session?.userId || null, fileId]
        );

        const docRes = await db.query(`SELECT trang_thai FROM van_ban_du_thao WHERE id = $1`, [file.du_thao_id]);
        const statusLabel = docRes.rows[0]?.trang_thai === 'cho_xu_ly'
            ? 'Đang xử lý'
            : 'Đang soạn thảo';

        if (session?.userId) {
            await logLichSu(
                file.du_thao_id,
                session.userId,
                'SUA_FILE',
                session.yKien || 'Cập nhật qua OnlyOffice',
                null,
                statusLabel,
                [Number(fileId)]
            );
        }

        if (callbackId) onlyOfficeSessions.delete(callbackId);
        return res.json({ error: 0 });
    } catch (err) {
        console.error('onlyOfficeCallback error:', err);
        return res.json({ error: 1 });
    }
};

/* ──────────────────────────────────────────────
   TẠO MÃ DỰ THẢO
   ────────────────────────────────────────────── */
const genMaDuThao = async () => {
    const year = new Date().getFullYear();
    const countRes = await db.query(
        `SELECT COUNT(*) FROM van_ban_du_thao WHERE EXTRACT(YEAR FROM created_at) = $1`, [year]
    );
    const seq = (parseInt(countRes.rows[0].count) + 1).toString().padStart(4, '0');
    return `DT-${year}${seq}`;
};

/* ══════════════════════════════════════════════
   LẤY DANH SÁCH NGƯỜI KÝ (leaders có role lanh_dao)
   ══════════════════════════════════════════════ */
const getNguoiKy = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.full_name, u.email, u.role,
                    up.title    AS chuc_vu,
                    un.name     AS don_vi
             FROM users u
             LEFT JOIN user_positions up ON u.id = up.user_id AND up.is_primary = true
             LEFT JOIN organizations o   ON up.org_id = o.id
             LEFT JOIN org_unit_names un ON o.name_id = un.id
             WHERE u.role IN ('lanh_dao', 'admin') AND u.is_active = true
             ORDER BY u.full_name, up.title`
        );
        return ok(res, result.rows);
    } catch (err) {
        console.error('getNguoiKy error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   TẠO DỰ THẢO MỚI (độc lập hoặc từ văn bản đến)
   ══════════════════════════════════════════════ */
const taoVanBanDuThao = async (req, res) => {
    const userId = req.user.id;
    const {
        cap_ban_hanh, nguoi_ky_id, nguoi_ky_ten, chuc_vu,
        loai_van_ban, do_khan = 'Thường', trich_yeu, y_kien,
        incoming_document_id
    } = req.body;

    if (!trich_yeu?.trim())    return fail(res, 'Trích yếu không được để trống');
    if (!cap_ban_hanh?.trim()) return fail(res, 'Cấp ban hành không được để trống');
    if (!loai_van_ban?.trim()) return fail(res, 'Loại văn bản không được để trống');
    if (!nguoi_ky_ten?.trim()) return fail(res, 'Người ký không được để trống');
    if (!chuc_vu?.trim())      return fail(res, 'Chức vụ không được để trống');

    try {
        const maDuThao = await genMaDuThao();

        const insertRes = await db.query(
            `INSERT INTO van_ban_du_thao
             (incoming_document_id, ma_du_thao, cap_ban_hanh, nguoi_ky_id, nguoi_ky_ten,
              chuc_vu, loai_van_ban, do_khan, trich_yeu, y_kien, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING *`,
            [
                incoming_document_id || null,
                maDuThao, cap_ban_hanh,
                nguoi_ky_id || null, nguoi_ky_ten, chuc_vu,
                loai_van_ban, do_khan, trich_yeu.trim(),
                y_kien || null, userId
            ]
        );

        const duThao = insertRes.rows[0];

        // Lưu file đính kèm nếu có
        // upload.fields() → req.files là object { tep_ban_hanh: [...], tep_kem_theo: [...] }
        const tepBanHanh = (req.files?.tep_ban_hanh) || [];
        const tepKemTheo = (req.files?.tep_kem_theo) || [];

        for (const f of tepBanHanh) {
            await db.query(
                `INSERT INTO van_ban_du_thao_files (du_thao_id, loai_tep, ten_file, duong_dan, kich_thuoc, uploaded_by)
                 VALUES ($1,'ban_hanh',$2,$3,$4,$5)`,
                [duThao.id, f.originalname, f.filename, f.size, userId]
            );
        }
        for (const f of tepKemTheo) {
            await db.query(
                `INSERT INTO van_ban_du_thao_files (du_thao_id, loai_tep, ten_file, duong_dan, kich_thuoc, uploaded_by)
                 VALUES ($1,'kem_theo',$2,$3,$4,$5)`,
                [duThao.id, f.originalname, f.filename, f.size, userId]
            );
        }

        // Ghi lịch sử nếu liên kết văn bản đến
        if (incoming_document_id) {
            await db.query(
                `INSERT INTO document_history (document_id, hanh_dong, noi_dung, thuc_hien_boi, thuc_hien_luc)
                 VALUES ($1,'TAO_DU_THAO',$2,$3,NOW())`,
                [incoming_document_id, `Đã tạo dự thảo ${maDuThao}: ${trich_yeu.trim()}`, userId]
            );
        }

        // Ghi lịch sử dự thảo
        const allFileIds = [];
        const savedFiles = await db.query(`SELECT id FROM van_ban_du_thao_files WHERE du_thao_id=$1`, [duThao.id]);
        savedFiles.rows.forEach(r => allFileIds.push(r.id));
        await logLichSu(duThao.id, userId, 'TAO', y_kien, null, 'Đang soạn thảo', allFileIds);

        return ok(res, duThao, 'Tạo dự thảo thành công');
    } catch (err) {
        console.error('taoVanBanDuThao error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   LẤY DANH SÁCH DỰ THẢO
   ══════════════════════════════════════════════ */
const getDuThaoList = async (req, res) => {
    const userId = req.user.id;
    const { trang_thai } = req.query;

    try {
        let query = `
            SELECT d.*,
                   u.full_name  AS nguoi_soan,
                   dep.name     AS don_vi_soan,
                   inc.so_hieu  AS van_ban_den_so_hieu,
                   inc.trich_yeu AS van_ban_den_trich_yeu,
                   (
                       SELECT json_agg(
                           json_build_object(
                               'id', f.id, 'loai_tep', f.loai_tep,
                               'ten_file', f.ten_file, 'duong_dan', f.duong_dan,
                               'kich_thuoc', f.kich_thuoc
                           )
                       )
                       FROM van_ban_du_thao_files f WHERE f.du_thao_id = d.id
                   ) AS files
            FROM van_ban_du_thao d
            LEFT JOIN users u ON d.created_by = u.id
            LEFT JOIN departments dep ON u.department_id = dep.id
            LEFT JOIN incoming_documents inc ON d.incoming_document_id = inc.id
            WHERE d.created_by = $1 AND d.is_deleted = false
        `;
        const params = [userId];

        if (trang_thai) {
            params.push(trang_thai);
            query += ` AND d.trang_thai = $${params.length}`;
        }

        query += ' ORDER BY d.created_at DESC';

        const result = await db.query(query, params);
        return ok(res, result.rows);
    } catch (err) {
        console.error('getDuThaoList error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   LẤY CHI TIẾT DỰ THẢO
   ══════════════════════════════════════════════ */
const getDuThaoDetail = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    try {
        const result = await db.query(
            `SELECT d.*,
                    u.full_name  AS nguoi_soan,
                    dep.name     AS don_vi_soan,
                    inc.so_hieu  AS van_ban_den_so_hieu,
                    inc.trich_yeu AS van_ban_den_trich_yeu,
                    EXISTS (
                        SELECT 1
                        FROM van_ban_du_thao_chuyen c
                        WHERE c.du_thao_id = d.id
                          AND c.nguoi_nhan_id = $2
                          AND c.trang_thai = 'cho_xu_ly'
                    ) AS is_active_receiver,
                    (
                        SELECT json_agg(json_build_object(
                            'id', f.id, 'loai_tep', f.loai_tep, 'ten_file', f.ten_file,
                            'duong_dan', f.duong_dan, 'kich_thuoc', f.kich_thuoc
                        ) ORDER BY f.uploaded_at)
                        FROM van_ban_du_thao_files f WHERE f.du_thao_id = d.id
                    ) AS files
             FROM van_ban_du_thao d
             LEFT JOIN users u ON d.created_by = u.id
             LEFT JOIN departments dep ON u.department_id = dep.id
             LEFT JOIN incoming_documents inc ON d.incoming_document_id = inc.id
             WHERE d.id = $1 AND d.is_deleted = false
               AND (d.created_by = $2
                    OR d.id IN (
                        SELECT du_thao_id FROM van_ban_du_thao_chuyen
                        WHERE nguoi_nhan_id = $2
                    )
                    OR (d.nguoi_ky_id = $2 AND d.trang_thai = 'dang_trinh_ky')
               )`,
            [id, userId]
        );
        if (!result.rows.length) return fail(res, 'Không tìm thấy dự thảo', 404);
        const doc = result.rows[0];
        // Xác định quyền chỉnh sửa:
        // - Người tạo khi draft đang ở trạng thái dang_soan_thao → được sửa
        // - Người có transfer đang hoạt động (cho_xu_ly trong van_ban_du_thao_chuyen) → được sửa
        //   (bất kể loại chuyển là xu_ly, ky_duyet hay van_thu)
        const can_edit = (doc.trang_thai === 'dang_soan_thao' && Number(doc.created_by) === Number(userId))
                      || !!doc.is_active_receiver
                      || (Number(doc.nguoi_ky_id || 0) === Number(userId) && doc.trang_thai === 'dang_trinh_ky');
        return ok(res, { ...doc, can_edit });
    } catch (err) {
        console.error('getDuThaoDetail error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   PREVIEW FILE DỰ THẢO (mammoth cho DOCX)
   ══════════════════════════════════════════════ */
const previewFileDuThao = async (req, res) => {
    const { fileId } = req.params;
    const userId = req.user.id;
    try {
        const fileResult = await db.query(
            `SELECT f.*, d.created_by
             FROM van_ban_du_thao_files f
             JOIN van_ban_du_thao d ON f.du_thao_id = d.id
             WHERE f.id = $1 AND d.is_deleted = false
               AND (d.created_by = $2 OR d.id IN (
                   SELECT du_thao_id FROM van_ban_du_thao_chuyen WHERE nguoi_nhan_id = $2
               ))`,
            [fileId, userId]
        );
        if (!fileResult.rows.length) return fail(res, 'Không tìm thấy file', 404);
        const file = fileResult.rows[0];
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const filePath   = path.join(uploadsDir, file.duong_dan);
        if (!fs.existsSync(filePath)) return fail(res, 'File không tồn tại trên server', 404);
        const ext = path.extname(file.ten_file || file.duong_dan || '').toLowerCase();
        if (ext === '.docx') {
            try {
                const result = await mammoth.convertToHtml({ path: filePath });
                return ok(res, { type: 'html', content: result.value, ten_file: file.ten_file });
            } catch (convErr) {
                console.warn('previewFileDuThao mammoth convert failed, fallback download:', convErr.message);
                return ok(res, { type: 'download', url: `/uploads/${file.duong_dan}`, ten_file: file.ten_file });
            }
        } else if (ext === '.pdf') {
            return ok(res, { type: 'pdf', url: `/uploads/${file.duong_dan}`, ten_file: file.ten_file });
        } else {
            return ok(res, { type: 'download', url: `/uploads/${file.duong_dan}`, ten_file: file.ten_file });
        }
    } catch (err) {
        console.error('previewFileDuThao error:', err);
        return fail(res, `Lỗi khi xem trước file: ${err.message}`, 500);
    }
};

/* ══════════════════════════════════════════════
   CẬP NHẬT FILE (upload phiên mới + ghi lịch sử)
   ══════════════════════════════════════════════ */
const capNhatFileDuThao = async (req, res) => {
    const { id: duThaoId, fileId } = req.params;
    const userId = req.user.id;
    const y_kien = req.body?.y_kien || '';
    try {
        // Kiểm tra quyền sửa
        const docResult = await db.query(
            `SELECT d.*,
                EXISTS (
                    SELECT 1
                    FROM van_ban_du_thao_chuyen c
                    WHERE c.du_thao_id = d.id
                      AND c.nguoi_nhan_id = $2
                      AND c.trang_thai = 'cho_xu_ly'
                ) AS is_active_receiver
             FROM van_ban_du_thao d WHERE d.id = $1 AND d.is_deleted = false`,
            [duThaoId, userId]
        );
        if (!docResult.rows.length) return fail(res, 'Không tìm thấy dự thảo', 404);
        const doc = docResult.rows[0];
        const canEdit = (doc.trang_thai === 'dang_soan_thao' && Number(doc.created_by) === Number(userId))
                     || !!doc.is_active_receiver;
        if (!canEdit) return fail(res, 'Bạn không có quyền sửa file này', 403);

        let usedFileId = parseInt(fileId);
        if (req.file) {
            // Xoá file cũ trên disk
            const oldFile = await db.query('SELECT duong_dan FROM van_ban_du_thao_files WHERE id = $1', [fileId]);
            if (oldFile.rows.length) {
                const oldPath = path.join(__dirname, '..', 'uploads', oldFile.rows[0].duong_dan);
                if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch(_) {} }
            }
            // Cập nhật record file
            await db.query(
                `UPDATE van_ban_du_thao_files
                 SET ten_file = $1, duong_dan = $2, kich_thuoc = $3, uploaded_at = NOW()
                 WHERE id = $4`,
                [req.file.originalname, req.file.filename, req.file.size, fileId]
            );
        }
        // Ghi lịch sử
        const statusLabel = doc.trang_thai === 'cho_xu_ly'
            ? 'Đang xử lý'
            : 'Đang soạn thảo';
        await logLichSu(duThaoId, userId, 'SUA_FILE', y_kien || '', null, statusLabel, [usedFileId]);
        // Cập nhật updated_at của draft
        await db.query('UPDATE van_ban_du_thao SET updated_at = NOW() WHERE id = $1', [duThaoId]);
        return ok(res, { message: 'Cập nhật file thành công' });
    } catch (err) {
        console.error('capNhatFileDuThao error:', err);
        return fail(res, `Lỗi server: ${err.message}`, 500);
    }
};

/* ══════════════════════════════════════════════
   LỊCH SỬ THAO TÁC DỰ THẢO
   ══════════════════════════════════════════════ */
const getLichSuDuThao = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    try {
        // Kiểm tra quyền truy cập
        const access = await db.query(
            `SELECT 1 FROM van_ban_du_thao
             WHERE id=$1 AND is_deleted=false
             AND (created_by=$2 OR id IN (
                 SELECT du_thao_id FROM van_ban_du_thao_chuyen WHERE nguoi_nhan_id=$2
             ) OR (nguoi_ky_id=$2 AND trang_thai='dang_trinh_ky'))`,
            [id, userId]
        );
        if (!access.rows.length) return fail(res, 'Không có quyền truy cập', 403);

        const result = await db.query(
            `SELECT ls.*,
                    u1.full_name AS nguoi_thuc_hien_ten,
                    u2.full_name AS nguoi_nhan_ten,
                    (
                        SELECT json_agg(json_build_object(
                            'id', f.id, 'loai_tep', f.loai_tep, 'ten_file', f.ten_file,
                            'duong_dan', f.duong_dan, 'kich_thuoc', f.kich_thuoc
                        ))
                        FROM van_ban_du_thao_files f
                        WHERE f.id = ANY(ls.file_ids)
                    ) AS files
             FROM van_ban_du_thao_lich_su ls
             LEFT JOIN users u1 ON ls.nguoi_thuc_hien_id = u1.id
             LEFT JOIN users u2 ON ls.nguoi_nhan_id = u2.id
             WHERE ls.du_thao_id = $1
             ORDER BY ls.created_at DESC`,
            [id]
        );
        return ok(res, result.rows);
    } catch (err) {
        console.error('getLichSuDuThao error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   CẬP NHẬT DỰ THẢO
   ══════════════════════════════════════════════ */
const capNhatDuThao = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const {
        cap_ban_hanh, nguoi_ky_id, nguoi_ky_ten, chuc_vu,
        loai_van_ban, do_khan, trich_yeu, y_kien, trang_thai
    } = req.body;

    try {
        // Kiểm tra quyền (creator hoặc người được giao) + lấy bản ghi hiện tại
        const check = await db.query(
            `SELECT d.id, d.cap_ban_hanh, d.nguoi_ky_id, d.nguoi_ky_ten, d.chuc_vu,
                    d.loai_van_ban, d.do_khan, d.trich_yeu, d.y_kien, d.trang_thai
             FROM van_ban_du_thao d
             WHERE d.id=$1 AND d.is_deleted=false
               AND (
                    (d.trang_thai='dang_soan_thao' AND d.created_by=$2)
                    OR EXISTS (
                        SELECT 1
                        FROM van_ban_du_thao_chuyen c
                        WHERE c.du_thao_id=d.id
                          AND c.nguoi_nhan_id=$2
                          AND c.trang_thai='cho_xu_ly'
                    )
               )`,
            [id, userId]
        );
        if (!check.rows.length) return fail(res, 'Không tìm thấy hoặc không có quyền', 404);
        const current = check.rows[0];

        const nextData = {
            cap_ban_hanh: cap_ban_hanh || current.cap_ban_hanh || null,
            nguoi_ky_id: nguoi_ky_id ? Number(nguoi_ky_id) : current.nguoi_ky_id || null,
            nguoi_ky_ten: nguoi_ky_ten || current.nguoi_ky_ten || null,
            chuc_vu: chuc_vu || current.chuc_vu || null,
            loai_van_ban: loai_van_ban || current.loai_van_ban || null,
            do_khan: do_khan || current.do_khan || null,
            trich_yeu: trich_yeu || current.trich_yeu || null,
            y_kien: y_kien || current.y_kien || null,
            trang_thai: trang_thai || current.trang_thai || null
        };
        const hasFieldChanges =
            nextData.cap_ban_hanh !== (current.cap_ban_hanh || null) ||
            Number(nextData.nguoi_ky_id || 0) !== Number(current.nguoi_ky_id || 0) ||
            nextData.nguoi_ky_ten !== (current.nguoi_ky_ten || null) ||
            nextData.chuc_vu !== (current.chuc_vu || null) ||
            nextData.loai_van_ban !== (current.loai_van_ban || null) ||
            nextData.do_khan !== (current.do_khan || null) ||
            nextData.trich_yeu !== (current.trich_yeu || null) ||
            nextData.y_kien !== (current.y_kien || null) ||
            nextData.trang_thai !== (current.trang_thai || null);

        let updatedDoc = null;
        if (hasFieldChanges) {
            const updateRes = await db.query(
                `UPDATE van_ban_du_thao SET
                    cap_ban_hanh = COALESCE($1, cap_ban_hanh),
                    nguoi_ky_id  = COALESCE($2::integer, nguoi_ky_id),
                    nguoi_ky_ten = COALESCE($3, nguoi_ky_ten),
                    chuc_vu      = COALESCE($4, chuc_vu),
                    loai_van_ban = COALESCE($5, loai_van_ban),
                    do_khan      = COALESCE($6, do_khan),
                    trich_yeu    = COALESCE($7, trich_yeu),
                    y_kien       = COALESCE($8, y_kien),
                    trang_thai   = COALESCE($9, trang_thai),
                    updated_at   = NOW()
                 WHERE id=$10
                 RETURNING *`,
                [
                    cap_ban_hanh || null,
                    nguoi_ky_id || null,
                    nguoi_ky_ten || null,
                    chuc_vu || null,
                    loai_van_ban || null,
                    do_khan || null,
                    trich_yeu || null,
                    y_kien || null,
                    trang_thai || null,
                    id
                ]
            );
            updatedDoc = updateRes.rows[0];
        }

        // Xử lý file mới nếu có (upload.fields → req.files là object)
        const newBanHanh = (req.files?.tep_ban_hanh) || [];
        const newKemTheo = (req.files?.tep_kem_theo) || [];
        const newFileIds = [];
        for (const f of newBanHanh) {
            const ins = await db.query(
                `INSERT INTO van_ban_du_thao_files (du_thao_id,loai_tep,ten_file,duong_dan,kich_thuoc,uploaded_by)
                 VALUES ($1,'ban_hanh',$2,$3,$4,$5) RETURNING id`,
                [id, f.originalname, f.filename, f.size, userId]
            );
            newFileIds.push(ins.rows[0].id);
        }
        for (const f of newKemTheo) {
            const ins = await db.query(
                `INSERT INTO van_ban_du_thao_files (du_thao_id,loai_tep,ten_file,duong_dan,kich_thuoc,uploaded_by)
                 VALUES ($1,'kem_theo',$2,$3,$4,$5) RETURNING id`,
                [id, f.originalname, f.filename, f.size, userId]
            );
            newFileIds.push(ins.rows[0].id);
        }

        // Chỉ ghi lịch sử khi thực sự có thay đổi nội dung/file
        const hasAnyChanges = hasFieldChanges || newFileIds.length > 0;
        const docForResponse = updatedDoc || current;
        if (hasAnyChanges) {
            const trangThaiLabel = docForResponse.trang_thai === 'cho_xu_ly' ? 'Chờ xử lý'
                : docForResponse.trang_thai === 'dang_trinh_ky' ? 'Đang trình ký'
                : 'Đang soạn thảo';
            await logLichSu(id, userId, 'LUU', y_kien, null, trangThaiLabel, newFileIds);
        }

        return ok(res, docForResponse, hasAnyChanges ? 'Cập nhật thành công' : 'Không có thay đổi');
    } catch (err) {
        console.error('capNhatDuThao error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   XOÁ DỰ THẢO (soft delete)
   ══════════════════════════════════════════════ */
const xoaDuThao = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    try {
        const result = await db.query(
            `UPDATE van_ban_du_thao SET is_deleted=true, updated_at=NOW()
             WHERE id=$1 AND created_by=$2 AND is_deleted=false RETURNING id`,
            [id, userId]
        );
        if (!result.rows.length) return fail(res, 'Không tìm thấy hoặc không có quyền', 404);
        return ok(res, { id }, 'Xoá thành công');
    } catch (err) {
        console.error('xoaDuThao error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   XOÁ FILE ĐÍNH KÈM
   ══════════════════════════════════════════════ */
const xoaFileDuThao = async (req, res) => {
    const userId = req.user.id;
    const { id, fileId } = req.params;
    try {
        // Kiểm tra quyền qua du_thao
        const check = await db.query(
            `SELECT f.id FROM van_ban_du_thao_files f
             JOIN van_ban_du_thao d ON f.du_thao_id = d.id
             WHERE f.id=$1 AND d.id=$2 AND d.created_by=$3`,
            [fileId, id, userId]
        );
        if (!check.rows.length) return fail(res, 'Không tìm thấy file hoặc không có quyền', 404);

        await db.query(`DELETE FROM van_ban_du_thao_files WHERE id=$1`, [fileId]);
        return ok(res, { fileId }, 'Xoá file thành công');
    } catch (err) {
        console.error('xoaFileDuThao error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   CÂY ĐƠN VỊ (org tree) + THÀNH VIÊN
   ══════════════════════════════════════════════ */
const getOrgTree = async (req, res) => {
    try {
        const orgs = await db.query(`
            SELECT o.id, o.parent_id, o.code, o.type, o.level, un.name
            FROM organizations o
            JOIN org_unit_names un ON o.name_id = un.id
            WHERE o.is_active IS DISTINCT FROM false
            ORDER BY o.level, un.name
        `);

        const map = {};
        const roots = [];
        orgs.rows.forEach(r => { map[r.id] = { ...r, children: [] }; });
        orgs.rows.forEach(r => {
            if (r.parent_id && map[r.parent_id]) map[r.parent_id].children.push(map[r.id]);
            else roots.push(map[r.id]);
        });
        return ok(res, roots);
    } catch (err) {
        console.error('getOrgTree error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

const getOrgMembers = async (req, res) => {
    const { orgId } = req.params;
    try {
        const result = await db.query(`
            SELECT u.id, u.full_name, u.email, u.role, up.title AS chuc_vu
            FROM user_positions up
            JOIN users u ON u.id = up.user_id
            WHERE up.org_id = $1 AND u.is_active = true
            ORDER BY up.title, u.full_name
        `, [orgId]);
        return ok(res, result.rows);
    } catch (err) {
        console.error('getOrgMembers error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

const extractConvertedFileUrl = (payload) => {
    if (!payload) return '';
    if (typeof payload === 'object') {
        return payload.FileUrl || payload.fileUrl || payload?.response?.fileUrl || '';
    }
    const text = String(payload);
    const m = text.match(/<FileUrl>(.*?)<\/FileUrl>/i);
    return m?.[1] || '';
};

const decodeOnlyOfficeUrl = (url = '') => {
    return String(url)
        .trim()
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
};

const buildSignedDisplayName = (fileName = 'document.pdf') => {
    const ext = path.extname(fileName || '.pdf') || '.pdf';
    const base = path.basename(fileName || `document${ext}`, ext);
    if (/\b(signed|da-ky)\b/i.test(base)) {
        return `${base}${ext}`;
    }
    return `${base}-signed${ext}`;
};

const convertOfficeToPdfViaOnlyOffice = async ({ fileUrl, fileName }) => {
    const docServerUrl = process.env.ONLYOFFICE_DOCUMENT_SERVER_URL || 'http://localhost:8081';
    const body = {
        async: false,
        filetype: (path.extname(fileName || '').replace('.', '') || 'docx').toLowerCase(),
        key: `convert-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        outputtype: 'pdf',
        title: fileName || 'document.docx',
        url: fileUrl,
    };
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ONLYOFFICE_JWT_SECRET) {
        const jwt = require('jsonwebtoken');
        body.token = jwt.sign(body, process.env.ONLYOFFICE_JWT_SECRET, { expiresIn: '10m' });
    }
    const r = await fetch(`${docServerUrl}/ConvertService.ashx`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    const contentType = r.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await r.json() : await r.text();
    let convertedUrl = decodeOnlyOfficeUrl(extractConvertedFileUrl(payload));
    if (!convertedUrl) throw new Error('OnlyOffice không trả về URL file PDF sau convert');
    if (convertedUrl.startsWith('/')) {
        convertedUrl = `${docServerUrl}${convertedUrl}`;
    }

    let pdfRes = await fetch(convertedUrl);
    if (!pdfRes.ok && pdfRes.status === 403 && process.env.ONLYOFFICE_JWT_SECRET) {
        // Một số cấu hình DS yêu cầu token khi tải file đã convert.
        const jwt = require('jsonwebtoken');
        const dlToken = jwt.sign({ url: convertedUrl, action: 'download' }, process.env.ONLYOFFICE_JWT_SECRET, { expiresIn: '5m' });
        pdfRes = await fetch(convertedUrl, {
            headers: {
                Authorization: `Bearer ${dlToken}`,
            },
        });
        if (!pdfRes.ok) {
            const withQuery = convertedUrl.includes('?') ? `${convertedUrl}&token=${encodeURIComponent(dlToken)}` : `${convertedUrl}?token=${encodeURIComponent(dlToken)}`;
            pdfRes = await fetch(withQuery);
        }
    }
    if (!pdfRes.ok) {
        const errorText = await pdfRes.text().catch(() => '');
        throw new Error(`Tải file PDF convert thất bại (${pdfRes.status})${errorText ? `: ${errorText.slice(0, 220)}` : ''}`);
    }
    return Buffer.from(await pdfRes.arrayBuffer());
};

const getSignPreviewPdf = async (req, res) => {
    const userId = req.user.id;
    const { id: duThaoId, fileId } = req.params;
    try {
        const perm = await getDuThaoWithPermission(duThaoId, userId);
        if (!perm) return fail(res, 'Không tìm thấy dự thảo', 404);
        if (perm.doc.trang_thai !== 'dang_trinh_ky') {
            return fail(res, 'Chỉ xem preview ký khi văn bản ở trạng thái đang trình ký', 400);
        }
        if (!(Number(perm.doc.nguoi_ky_id || 0) === Number(userId) || perm.doc.is_active_receiver)) {
            return fail(res, 'Bạn không có quyền ký văn bản này', 403);
        }

        const fileRes = await db.query(
            `SELECT id, du_thao_id, ten_file, duong_dan
             FROM van_ban_du_thao_files
             WHERE id = $1 AND du_thao_id = $2`,
            [fileId, duThaoId]
        );
        if (!fileRes.rows.length) return fail(res, 'Không tìm thấy file', 404);
        const file = fileRes.rows[0];

        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const sourcePath = path.join(uploadsDir, file.duong_dan);
        if (!fs.existsSync(sourcePath)) return fail(res, 'File nguồn không tồn tại', 404);

        const ext = path.extname(file.ten_file || file.duong_dan || '').toLowerCase();
        const isPdf = ext === '.pdf';
        const canConvert = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(ext);

        let pdfBytes;
        if (isPdf) {
            pdfBytes = fs.readFileSync(sourcePath);
        } else if (canConvert) {
            const publicFileBaseUrl = process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:8080';
            const sourceFileUrl = `${publicFileBaseUrl}/uploads/${file.duong_dan}`;
            pdfBytes = await convertOfficeToPdfViaOnlyOffice({ fileUrl: sourceFileUrl, fileName: file.ten_file });
        } else {
            return fail(res, 'Định dạng này chưa hỗ trợ ký/đóng dấu (chỉ hỗ trợ PDF/Word/Excel/PowerPoint)', 400);
        }

        res.setHeader('Content-Type', 'application/pdf');
        // Tránh set filename có ký tự Unicode gây lỗi ERR_INVALID_CHAR ở Node header.
        res.setHeader('Content-Disposition', 'inline');
        return res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('getSignPreviewPdf error:', err);
        return fail(res, `Lỗi tạo preview ký: ${err.message}`, 500);
    }
};

/* ══════════════════════════════════════════════
   KÝ / ĐÓNG DẤU ẢNH LÊN PDF DỰ THẢO
   ══════════════════════════════════════════════ */
const signDuThaoPdfWithAsset = async (req, res) => {
    const userId = req.user.id;
    const { id: duThaoId, fileId } = req.params;
    const {
        asset_id,
        place_mode = 'preset',
        position = 'bottom_right',
        page_index,
        x_ratio,
        y_ratio_top,
        width_ratio,
        margin_x,
        margin_y,
        y_kien,
        action_type = 'signature',
    } = req.body || {};

    if (!asset_id) return fail(res, 'Thiếu tài sản chữ ký/con dấu');

    try {
        const perm = await getDuThaoWithPermission(duThaoId, userId);
        if (!perm) return fail(res, 'Không tìm thấy dự thảo', 404);
        if (perm.doc.trang_thai !== 'dang_trinh_ky') {
            return fail(res, 'Chỉ được ký/đóng dấu khi văn bản ở trạng thái đang trình ký', 400);
        }
        if (!(Number(perm.doc.nguoi_ky_id || 0) === Number(userId) || perm.doc.is_active_receiver)) {
            return fail(res, 'Bạn không có quyền ký văn bản này', 403);
        }

        const fileRes = await db.query(
            `SELECT id, du_thao_id, ten_file, duong_dan
             FROM van_ban_du_thao_files
             WHERE id = $1 AND du_thao_id = $2`,
            [fileId, duThaoId]
        );
        if (!fileRes.rows.length) return fail(res, 'Không tìm thấy file', 404);
        const file = fileRes.rows[0];

        const ext = path.extname(file.ten_file || file.duong_dan || '').toLowerCase();

        const assetRes = await db.query(
            `SELECT id, user_id, asset_type, object_key, mime_type
             FROM user_sign_assets
             WHERE id = $1 AND is_deleted = false`,
            [asset_id]
        );
        if (!assetRes.rows.length) return fail(res, 'Không tìm thấy chữ ký/con dấu', 404);
        const asset = assetRes.rows[0];
        if (Number(asset.user_id) !== Number(userId)) return fail(res, 'Không có quyền dùng tài sản này', 403);

        const uploadsDir = path.join(__dirname, '..', 'uploads');
        const sourcePath = path.join(uploadsDir, file.duong_dan);
        if (!fs.existsSync(sourcePath)) return fail(res, 'File nguồn không tồn tại', 404);

        const canConvert = ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(ext);
        const isPdf = ext === '.pdf';
        let sourcePdfBytes;
        let updateSameFile = true;

        if (isPdf) {
            sourcePdfBytes = fs.readFileSync(sourcePath);
        } else if (canConvert) {
            const publicFileBaseUrl = process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:8080';
            const sourceFileUrl = `${publicFileBaseUrl}/uploads/${file.duong_dan}`;
            sourcePdfBytes = await convertOfficeToPdfViaOnlyOffice({ fileUrl: sourceFileUrl, fileName: file.ten_file });
            updateSameFile = false;
        } else {
            return fail(res, 'Định dạng này chưa hỗ trợ ký/đóng dấu (chỉ hỗ trợ PDF/Word/Excel/PowerPoint)', 400);
        }

        const stampBytes = await getObjectBuffer(asset.object_key);

        const pdfDoc = await PDFDocument.load(sourcePdfBytes);
        const image = (asset.mime_type || '').includes('png')
            ? await pdfDoc.embedPng(stampBytes)
            : await pdfDoc.embedJpg(stampBytes);

        const pages = pdfDoc.getPages();
        const targetIdxRaw = Number.isInteger(Number(page_index)) ? Number(page_index) : (pages.length - 1);
        const targetIdx = Math.max(0, Math.min(targetIdxRaw, pages.length - 1));
        const page = pages[targetIdx];
        const { width: pageWidth, height: pageHeight } = page.getSize();

        const ratio = Math.max(0.08, Math.min(Number(width_ratio) || 0.22, 0.6));
        const drawWidth = pageWidth * ratio;
        const drawHeight = (drawWidth * image.height) / image.width;
        const mx = Number(margin_x) || 30;
        const my = Number(margin_y) || 30;
        const pos = (position || '').toString();

        let x = pageWidth - drawWidth - mx;
        let y = my;
        if (pos === 'bottom_left') {
            x = mx; y = my;
        } else if (pos === 'top_left') {
            x = mx; y = pageHeight - drawHeight - my;
        } else if (pos === 'top_right') {
            x = pageWidth - drawWidth - mx; y = pageHeight - drawHeight - my;
        } else if (pos === 'center') {
            x = (pageWidth - drawWidth) / 2; y = (pageHeight - drawHeight) / 2;
        }
        if ((place_mode || '').toString() === 'coords' && !Number.isNaN(Number(x_ratio)) && !Number.isNaN(Number(y_ratio_top))) {
            const rx = Math.max(0, Math.min(Number(x_ratio), 1));
            const ryTop = Math.max(0, Math.min(Number(y_ratio_top), 1));
            x = rx * pageWidth;
            y = pageHeight - (ryTop * pageHeight) - drawHeight;
            x = Math.max(0, Math.min(x, pageWidth - drawWidth));
            y = Math.max(0, Math.min(y, pageHeight - drawHeight));
        }

        page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
        const outBytes = await pdfDoc.save();

        const sourceName = file.ten_file || file.duong_dan || 'signed.pdf';
        const sourceBaseNoExt = path.basename(sourceName).replace(path.extname(sourceName), '');
        const signedPdfName = buildSignedDisplayName(`${sourceBaseNoExt}.pdf`);
        const newPdfName = signedPdfName;
        const newStoredName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${newPdfName}`;
        const outPath = path.join(uploadsDir, newStoredName);
        fs.writeFileSync(outPath, outBytes);
        let affectedFileId = Number(fileId);
        let affectedTenFile = file.ten_file;

        if (updateSameFile) {
            if (fs.existsSync(sourcePath)) {
                try { fs.unlinkSync(sourcePath); } catch (_) {}
            }
            await db.query(
                `UPDATE van_ban_du_thao_files
                 SET ten_file = $1,
                     duong_dan = $2,
                     kich_thuoc = $3,
                     uploaded_at = NOW(),
                     uploaded_by = $4
                 WHERE id = $5`,
                [newPdfName, newStoredName, outBytes.length, userId, fileId]
            );
            affectedTenFile = newPdfName;
        } else {
            const inserted = await db.query(
                `INSERT INTO van_ban_du_thao_files
                 (du_thao_id, loai_tep, ten_file, duong_dan, kich_thuoc, uploaded_by)
                 VALUES ($1,'ban_hanh',$2,$3,$4,$5)
                 RETURNING id`,
                [duThaoId, newPdfName, newStoredName, outBytes.length, userId]
            );
            affectedFileId = Number(inserted.rows[0].id);
            affectedTenFile = newPdfName;
        }

        const hanhDong = action_type === 'stamp' ? 'DONG_DAU' : 'KY_SO';
        const yKienLog = (y_kien || '').toString().trim() || (action_type === 'stamp' ? 'Đóng dấu lên văn bản' : 'Ký lên văn bản');
        await logLichSu(duThaoId, userId, hanhDong, yKienLog, null, 'Đã ký văn bản', [affectedFileId]);
        await db.query('UPDATE van_ban_du_thao SET updated_at = NOW() WHERE id = $1', [duThaoId]);

        return ok(res, {
            file_id: affectedFileId,
            duong_dan: newStoredName,
            ten_file: affectedTenFile,
            kich_thuoc: outBytes.length,
            action: hanhDong,
            created_new_pdf: !updateSameFile,
        }, 'Ký/đóng dấu thành công');
    } catch (err) {
        console.error('signDuThaoPdfWithAsset error:', err);
        return fail(res, `Lỗi ký/đóng dấu: ${err.message}`, 500);
    }
};

/* ══════════════════════════════════════════════
   CHUYỂN XỬ LÝ / KÝ DUYỆT / VĂN THƯ
   ══════════════════════════════════════════════ */
const chuyenDuThao = async (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    const { nguoi_nhan_id, y_kien, loai_chuyen = 'xu_ly' } = req.body;

    // Map loai_chuyen → trang_thai mới của dự thảo
    const trangThaiMap = {
        xu_ly:    'cho_xu_ly',
        ky_duyet: 'dang_trinh_ky',
        van_thu:  'cho_ban_hanh',
        tra_lai_nguoi_soan: 'bi_tra_lai',
    };
    const trangThaiMoi = trangThaiMap[loai_chuyen] || 'cho_xu_ly';

    try {
        // Kiểm tra quyền: người gửi phải là người tạo HOẶC là người nhận hiện tại
        const check = await db.query(
            `SELECT id, trang_thai, created_by, nguoi_ky_id
             FROM van_ban_du_thao d
             WHERE d.id=$1 AND d.is_deleted=false
               AND (
                    (d.trang_thai='dang_soan_thao' AND d.created_by=$2)
                    OR EXISTS (
                        SELECT 1
                        FROM van_ban_du_thao_chuyen c
                        WHERE c.du_thao_id=d.id
                          AND c.nguoi_nhan_id=$2
                          AND c.trang_thai='cho_xu_ly'
                    )
               )`,
            [id, userId]
        );
        if (!check.rows.length) return fail(res, 'Không tìm thấy hoặc không có quyền', 404);
        const doc = check.rows[0];

        // Với các loại chuyển thông thường, bắt buộc phải chọn người nhận.
        // Riêng "trả lại người soạn" sẽ tự động nhận là người tạo ban đầu.
        let finalNguoiNhanId = nguoi_nhan_id;
        if (loai_chuyen === 'tra_lai_nguoi_soan') {
            finalNguoiNhanId = doc.created_by;
            if (!finalNguoiNhanId) return fail(res, 'Không xác định được người soạn ban đầu');
            if (Number(finalNguoiNhanId) === Number(userId)) {
                return fail(res, 'Bạn đang là người soạn ban đầu, không thể trả lại cho chính mình');
            }
        } else if (loai_chuyen === 'ky_duyet') {
            // Ký duyệt luôn chuyển cho người ký đã chọn ở form dự thảo.
            finalNguoiNhanId = Number(nguoi_nhan_id || 0) || doc.nguoi_ky_id;
            if (!finalNguoiNhanId) return fail(res, 'Chưa chọn người ký cho dự thảo, vui lòng cập nhật thông tin trước');
            if (Number(finalNguoiNhanId) === Number(userId)) {
                return fail(res, 'Người ký đang trùng với người chuyển, vui lòng chọn người ký khác');
            }
            if (!(y_kien || '').toString().trim()) {
                return fail(res, 'Vui lòng nhập ý kiến trước khi chuyển ký duyệt');
            }
        } else if (!finalNguoiNhanId) {
            return fail(res, 'Vui lòng chọn người nhận');
        }

        // Đánh dấu chuyển cũ (nếu có) là đã xử lý
        await db.query(
            `UPDATE van_ban_du_thao_chuyen SET trang_thai='da_xu_ly'
             WHERE du_thao_id=$1 AND nguoi_nhan_id=$2 AND trang_thai='cho_xu_ly'`,
            [id, userId]
        );

        // Tạo bản ghi chuyển mới
        await db.query(
            `INSERT INTO van_ban_du_thao_chuyen
             (du_thao_id, nguoi_gui_id, nguoi_nhan_id, loai_chuyen, y_kien, trang_thai)
             VALUES ($1,$2,$3,$4,$5,'cho_xu_ly')`,
            [id, userId, finalNguoiNhanId, loai_chuyen, y_kien || null]
        );

        // Cập nhật trang_thai của dự thảo
        await db.query(
            `UPDATE van_ban_du_thao SET trang_thai=$1, updated_at=NOW() WHERE id=$2`,
            [trangThaiMoi, id]
        );

        // Ghi lịch sử CHUYỂN
        const trangThaiLabel = loai_chuyen === 'xu_ly' ? 'Chuyển xử lý'
            : loai_chuyen === 'ky_duyet' ? 'Chuyển ký duyệt'
            : loai_chuyen === 'van_thu' ? 'Chuyển văn thư'
            : 'Trả lại người soạn';
        await logLichSu(id, userId, 'CHUYEN', y_kien, finalNguoiNhanId, trangThaiLabel, []);

        return ok(res, { id, trang_thai: trangThaiMoi }, 'Chuyển thành công');
    } catch (err) {
        console.error('chuyenDuThao error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

/* ══════════════════════════════════════════════
   DANH SÁCH DỰ THẢO ĐƯỢC NHẬN (cho_xu_ly)
   Cập nhật getDuThaoList để bao gồm cả nhận
   ══════════════════════════════════════════════ */
const getDuThaoListShared = async (req, res) => {
    const userId = req.user.id;
    const { trang_thai } = req.query;
    try {
        let query = `
            SELECT d.*,
                   u.full_name  AS nguoi_soan,
                   dep.name     AS don_vi_soan,
                   inc.so_hieu  AS van_ban_den_so_hieu,
                   inc.trich_yeu AS van_ban_den_trich_yeu,
                   (
                       SELECT json_agg(json_build_object(
                           'id',f.id,'loai_tep',f.loai_tep,'ten_file',f.ten_file,
                           'duong_dan',f.duong_dan,'kich_thuoc',f.kich_thuoc
                       )) FROM van_ban_du_thao_files f WHERE f.du_thao_id = d.id
                   ) AS files
            FROM van_ban_du_thao d
            LEFT JOIN users u    ON d.created_by = u.id
            LEFT JOIN departments dep ON u.department_id = dep.id
            LEFT JOIN incoming_documents inc ON d.incoming_document_id = inc.id
            WHERE d.is_deleted = false
            AND (
                d.created_by = $1
                OR d.id IN (
                    SELECT du_thao_id FROM van_ban_du_thao_chuyen
                    WHERE nguoi_nhan_id = $1 AND trang_thai = 'cho_xu_ly'
                )
                OR (d.nguoi_ky_id = $1 AND d.trang_thai = 'dang_trinh_ky')
            )
        `;
        const params = [userId];

        if (trang_thai) {
            params.push(trang_thai);
            query += ` AND d.trang_thai = $${params.length}`;
        }

        query += ' ORDER BY d.updated_at DESC, d.created_at DESC';
        const result = await db.query(query, params);
        return ok(res, result.rows);
    } catch (err) {
        console.error('getDuThaoListShared error:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

module.exports = {
    getDepartments,
    getMe,
    getLoaiVanBan,
    getNguoiKy,
    getOrgTree,
    getOrgMembers,
    chuyenDuThao,
    taoVanBanDuThao,
    getDuThaoList: getDuThaoListShared,
    getDuThaoDetail,
    getLichSuDuThao,
    capNhatDuThao,
    xoaDuThao,
    xoaFileDuThao,
    previewFileDuThao,
    capNhatFileDuThao,
    getSignPreviewPdf,
    signDuThaoPdfWithAsset,
    getOnlyOfficeConfig,
    setOnlyOfficeSessionNote,
    onlyOfficeCallback,
};
