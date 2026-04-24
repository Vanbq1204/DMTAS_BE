const db = require('../config/db');

/**
 * Tính lại % tiến độ của hồ sơ công việc dựa trên số đầu việc đã hoàn thành (đã duyệt).
 *  - Chỉ đếm các task có accept_status <> 'rejected' (không tính các task đã bị từ chối).
 *  - done = số task có trang_thai = 'da_hoan_thanh'
 *  - total = số task hợp lệ
 *  - tien_do = round(done / total * 100). Nếu total = 0 → 0%.
 * Trả về giá trị tien_do mới.
 */
const recomputeWorkProfileProgress = async (profileId) => {
    if (!profileId) return 0;
    const res = await db.query(
        `SELECT
            COUNT(*) FILTER (WHERE accept_status <> 'rejected')                                   AS total,
            COUNT(*) FILTER (WHERE accept_status <> 'rejected' AND trang_thai = 'da_hoan_thanh') AS done
         FROM work_profile_tasks
         WHERE profile_id = $1`,
        [profileId]
    );
    const total = Number(res.rows[0]?.total || 0);
    const done = Number(res.rows[0]?.done || 0);
    const tienDo = total === 0 ? 0 : Math.min(100, Math.max(0, Math.round((done / total) * 100)));
    await db.query(
        `UPDATE work_profiles SET tien_do = $1, updated_at = NOW() WHERE id = $2`,
        [tienDo, profileId]
    );
    return tienDo;
};

module.exports = recomputeWorkProfileProgress;
