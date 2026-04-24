const db = require('../config/db');

/**
 * Ghi log lịch sử thao tác trên hồ sơ công việc.
 *
 * @param {object} opts
 * @param {number}  opts.profileId     - ID hồ sơ
 * @param {number}  opts.userId        - ID người thực hiện
 * @param {string}  opts.hanhDong      - Tên hành động (TAO_HO_SO, CAP_NHAT, THEM_Y_KIEN, ...)
 * @param {string}  [opts.noiDung]     - Mô tả chi tiết
 * @param {string}  [opts.tuTrangThai] - Trạng thái trước khi thay đổi
 * @param {string}  [opts.denTrangThai]- Trạng thái sau khi thay đổi
 * @param {object}  [opts.meta]        - Dữ liệu bổ sung (JSON)
 */
const logWorkProfileHistory = async ({ profileId, userId, hanhDong, noiDung = null, tuTrangThai = null, denTrangThai = null, meta = {} }) => {
    try {
        await db.query(
            `INSERT INTO work_profile_history
                (profile_id, hanh_dong, noi_dung, tu_trang_thai, den_trang_thai, thuc_hien_boi, meta)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [profileId, hanhDong, noiDung, tuTrangThai, denTrangThai, userId, JSON.stringify(meta)]
        );
    } catch (e) {
        console.error('[logWorkProfileHistory] Error logging history:', e.message);
    }
};

module.exports = logWorkProfileHistory;
