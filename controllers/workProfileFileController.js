const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../config/db');
const logWorkProfileHistory = require('../helpers/logWorkProfileHistory');

const ok = (res, data, msg = 'OK') => res.json({ success: true, message: msg, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });

const ALLOWED_ROLES = new Set(['van_thu', 'lanh_dao', 'nhan_vien']);
const ALLOWED_LOAI_FILE = new Set([
    'van_ban_dinh_kem',
    'y_kien_phoi_hop',
    'y_kien_phu_trach',
    'van_ban_den_lien_ket',
    'du_thao_lien_ket',
    'ket_qua_phoi_hop',
    'ket_qua_cuoi',
    'tai_lieu_giao_viec',
    'ket_qua_dau_viec',
]);
const ALLOWED_DOC_TYPE = new Set(['van_ban_den', 'du_thao', 'upload']);

const isParticipant = (profile, userId) => {
    const uid = Number(userId);
    if (Number(profile.chu_tri_xu_ly_id) === uid) return true;
    if (Number(profile.lanh_dao_phu_trach_id) === uid) return true;
    if (Number(profile.created_by_id) === uid) return true;
    const parts = Array.isArray(profile.participants) ? profile.participants : [];
    return parts.some((p) => Number(p.userId) === uid);
};

const clampPercent = (value) => {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
};

const computeAutoTienDo = (participants = []) => {
    const parts = Array.isArray(participants) ? participants : [];
    if (!parts.length) return 0;
    const done = parts.filter((p) => String(p?.status || '').trim() === 'da_nop').length;
    return clampPercent((done / parts.length) * 100);
};

const toFileShape = (r) => ({
    id: r.id,
    profileId: r.profile_id,
    loaiFile: r.loai_file,
    tenFile: r.ten_file,
    duongDan: r.duong_dan,
    kichThuoc: r.kich_thuoc,
    docType: r.doc_type,
    refId: r.ref_id,
    taskId: r.task_id || null,
    taskTieuDe: r.task_tieu_de || '',
    submissionId: r.submission_id || null,
    submissionFinalStatus: r.submission_final_status || null,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    nguoiUpload: { fullName: r.full_name || '', chucVu: r.chuc_vu || '' },
});

/** GET /ho-so/cong-viec/:id/files */
const list = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const profileId = Number(req.params.id);
    const { loaiFile } = req.query;
    if (!userId || !ALLOWED_ROLES.has(role)) return fail(res, 'Không có quyền.', 403);
    if (!profileId) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        let query = `
            SELECT f.*,
                   u.full_name, u.chuc_vu,
                   t.tieu_de AS task_tieu_de,
                   s.final_status AS submission_final_status
            FROM work_profile_files f
            LEFT JOIN users u ON u.id = f.uploaded_by
            LEFT JOIN work_profile_tasks t ON t.id = f.task_id
            LEFT JOIN work_profile_task_submissions s ON s.id = f.submission_id
            WHERE f.profile_id = $1`;
        const params = [profileId];
        if (loaiFile) {
            query += ` AND f.loai_file = $2`;
            params.push(loaiFile);
        }
        query += ` ORDER BY f.uploaded_at DESC`;
        const result = await db.query(query, params);
        return ok(res, result.rows.map(toFileShape));
    } catch (e) {
        console.error('workProfileFile list:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/files — upload file thực tế */
const upload = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const profileId = Number(req.params.id);
    const { loaiFile, taskId } = req.body || {};
    if (!userId || !ALLOWED_ROLES.has(role)) return fail(res, 'Không có quyền.', 403);
    if (!profileId) return fail(res, 'ID hồ sơ không hợp lệ.');
    if (!ALLOWED_LOAI_FILE.has(loaiFile)) return fail(res, 'Loại file không hợp lệ.');
    const files = req.files;
    if (!files || !files.length) return fail(res, 'Không có file nào được tải lên.');
    const resolvedTaskId = taskId ? Number(taskId) : null;
    try {
        const profileRes = await db.query(
            `SELECT id, chu_tri_xu_ly_id, lanh_dao_phu_trach_id, created_by_id, participants, tien_do
             FROM work_profiles WHERE id = $1`,
            [profileId]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        if (!isParticipant(profile, userId)) return fail(res, 'Bạn không tham gia hồ sơ này.', 403);

        const inserted = [];
        for (const file of files) {
            const result = await db.query(
                `INSERT INTO work_profile_files
                    (profile_id, loai_file, ten_file, duong_dan, kich_thuoc, doc_type, uploaded_by, task_id)
                 VALUES ($1, $2, $3, $4, $5, 'upload', $6, $7)
                 RETURNING *`,
                [profileId, loaiFile, file.originalname, file.filename, file.size, userId, resolvedTaskId]
            );
            inserted.push(result.rows[0]);
        }

        if (loaiFile === 'ket_qua_phoi_hop') {
            const currentParts = Array.isArray(profile.participants) ? profile.participants : [];
            const prevAuto = computeAutoTienDo(currentParts);
            const nextParts = currentParts.map((p) => {
                if (Number(p?.userId) !== Number(userId)) return p;
                return { ...p, status: 'da_nop' };
            });
            const nextAuto = computeAutoTienDo(nextParts);
            const currentTienDo = clampPercent(profile.tien_do ?? 0);
            await db.query(
                `UPDATE work_profiles
                 SET participants = $1::jsonb,
                     tien_do = CASE WHEN tien_do = $2 THEN $3 ELSE tien_do END,
                     updated_at = NOW()
                 WHERE id = $4`,
                [JSON.stringify(nextParts), prevAuto, nextAuto, profileId]
            );
            await logWorkProfileHistory({
                profileId,
                userId,
                hanhDong: 'CAP_NHAT_TIEN_DO',
                noiDung: currentTienDo === prevAuto
                    ? `Tự động cập nhật tiến độ theo kết quả phối hợp: ${prevAuto}% → ${nextAuto}%`
                    : 'Đã nộp kết quả phối hợp (không ghi đè tiến độ đang chỉnh tay)',
                meta: { prevAuto, nextAuto, currentTienDo },
            });
        }

        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'DINH_KEM_FILE',
            noiDung: `Đính kèm ${inserted.length} file (loại: ${loaiFile})`,
            meta: { files: inserted.map((f) => f.ten_file) },
        });
        return ok(res, inserted.map(toFileShape), 'Đã tải lên file.');
    } catch (e) {
        console.error('workProfileFile upload:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/gan-van-ban — gắn văn bản đến/dự thảo */
const ganVanBan = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const profileId = Number(req.params.id);
    const { docType, refId, tenFile, loaiFile } = req.body || {};
    if (!userId || !ALLOWED_ROLES.has(role)) return fail(res, 'Không có quyền.', 403);
    if (!profileId) return fail(res, 'ID hồ sơ không hợp lệ.');
    if (!ALLOWED_DOC_TYPE.has(docType)) return fail(res, 'docType không hợp lệ.');
    if (!refId) return fail(res, 'Thiếu refId.');
    const resolvedLoaiFile = ALLOWED_LOAI_FILE.has(loaiFile)
        ? loaiFile
        : docType === 'van_ban_den' ? 'van_ban_den_lien_ket' : 'du_thao_lien_ket';
    try {
        const profileRes = await db.query(
            `SELECT id, chu_tri_xu_ly_id, lanh_dao_phu_trach_id, created_by_id, participants
             FROM work_profiles WHERE id = $1`,
            [profileId]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        if (!isParticipant(profile, userId)) return fail(res, 'Bạn không tham gia hồ sơ này.', 403);

        const existing = await db.query(
            `SELECT id FROM work_profile_files
             WHERE profile_id = $1 AND doc_type = $2 AND ref_id = $3`,
            [profileId, docType, Number(refId)]
        );
        if (existing.rows.length) return fail(res, 'Văn bản này đã được gắn vào hồ sơ.');

        const result = await db.query(
            `INSERT INTO work_profile_files
                (profile_id, loai_file, ten_file, doc_type, ref_id, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [profileId, resolvedLoaiFile, tenFile || '', docType, Number(refId), userId]
        );
        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'GAN_VAN_BAN',
            noiDung: `Gắn ${docType === 'van_ban_den' ? 'văn bản đến' : 'dự thảo'} ID ${refId} vào hồ sơ`,
            meta: { docType, refId, tenFile },
        });
        return ok(res, toFileShape(result.rows[0]), 'Đã gắn văn bản vào hồ sơ.');
    } catch (e) {
        console.error('workProfileFile ganVanBan:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** DELETE /ho-so/cong-viec/:id/files/:fileId */
const remove = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const profileId = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    if (!userId || !ALLOWED_ROLES.has(role)) return fail(res, 'Không có quyền.', 403);
    if (!profileId || !fileId) return fail(res, 'ID không hợp lệ.');
    try {
        const fileRes = await db.query(
            `SELECT id, ten_file, duong_dan, doc_type, uploaded_by FROM work_profile_files
             WHERE id = $1 AND profile_id = $2`,
            [fileId, profileId]
        );
        if (!fileRes.rows.length) return fail(res, 'Không tìm thấy file.', 404);
        const file = fileRes.rows[0];
        if (Number(file.uploaded_by) !== Number(userId)) {
            return fail(res, 'Chỉ người tải lên mới được xóa file.', 403);
        }
        await db.query(`DELETE FROM work_profile_files WHERE id = $1`, [fileId]);
        if (file.doc_type === 'upload' && file.duong_dan) {
            const filePath = path.join(__dirname, '../uploads', file.duong_dan);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'XOA_FILE',
            noiDung: `Xóa file: ${file.ten_file}`,
        });
        return ok(res, { id: fileId }, 'Đã xóa file.');
    } catch (e) {
        console.error('workProfileFile remove:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/* ══════════════════════════════════════════════
 *  GET /ho-so/cong-viec/:id/files/:fileId/onlyoffice-config (view-only)
 * ══════════════════════════════════════════════ */
const getOnlyOfficeViewConfig = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const profileId = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    if (!userId || !ALLOWED_ROLES.has(role)) return fail(res, 'Không có quyền.', 403);
    if (!profileId || !fileId) return fail(res, 'ID không hợp lệ.');
    try {
        // Kiểm tra quyền: phải là participant của hồ sơ
        const profileRes = await db.query(
            `SELECT id, chu_tri_xu_ly_id, lanh_dao_phu_trach_id, created_by_id, participants
             FROM work_profiles WHERE id = $1`,
            [profileId]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        if (!isParticipant(profileRes.rows[0], userId)) {
            return fail(res, 'Bạn không tham gia hồ sơ này.', 403);
        }

        const fileRes = await db.query(
            `SELECT id, ten_file, duong_dan, uploaded_at, doc_type
             FROM work_profile_files
             WHERE id = $1 AND profile_id = $2`,
            [fileId, profileId]
        );
        if (!fileRes.rows.length) return fail(res, 'Không tìm thấy file.', 404);
        const file = fileRes.rows[0];
        if (file.doc_type !== 'upload' || !file.duong_dan) {
            return fail(res, 'File này là văn bản liên kết, mở trực tiếp tại tab văn bản.');
        }

        const ext = path.extname(file.ten_file || file.duong_dan || '').toLowerCase();
        const documentType = (['.xls', '.xlsx', '.ods', '.csv'].includes(ext)) ? 'cell'
            : (['.ppt', '.pptx', '.odp'].includes(ext)) ? 'slide' : 'word';

        const docServerUrl = process.env.ONLYOFFICE_DOCUMENT_SERVER_URL || 'http://localhost:8081';
        const publicFileBaseUrl = process.env.PUBLIC_FILE_BASE_URL || 'http://localhost:8080';
        const uploadedAt = file.uploaded_at ? new Date(file.uploaded_at).getTime() : Date.now();
        const keyRaw = `wp-${file.id}-${uploadedAt}-${file.duong_dan}`;
        const docKey = crypto.createHash('sha256').update(keyRaw).digest('hex').slice(0, 48);
        const fileUrl = `${publicFileBaseUrl}/uploads/${encodeURIComponent(file.duong_dan)}`;

        const userName = req.user.name || `User ${userId}`;
        const config = {
            documentType,
            type: 'desktop',
            document: {
                title: file.ten_file,
                url: fileUrl,
                fileType: ext.replace('.', '') || 'docx',
                key: docKey,
                permissions: { edit: false, download: true, print: true, comment: false, review: false },
            },
            editorConfig: {
                mode: 'view',
                user: { id: String(userId), name: userName },
                customization: { autosave: false, forcesave: false, hideRightMenu: true },
            },
        };

        const tokenSecret = process.env.ONLYOFFICE_JWT_SECRET;
        if (tokenSecret) {
            const jwt = require('jsonwebtoken');
            config.token = jwt.sign(config, tokenSecret, { expiresIn: '2h' });
        }

        return ok(res, config);
    } catch (e) {
        console.error('workProfileFile getOnlyOfficeViewConfig:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

module.exports = { list, upload, ganVanBan, remove, getOnlyOfficeViewConfig };
