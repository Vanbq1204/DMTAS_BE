const db = require('../config/db');
const logWorkProfileHistory = require('../helpers/logWorkProfileHistory');
const { emitToProfile } = require('../realtime/socket');

const ok = (res, data, msg = 'OK') => res.json({ success: true, message: msg, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });

const ALLOWED_ROLES = new Set(['van_thu', 'lanh_dao', 'nhan_vien']);
const VAI_TRO_MAP = {
    chu_tri: 'Chủ trì',
    phoi_hop: 'Phối hợp',
    phu_trach: 'Phụ trách',
};

const COMMENT_SELECT_SQL = `
    SELECT c.id, c.profile_id, c.user_id, c.vai_tro, c.noi_dung, c.created_at,
           u.full_name, u.chuc_vu AS user_chuc_vu,
           up.title AS position_title,
           o.id AS org_id, o.code AS org_code,
           COALESCE(onm.name, o.code) AS org_name
    FROM work_profile_comments c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
    LEFT JOIN organizations o ON o.id = up.org_id
    LEFT JOIN org_unit_names onm ON onm.id = o.name_id
`;

const toCommentShape = (r) => ({
    id: r.id,
    profileId: r.profile_id,
    userId: r.user_id,
    vaiTro: r.vai_tro,
    vaiTroLabel: VAI_TRO_MAP[r.vai_tro] || r.vai_tro,
    noiDung: r.noi_dung,
    createdAt: r.created_at,
    nguoiDung: {
        fullName: r.full_name || '',
        chucVu: r.position_title || r.user_chuc_vu || '',
        phongBan: r.org_name || '',
        orgId: r.org_id || null,
    },
});

/** Xác định vai trò của user trong hồ sơ */
const getVaiTro = (profile, userId) => {
    const uid = Number(userId);
    if (Number(profile.chu_tri_xu_ly_id) === uid) return 'chu_tri';
    if (Number(profile.lanh_dao_phu_trach_id) === uid) return 'phu_trach';
    const parts = Array.isArray(profile.participants) ? profile.participants : [];
    if (parts.some((p) => Number(p.userId) === uid)) return 'phoi_hop';
    return null;
};

/** GET /ho-so/cong-viec/:id/y-kien */
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
            `${COMMENT_SELECT_SQL} WHERE c.profile_id = $1 ORDER BY c.created_at ASC`,
            [profileId]
        );
        return ok(res, result.rows.map(toCommentShape));
    } catch (e) {
        console.error('workProfileComment list:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/y-kien */
const create = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const profileId = Number(req.params.id);
    const { noiDung } = req.body || {};
    if (!userId || !ALLOWED_ROLES.has(role)) return fail(res, 'Không có quyền.', 403);
    if (!profileId) return fail(res, 'ID hồ sơ không hợp lệ.');
    if (!noiDung || !String(noiDung).trim()) return fail(res, 'Nội dung ý kiến không được để trống.');
    try {
        const profileRes = await db.query(
            `SELECT id, chu_tri_xu_ly_id, lanh_dao_phu_trach_id, participants
             FROM work_profiles WHERE id = $1`,
            [profileId]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        const vaiTro = getVaiTro(profile, userId);
        if (!vaiTro) return fail(res, 'Bạn không tham gia hồ sơ này.', 403);

        const insertRes = await db.query(
            `INSERT INTO work_profile_comments (profile_id, user_id, vai_tro, noi_dung)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [profileId, userId, vaiTro, String(noiDung).trim()]
        );
        const newId = insertRes.rows[0].id;

        const fullRes = await db.query(`${COMMENT_SELECT_SQL} WHERE c.id = $1`, [newId]);
        const comment = toCommentShape(fullRes.rows[0]);

        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'THEM_Y_KIEN',
            noiDung: `${VAI_TRO_MAP[vaiTro] || vaiTro} ghi ý kiến: ${String(noiDung).trim().slice(0, 100)}`,
        });

        emitToProfile(profileId, 'wp:comment:new', comment);
        return ok(res, comment, 'Đã thêm ý kiến.');
    } catch (e) {
        console.error('workProfileComment create:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

module.exports = { list, create };
