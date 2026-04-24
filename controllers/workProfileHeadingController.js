const db = require('../config/db');

const ok = (res, data, msg = 'OK') => res.json({ success: true, message: msg, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });

const normalizeMaKyHieu = (raw) =>
    String(raw || '')
        .normalize('NFC')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase()
        .replace(/[^\p{L}\p{N}]/gu, '');

const list = async (req, res) => {
    const orgId = Number(req.user?.orgId) || null;
    if (!orgId) {
        return fail(res, 'Không xác định được đơn vị người dùng.', 403);
    }
    try {
        const result = await db.query(
            `SELECT id, ten_loai, ma_ky_hieu, thu_tu, is_active, created_at, updated_at, org_id
             FROM work_profile_headings
             WHERE org_id = $1 AND is_active = true
             ORDER BY thu_tu ASC, id ASC`,
            [orgId]
        );
        return ok(res, result.rows);
    } catch (e) {
        console.error('workProfileHeading list:', e);
        return fail(res, 'Lỗi server khi tải danh mục đầu mục hồ sơ', 500);
    }
};

const create = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const orgId = Number(req.user?.orgId) || null;
    if (!userId || !orgId) {
        return fail(res, 'Không xác định được người dùng hoặc đơn vị.', 403);
    }
    if (role !== 'van_thu') {
        return fail(res, 'Chỉ văn thư mới có quyền thêm đầu mục hồ sơ.', 403);
    }
    const { ten_loai, ma_ky_hieu, thu_tu } = req.body || {};
    const ten = String(ten_loai || '').trim();
    const ma = normalizeMaKyHieu(ma_ky_hieu);
    if (!ten || ten.length > 255) return fail(res, 'Tên loại hồ sơ không hợp lệ.');
    if (!ma || ma.length < 2 || ma.length > 32) {
        return fail(res, 'Mã ký hiệu (tiền tố) phải từ 2–32 ký tự chữ/số.');
    }
    const order = Number.isFinite(Number(thu_tu)) ? Number(thu_tu) : 0;
    try {
        const result = await db.query(
            `INSERT INTO work_profile_headings (user_id, role, org_id, created_by_id, ten_loai, ma_ky_hieu, thu_tu)
             VALUES ($1, $2, $3, $1, $4, $5, $6)
             RETURNING id, ten_loai, ma_ky_hieu, thu_tu, is_active, created_at, updated_at`,
            [userId, role, orgId, ten, ma, order]
        );
        return ok(res, result.rows[0], 'Đã tạo đầu mục hồ sơ.');
    } catch (e) {
        if (e.code === '23505') {
            return fail(res, 'Mã ký hiệu này đã tồn tại trong danh mục dùng chung của đơn vị.');
        }
        if (e.code === '42P01') {
            return fail(res, 'Chưa chạy migration bảng work_profile_headings. Vui lòng chạy file migrations/011_work_profile_headings.sql', 500);
        }
        console.error('workProfileHeading create:', e);
        return fail(res, 'Lỗi server khi tạo đầu mục', 500);
    }
};

const update = async (req, res) => {
    const role = req.user?.role;
    const orgId = Number(req.user?.orgId) || null;
    if (!orgId) {
        return fail(res, 'Không xác định được đơn vị người dùng.', 403);
    }
    if (role !== 'van_thu') {
        return fail(res, 'Chỉ văn thư mới có quyền sửa đầu mục hồ sơ.', 403);
    }
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 'ID không hợp lệ.');
    const { ten_loai, ma_ky_hieu, thu_tu } = req.body || {};
    const ten = String(ten_loai || '').trim();
    const ma = normalizeMaKyHieu(ma_ky_hieu);
    if (!ten || ten.length > 255) return fail(res, 'Tên loại hồ sơ không hợp lệ.');
    if (!ma || ma.length < 2 || ma.length > 32) {
        return fail(res, 'Mã ký hiệu (tiền tố) phải từ 2–32 ký tự chữ/số.');
    }
    const order = Number.isFinite(Number(thu_tu)) ? Number(thu_tu) : 0;
    try {
        const result = await db.query(
            `UPDATE work_profile_headings
             SET ten_loai = $1, ma_ky_hieu = $2, thu_tu = $3, updated_at = NOW()
             WHERE id = $4 AND org_id = $5
             RETURNING id, ten_loai, ma_ky_hieu, thu_tu, is_active, created_at, updated_at`,
            [ten, ma, order, id, orgId]
        );
        if (!result.rows.length) return fail(res, 'Không tìm thấy bản ghi hoặc không có quyền.', 404);
        return ok(res, result.rows[0], 'Đã cập nhật.');
    } catch (e) {
        if (e.code === '23505') {
            return fail(res, 'Mã ký hiệu này đã tồn tại trong danh mục dùng chung của đơn vị.');
        }
        console.error('workProfileHeading update:', e);
        return fail(res, 'Lỗi server khi cập nhật', 500);
    }
};

const destroy = async (req, res) => {
    const role = req.user?.role;
    const orgId = Number(req.user?.orgId) || null;
    if (!orgId) {
        return fail(res, 'Không xác định được đơn vị người dùng.', 403);
    }
    if (role !== 'van_thu') {
        return fail(res, 'Chỉ văn thư mới có quyền xóa đầu mục hồ sơ.', 403);
    }
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 'ID không hợp lệ.');
    try {
        const result = await db.query(
            `DELETE FROM work_profile_headings
             WHERE id = $1 AND org_id = $2
             RETURNING id`,
            [id, orgId]
        );
        if (!result.rows.length) return fail(res, 'Không tìm thấy bản ghi hoặc không có quyền.', 404);
        return ok(res, { id }, 'Đã xóa.');
    } catch (e) {
        console.error('workProfileHeading delete:', e);
        return fail(res, 'Lỗi server khi xóa', 500);
    }
};

module.exports = { list, create, update, destroy };
