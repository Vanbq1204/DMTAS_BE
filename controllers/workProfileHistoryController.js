const db = require('../config/db');

const ok = (res, data, msg = 'OK') => res.json({ success: true, message: msg, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });

const ALLOWED_ROLES = new Set(['van_thu', 'lanh_dao', 'nhan_vien']);

const HANH_DONG_LABEL = {
    TAO_HO_SO: 'Tạo hồ sơ',
    CAP_NHAT: 'Cập nhật hồ sơ',
    THEM_Y_KIEN: 'Thêm ý kiến',
    DINH_KEM_FILE: 'Đính kèm file',
    XOA_FILE: 'Xóa file',
    CHUYEN_TRANG_THAI: 'Chuyển trạng thái',
    THEM_NGUOI: 'Phân công / đổi người',
    XOA_NGUOI: 'Xóa người phối hợp',
    DUYET_KET_THUC: 'Duyệt kết thúc',
    LUU_TRU: 'Xác nhận lưu trữ',
    GAN_VAN_BAN: 'Gắn văn bản',
    CAP_NHAT_TIEN_DO: 'Cập nhật tiến độ',
    GIAO_VIEC: 'Giao đầu việc',
    CAP_NHAT_DAU_VIEC: 'Cập nhật đầu việc',
    XOA_DAU_VIEC: 'Xóa đầu việc',
};

/** GET /ho-so/cong-viec/:id/lich-su */
const list = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const profileId = Number(req.params.id);
    if (!userId || !ALLOWED_ROLES.has(role)) return fail(res, 'Không có quyền.', 403);
    if (!profileId) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const profileRes = await db.query(`SELECT id FROM work_profiles WHERE id = $1`, [profileId]);
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);

        const result = await db.query(
            `SELECT h.id, h.profile_id, h.hanh_dong, h.noi_dung,
                    h.tu_trang_thai, h.den_trang_thai, h.thuc_hien_boi,
                    h.meta, h.created_at,
                    u.full_name, u.chuc_vu
             FROM work_profile_history h
             LEFT JOIN users u ON u.id = h.thuc_hien_boi
             WHERE h.profile_id = $1
             ORDER BY h.created_at DESC`,
            [profileId]
        );
        return ok(res, result.rows.map((r) => ({
            id: r.id,
            profileId: r.profile_id,
            hanhDong: r.hanh_dong,
            hanhDongLabel: HANH_DONG_LABEL[r.hanh_dong] || r.hanh_dong,
            noiDung: r.noi_dung,
            tuTrangThai: r.tu_trang_thai,
            denTrangThai: r.den_trang_thai,
            thucHienBoi: r.thuc_hien_boi,
            meta: r.meta || {},
            createdAt: r.created_at,
            nguoiThucHien: { fullName: r.full_name || '', chucVu: r.chuc_vu || '' },
        })));
    } catch (e) {
        console.error('workProfileHistory list:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

module.exports = { list };
