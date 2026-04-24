const path = require('path');
const db = require('../config/db');
const logWorkProfileHistory = require('../helpers/logWorkProfileHistory');
const recomputeWorkProfileProgress = require('../helpers/recomputeWorkProfileProgress');

const ok = (res, data, msg = 'OK') => res.json({ success: true, message: msg, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });

const ALLOWED_STATUS = new Set(['chua_xu_ly', 'dang_xu_ly', 'cho_duyet', 'da_hoan_thanh', 'tu_choi']);
const ALLOWED_ASSIGNEE = new Set(['ca_nhan', 'phong_ban']);
const ALLOWED_ACCEPT = new Set(['pending', 'accepted', 'rejected']);

const STATUS_LABEL = {
    chua_xu_ly:   'Chưa xử lý',
    dang_xu_ly:   'Đang xử lý',
    cho_duyet:    'Chờ duyệt',
    da_hoan_thanh:'Đã hoàn thành',
    tu_choi:      'Từ chối',
};

/** Resolve đại diện phòng ban theo users.is_representative + user_positions.is_primary */
const resolveOrgRepresentative = async (orgId) => {
    const result = await db.query(
        `SELECT u.id, u.full_name, u.role, up.title
         FROM user_positions up
         JOIN users u ON up.user_id = u.id
         WHERE up.org_id = $1
           AND up.is_primary = true
           AND u.is_active = true
           AND COALESCE(u.is_representative, false) = true
         ORDER BY up.permission_level DESC, u.id ASC
         LIMIT 1`,
        [orgId]
    );
    return result.rows[0] || null;
};

const canManageTasks = (profile, userId) => (
    Number(profile.chu_tri_xu_ly_id) === Number(userId)
    || Number(profile.lanh_dao_phu_trach_id) === Number(userId)
);

const roleOnProfile = (profile, userId) => {
    const uid = Number(userId);
    if (Number(profile.chu_tri_xu_ly_id) === uid) return 'chu_tri';
    if (Number(profile.lanh_dao_phu_trach_id) === uid) return 'phu_trach';
    return null;
};

const isAssignee = (task, userId) => Number(task.assigned_user_id) === Number(userId);

const toISODate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
        const s = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return '';
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
};

const toClientShape = (row) => ({
    id: row.id,
    profileId: row.profile_id,
    tieuDe: row.tieu_de || '',
    moTa: row.mo_ta || '',
    nguoiGiaoId: row.nguoi_giao_id || null,
    nguoiGiao: {
        id: row.nguoi_giao_id || null,
        fullName: row.nguoi_giao_name || '',
        chucVu: row.nguoi_giao_chuc_vu || '',
    },
    assigneeType: row.assignee_type,
    assignedUserId: row.assigned_user_id || null,
    assignedUser: {
        id: row.assigned_user_id || null,
        fullName: row.assigned_user_name || '',
        chucVu: row.assigned_user_chuc_vu || '',
    },
    assignedOrgId: row.assigned_org_id || null,
    assignedOrg: {
        id: row.assigned_org_id || null,
        code: row.assigned_org_code || '',
        name: row.assigned_org_name || '',
    },
    hanXuLy: toISODate(row.han_xu_ly),
    trangThai: row.trang_thai,
    trangThaiLabel: STATUS_LABEL[row.trang_thai] || row.trang_thai,
    ketQua: row.ket_qua || '',
    ngayHoanThanh: toISODate(row.ngay_hoan_thanh),
    acceptStatus: row.accept_status || 'pending',
    acceptedAt: row.accepted_at || null,
    rejectedAt: row.rejected_at || null,
    rejectedReason: row.rejected_reason || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const SELECT_TASK_SQL = `
    SELECT t.*,
           ug.full_name AS nguoi_giao_name,
           upg.title    AS nguoi_giao_chuc_vu,
           ua.full_name AS assigned_user_name,
           upa.title    AS assigned_user_chuc_vu,
           o.code       AS assigned_org_code,
           COALESCE(onm.name, o.code) AS assigned_org_name
    FROM work_profile_tasks t
    LEFT JOIN users ug ON ug.id = t.nguoi_giao_id
    LEFT JOIN user_positions upg ON upg.user_id = ug.id AND upg.is_primary = true
    LEFT JOIN users ua ON ua.id = t.assigned_user_id
    LEFT JOIN user_positions upa ON upa.user_id = ua.id AND upa.is_primary = true
    LEFT JOIN organizations o ON o.id = t.assigned_org_id
    LEFT JOIN org_unit_names onm ON onm.id = o.name_id
`;

/** Lấy toàn bộ submissions của một task (kèm file + user info của submitter/reviewer). */
const fetchSubmissionsForTask = async (taskId) => {
    const subRes = await db.query(
        `SELECT s.*,
                us.full_name AS submitter_name, us.chuc_vu AS submitter_chuc_vu,
                ucr.full_name AS chu_tri_name,
                upr.full_name AS phu_trach_name
         FROM work_profile_task_submissions s
         LEFT JOIN users us  ON us.id  = s.submitted_by_id
         LEFT JOIN users ucr ON ucr.id = s.chu_tri_reviewer_id
         LEFT JOIN users upr ON upr.id = s.phu_trach_reviewer_id
         WHERE s.task_id = $1
         ORDER BY s.created_at ASC, s.id ASC`,
        [taskId]
    );
    const submissions = subRes.rows;
    if (!submissions.length) return [];
    const ids = submissions.map((s) => s.id);
    const fileRes = await db.query(
        `SELECT f.id, f.submission_id, f.ten_file, f.duong_dan, f.kich_thuoc, f.uploaded_at
         FROM work_profile_files f
         WHERE f.submission_id = ANY($1::int[])
         ORDER BY f.uploaded_at ASC`,
        [ids]
    );
    const filesBySub = new Map();
    fileRes.rows.forEach((f) => {
        const k = Number(f.submission_id);
        if (!filesBySub.has(k)) filesBySub.set(k, []);
        filesBySub.get(k).push({
            id: f.id,
            tenFile: f.ten_file,
            duongDan: f.duong_dan,
            kichThuoc: f.kich_thuoc,
            uploadedAt: f.uploaded_at,
        });
    });
    return submissions.map((s) => ({
        id: s.id,
        taskId: s.task_id,
        submittedById: s.submitted_by_id,
        submitter: { id: s.submitted_by_id, fullName: s.submitter_name || '', chucVu: s.submitter_chuc_vu || '' },
        noiDung: s.noi_dung || '',
        chuTri: {
            status: s.chu_tri_status,
            reviewerId: s.chu_tri_reviewer_id,
            reviewerName: s.chu_tri_name || '',
            comment: s.chu_tri_comment || '',
            reviewedAt: s.chu_tri_reviewed_at,
        },
        phuTrach: {
            status: s.phu_trach_status,
            reviewerId: s.phu_trach_reviewer_id,
            reviewerName: s.phu_trach_name || '',
            comment: s.phu_trach_comment || '',
            reviewedAt: s.phu_trach_reviewed_at,
        },
        finalStatus: s.final_status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        files: filesBySub.get(s.id) || [],
    }));
};

/** Lấy file đính kèm lúc giao việc (loai_file='tai_lieu_giao_viec'). */
const fetchAssignmentAttachments = async (taskIds) => {
    if (!taskIds.length) return new Map();
    const res = await db.query(
        `SELECT id, task_id, ten_file, duong_dan, kich_thuoc, uploaded_at, loai_file
         FROM work_profile_files
         WHERE task_id = ANY($1::int[])
           AND loai_file = 'tai_lieu_giao_viec'
         ORDER BY uploaded_at ASC`,
        [taskIds]
    );
    const byTask = new Map();
    res.rows.forEach((r) => {
        const k = Number(r.task_id);
        if (!byTask.has(k)) byTask.set(k, []);
        byTask.get(k).push({
            id: r.id,
            taskId: r.task_id,
            tenFile: r.ten_file,
            duongDan: r.duong_dan,
            kichThuoc: r.kich_thuoc,
            loaiFile: r.loai_file,
            uploadedAt: r.uploaded_at,
        });
    });
    return byTask;
};

/** Gắn submissions + attachments vào các task. */
const attachSubmissions = async (taskRows) => {
    const shapes = taskRows.map(toClientShape);
    if (!shapes.length) return shapes;
    const taskIds = shapes.map((s) => s.id);
    const attachmentsByTask = await fetchAssignmentAttachments(taskIds);
    await Promise.all(shapes.map(async (sh) => {
        sh.submissions = await fetchSubmissionsForTask(sh.id);
        sh.attachmentFiles = attachmentsByTask.get(Number(sh.id)) || [];
    }));
    return shapes;
};

/** Đồng bộ: thêm user vào participants nếu chưa có (status = 'chua_xu_ly') */
const syncParticipant = async (profileId, userId, extra = {}) => {
    if (!userId) return;
    const profileRes = await db.query(
        `SELECT participants FROM work_profiles WHERE id = $1`,
        [profileId]
    );
    if (!profileRes.rows.length) return;
    const current = Array.isArray(profileRes.rows[0].participants) ? profileRes.rows[0].participants : [];
    if (current.some((p) => Number(p.userId) === Number(userId))) return;

    const userMeta = await db.query(
        `SELECT u.full_name, u.role, up.title
         FROM users u
         LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
         WHERE u.id = $1
         LIMIT 1`,
        [userId]
    );
    const info = userMeta.rows[0] || {};
    const next = [
        ...current,
        {
            userId: Number(userId),
            name: info.full_name || '',
            role: info.role || '',
            chucVu: info.title || '',
            status: 'chua_xu_ly',
            request: extra.request || '',
            deadline: extra.deadline || '',
        },
    ];
    await db.query(
        `UPDATE work_profiles SET participants = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(next), profileId]
    );
};

/** Cập nhật trường status của participant. */
const updateParticipantStatus = async (profileId, userId, status) => {
    if (!userId) return;
    const profileRes = await db.query(
        `SELECT participants FROM work_profiles WHERE id = $1`,
        [profileId]
    );
    if (!profileRes.rows.length) return;
    const current = Array.isArray(profileRes.rows[0].participants) ? profileRes.rows[0].participants : [];
    const next = current.map((p) =>
        Number(p?.userId) === Number(userId) ? { ...p, status } : p
    );
    await db.query(
        `UPDATE work_profiles SET participants = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(next), profileId]
    );
};

/** GET /ho-so/cong-viec/:id/nhiem-vu */
const list = async (req, res) => {
    const profileId = Number(req.params.id);
    if (!profileId) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const result = await db.query(
            `${SELECT_TASK_SQL} WHERE t.profile_id = $1 ORDER BY t.created_at DESC, t.id DESC`,
            [profileId]
        );
        const shapes = await attachSubmissions(result.rows);
        return ok(res, shapes);
    } catch (e) {
        if (e.code === '42P01') {
            return fail(res, 'Chưa chạy migration 021_work_profile_tasks.sql.', 500);
        }
        console.error('workProfileTask list:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/nhiem-vu */
const create = async (req, res) => {
    const userId = req.user?.id;
    const profileId = Number(req.params.id);
    const { tieuDe, moTa, hanXuLy, assigneeType, assignedUserId, assignedOrgId } = req.body || {};

    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!profileId) return fail(res, 'ID hồ sơ không hợp lệ.');
    if (!String(tieuDe || '').trim()) return fail(res, 'Thiếu tiêu đề đầu việc.');
    if (!ALLOWED_ASSIGNEE.has(assigneeType)) return fail(res, 'Loại người nhận không hợp lệ.');

    try {
        const profileRes = await db.query(
            `SELECT id, chu_tri_xu_ly_id, lanh_dao_phu_trach_id
             FROM work_profiles WHERE id = $1`,
            [profileId]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        if (!canManageTasks(profile, userId)) {
            return fail(res, 'Chỉ chủ trì hoặc lãnh đạo phụ trách được tạo đầu việc.', 403);
        }

        let resolvedUserId = null;
        let resolvedOrgId = null;
        if (assigneeType === 'ca_nhan') {
            if (!assignedUserId) return fail(res, 'Vui lòng chọn cá nhân nhận đầu việc.');
            resolvedUserId = Number(assignedUserId);
        } else {
            if (!assignedOrgId) return fail(res, 'Vui lòng chọn phòng ban nhận đầu việc.');
            resolvedOrgId = Number(assignedOrgId);
            const representative = await resolveOrgRepresentative(resolvedOrgId);
            if (!representative) {
                return fail(res, 'Phòng ban chưa có đại diện (cờ is_representative). Vui lòng cấu hình đại diện trước.');
            }
            resolvedUserId = representative.id;
        }

        const hanIso = hanXuLy ? toISODate(hanXuLy) : null;

        const insertRes = await db.query(
            `INSERT INTO work_profile_tasks
                (profile_id, tieu_de, mo_ta, nguoi_giao_id,
                 assignee_type, assigned_user_id, assigned_org_id, han_xu_ly,
                 accept_status, trang_thai)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 'chua_xu_ly')
             RETURNING id`,
            [
                profileId,
                String(tieuDe).trim(),
                String(moTa || '').trim(),
                userId,
                assigneeType,
                resolvedUserId,
                resolvedOrgId,
                hanIso,
            ]
        );
        const newId = insertRes.rows[0].id;

        await syncParticipant(profileId, resolvedUserId, { deadline: hanIso || '' });
        await recomputeWorkProfileProgress(profileId);

        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'GIAO_VIEC',
            noiDung: assigneeType === 'ca_nhan'
                ? `Giao đầu việc: ${String(tieuDe).trim()}`
                : `Giao đầu việc cho phòng ban (đại diện nhận): ${String(tieuDe).trim()}`,
            meta: { taskId: newId, assigneeType, assignedUserId: resolvedUserId, assignedOrgId: resolvedOrgId },
        });

        const full = await db.query(`${SELECT_TASK_SQL} WHERE t.id = $1`, [newId]);
        const shapes = await attachSubmissions(full.rows);
        return ok(res, shapes[0], 'Đã giao đầu việc.');
    } catch (e) {
        if (e.code === '42P01') {
            return fail(res, 'Chưa chạy migration 021_work_profile_tasks.sql.', 500);
        }
        console.error('workProfileTask create:', e);
        return fail(res, 'Lỗi server khi tạo đầu việc.', 500);
    }
};

/** PATCH /ho-so/cong-viec/:id/nhiem-vu/:taskId (chỉ cho manager sửa thông tin) */
const update = async (req, res) => {
    const userId = req.user?.id;
    const profileId = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!profileId || !taskId) return fail(res, 'ID không hợp lệ.');

    try {
        const taskRes = await db.query(
            `SELECT t.*, p.chu_tri_xu_ly_id, p.lanh_dao_phu_trach_id
             FROM work_profile_tasks t
             JOIN work_profiles p ON p.id = t.profile_id
             WHERE t.id = $1 AND t.profile_id = $2`,
            [taskId, profileId]
        );
        if (!taskRes.rows.length) return fail(res, 'Không tìm thấy đầu việc.', 404);
        const task = taskRes.rows[0];

        const isManager = canManageTasks(task, userId);
        if (!isManager) {
            return fail(res, 'Chỉ chủ trì hoặc lãnh đạo phụ trách được chỉnh sửa đầu việc.', 403);
        }

        const body = req.body || {};
        const updates = [];
        const params = [];
        let idx = 1;

        if (body.tieuDe !== undefined) {
            updates.push(`tieu_de = $${idx++}`); params.push(String(body.tieuDe).trim());
        }
        if (body.moTa !== undefined) {
            updates.push(`mo_ta = $${idx++}`); params.push(String(body.moTa || '').trim());
        }
        if (body.hanXuLy !== undefined) {
            updates.push(`han_xu_ly = $${idx++}`); params.push(body.hanXuLy ? toISODate(body.hanXuLy) : null);
        }
        if (body.assigneeType !== undefined || body.assignedUserId !== undefined || body.assignedOrgId !== undefined) {
            const nextAssigneeType = body.assigneeType || task.assignee_type;
            if (!ALLOWED_ASSIGNEE.has(nextAssigneeType)) return fail(res, 'Loại người nhận không hợp lệ.');
            let nextUserId = null;
            let nextOrgId = null;
            if (nextAssigneeType === 'ca_nhan') {
                nextUserId = Number(body.assignedUserId || task.assigned_user_id);
                if (!nextUserId) return fail(res, 'Vui lòng chọn cá nhân nhận đầu việc.');
            } else {
                nextOrgId = Number(body.assignedOrgId || task.assigned_org_id);
                if (!nextOrgId) return fail(res, 'Vui lòng chọn phòng ban nhận đầu việc.');
                const representative = await resolveOrgRepresentative(nextOrgId);
                if (!representative) return fail(res, 'Phòng ban chưa có đại diện.');
                nextUserId = representative.id;
            }
            updates.push(`assignee_type = $${idx++}`);    params.push(nextAssigneeType);
            updates.push(`assigned_user_id = $${idx++}`); params.push(nextUserId);
            updates.push(`assigned_org_id = $${idx++}`);  params.push(nextOrgId);

            // Nếu đổi người nhận → reset trạng thái nhận việc
            if (Number(nextUserId) !== Number(task.assigned_user_id)) {
                updates.push(`accept_status = 'pending'`);
                updates.push(`accepted_at = NULL`);
                updates.push(`rejected_at = NULL`);
                updates.push(`rejected_reason = NULL`);
                updates.push(`trang_thai = 'chua_xu_ly'`);
            }
            await syncParticipant(profileId, nextUserId);
        }

        if (!updates.length) return fail(res, 'Không có thay đổi nào.');
        updates.push(`updated_at = NOW()`);
        params.push(taskId);

        await db.query(
            `UPDATE work_profile_tasks SET ${updates.join(', ')} WHERE id = $${idx}`,
            params
        );
        await recomputeWorkProfileProgress(profileId);

        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'CAP_NHAT_DAU_VIEC',
            noiDung: `Cập nhật đầu việc #${taskId}`,
            meta: { taskId },
        });

        const full = await db.query(`${SELECT_TASK_SQL} WHERE t.id = $1`, [taskId]);
        const shapes = await attachSubmissions(full.rows);
        return ok(res, shapes[0], 'Đã cập nhật đầu việc.');
    } catch (e) {
        console.error('workProfileTask update:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** DELETE /ho-so/cong-viec/:id/nhiem-vu/:taskId */
const destroy = async (req, res) => {
    const userId = req.user?.id;
    const profileId = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!profileId || !taskId) return fail(res, 'ID không hợp lệ.');

    try {
        const taskRes = await db.query(
            `SELECT t.*, p.chu_tri_xu_ly_id, p.lanh_dao_phu_trach_id
             FROM work_profile_tasks t
             JOIN work_profiles p ON p.id = t.profile_id
             WHERE t.id = $1 AND t.profile_id = $2`,
            [taskId, profileId]
        );
        if (!taskRes.rows.length) return fail(res, 'Không tìm thấy đầu việc.', 404);
        const task = taskRes.rows[0];
        if (!canManageTasks(task, userId)) {
            return fail(res, 'Chỉ chủ trì hoặc lãnh đạo phụ trách mới được xóa đầu việc.', 403);
        }
        // Chỉ cho xoá khi người nhận chưa tiếp nhận hoặc đã từ chối
        if (task.accept_status === 'accepted') {
            return fail(res, 'Đầu việc đã được tiếp nhận, không thể xoá.');
        }

        await db.query(`DELETE FROM work_profile_tasks WHERE id = $1`, [taskId]);
        await recomputeWorkProfileProgress(profileId);
        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'XOA_DAU_VIEC',
            noiDung: `Xóa đầu việc #${taskId}: ${task.tieu_de}`,
            meta: { taskId },
        });
        return ok(res, { id: taskId }, 'Đã xóa đầu việc.');
    } catch (e) {
        console.error('workProfileTask destroy:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/nhiem-vu/:taskId/nhan — người nhận xác nhận nhận việc. */
const accept = async (req, res) => {
    const userId = req.user?.id;
    const profileId = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!profileId || !taskId) return fail(res, 'ID không hợp lệ.');

    try {
        const taskRes = await db.query(
            `SELECT * FROM work_profile_tasks WHERE id = $1 AND profile_id = $2`,
            [taskId, profileId]
        );
        if (!taskRes.rows.length) return fail(res, 'Không tìm thấy đầu việc.', 404);
        const task = taskRes.rows[0];
        if (!isAssignee(task, userId)) {
            return fail(res, 'Chỉ người được giao mới có quyền nhận việc này.', 403);
        }
        if (task.accept_status === 'accepted') {
            return fail(res, 'Bạn đã nhận đầu việc này rồi.');
        }

        await db.query(
            `UPDATE work_profile_tasks
             SET accept_status = 'accepted',
                 accepted_at = NOW(),
                 rejected_at = NULL,
                 rejected_reason = NULL,
                 trang_thai = CASE WHEN trang_thai = 'chua_xu_ly' THEN 'dang_xu_ly' ELSE trang_thai END,
                 updated_at = NOW()
             WHERE id = $1`,
            [taskId]
        );
        await updateParticipantStatus(profileId, userId, 'dang_xu_ly');
        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'NHAN_DAU_VIEC',
            noiDung: `Nhận đầu việc #${taskId}: ${task.tieu_de}`,
            meta: { taskId },
        });

        const full = await db.query(`${SELECT_TASK_SQL} WHERE t.id = $1`, [taskId]);
        const shapes = await attachSubmissions(full.rows);
        return ok(res, shapes[0], 'Đã nhận đầu việc.');
    } catch (e) {
        console.error('workProfileTask accept:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/nhiem-vu/:taskId/tu-choi  body: { reason } */
const reject = async (req, res) => {
    const userId = req.user?.id;
    const profileId = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    const reason = String(req.body?.reason || '').trim();
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!profileId || !taskId) return fail(res, 'ID không hợp lệ.');
    if (!reason) return fail(res, 'Vui lòng nhập lý do từ chối.');

    try {
        const taskRes = await db.query(
            `SELECT * FROM work_profile_tasks WHERE id = $1 AND profile_id = $2`,
            [taskId, profileId]
        );
        if (!taskRes.rows.length) return fail(res, 'Không tìm thấy đầu việc.', 404);
        const task = taskRes.rows[0];
        if (!isAssignee(task, userId)) {
            return fail(res, 'Chỉ người được giao mới có quyền từ chối đầu việc.', 403);
        }
        if (task.accept_status === 'rejected') return fail(res, 'Đầu việc đã bị từ chối trước đó.');
        if (task.accept_status === 'accepted') {
            return fail(res, 'Bạn đã nhận đầu việc rồi, không thể từ chối.');
        }

        await db.query(
            `UPDATE work_profile_tasks
             SET accept_status = 'rejected',
                 rejected_at = NOW(),
                 rejected_reason = $2,
                 trang_thai = 'tu_choi',
                 updated_at = NOW()
             WHERE id = $1`,
            [taskId, reason]
        );
        await recomputeWorkProfileProgress(profileId);
        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'TU_CHOI_DAU_VIEC',
            noiDung: `Từ chối đầu việc #${taskId}: ${task.tieu_de}. Lý do: ${reason}`,
            meta: { taskId, reason },
        });

        const full = await db.query(`${SELECT_TASK_SQL} WHERE t.id = $1`, [taskId]);
        const shapes = await attachSubmissions(full.rows);
        return ok(res, shapes[0], 'Đã từ chối đầu việc.');
    } catch (e) {
        console.error('workProfileTask reject:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/nhiem-vu/:taskId/nop
 *  Multipart: noiDung (text) + files[]
 *  Người nhận nộp kết quả → tạo submission mới, chờ chủ trì + phụ trách duyệt.
 */
const submit = async (req, res) => {
    const userId = req.user?.id;
    const profileId = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    const noiDung = String(req.body?.noiDung || '').trim();
    const files = req.files || [];
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!profileId || !taskId) return fail(res, 'ID không hợp lệ.');
    if (!noiDung && !files.length) return fail(res, 'Vui lòng nhập kết quả hoặc đính kèm file.');

    try {
        const taskRes = await db.query(
            `SELECT * FROM work_profile_tasks WHERE id = $1 AND profile_id = $2`,
            [taskId, profileId]
        );
        if (!taskRes.rows.length) return fail(res, 'Không tìm thấy đầu việc.', 404);
        const task = taskRes.rows[0];
        if (!isAssignee(task, userId)) {
            return fail(res, 'Chỉ người được giao mới có quyền nộp kết quả.', 403);
        }
        if (task.accept_status !== 'accepted') {
            return fail(res, 'Bạn cần nhận đầu việc trước khi nộp kết quả.');
        }
        if (task.trang_thai === 'da_hoan_thanh') {
            return fail(res, 'Đầu việc đã hoàn thành.');
        }

        const subIns = await db.query(
            `INSERT INTO work_profile_task_submissions (task_id, submitted_by_id, noi_dung)
             VALUES ($1, $2, $3) RETURNING id`,
            [taskId, userId, noiDung]
        );
        const submissionId = subIns.rows[0].id;

        for (const file of files) {
            await db.query(
                `INSERT INTO work_profile_files
                    (profile_id, loai_file, ten_file, duong_dan, kich_thuoc, doc_type, uploaded_by, task_id, submission_id)
                 VALUES ($1, 'ket_qua_dau_viec', $2, $3, $4, 'upload', $5, $6, $7)`,
                [profileId, file.originalname, file.filename, file.size, userId, taskId, submissionId]
            );
        }

        await db.query(
            `UPDATE work_profile_tasks
             SET trang_thai = 'cho_duyet', ket_qua = $2, updated_at = NOW()
             WHERE id = $1`,
            [taskId, noiDung]
        );
        await updateParticipantStatus(profileId, userId, 'cho_duyet');

        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: 'NOP_KET_QUA',
            noiDung: `Nộp kết quả đầu việc #${taskId}${files.length ? ` (kèm ${files.length} file)` : ''}`,
            meta: { taskId, submissionId, fileCount: files.length },
        });

        const full = await db.query(`${SELECT_TASK_SQL} WHERE t.id = $1`, [taskId]);
        const shapes = await attachSubmissions(full.rows);
        return ok(res, shapes[0], 'Đã nộp kết quả, đang chờ duyệt.');
    } catch (e) {
        console.error('workProfileTask submit:', e);
        return fail(res, 'Lỗi server khi nộp kết quả.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/nhiem-vu/:taskId/nop/:submissionId/duyet
 *  Body: { action: 'approve' | 'reject', comment: string }
 *  Role được xác định tự động: user là chủ trì hay phụ trách của hồ sơ.
 */
const reviewSubmission = async (req, res) => {
    const userId = req.user?.id;
    const profileId = Number(req.params.id);
    const taskId = Number(req.params.taskId);
    const submissionId = Number(req.params.submissionId);
    const { action, comment } = req.body || {};
    const trimmed = String(comment || '').trim();

    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!profileId || !taskId || !submissionId) return fail(res, 'ID không hợp lệ.');
    if (!['approve', 'reject'].includes(action)) return fail(res, 'Hành động không hợp lệ.');
    if (!trimmed) return fail(res, 'Vui lòng nhập ý kiến khi duyệt/không duyệt.');

    try {
        const profileRes = await db.query(
            `SELECT id, chu_tri_xu_ly_id, lanh_dao_phu_trach_id
             FROM work_profiles WHERE id = $1`,
            [profileId]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        const role = roleOnProfile(profile, userId);
        if (!role) return fail(res, 'Chỉ chủ trì hoặc lãnh đạo phụ trách mới có quyền duyệt.', 403);

        const subRes = await db.query(
            `SELECT * FROM work_profile_task_submissions WHERE id = $1 AND task_id = $2`,
            [submissionId, taskId]
        );
        if (!subRes.rows.length) return fail(res, 'Không tìm thấy bản nộp.', 404);
        const sub = subRes.rows[0];

        if (sub.final_status !== 'pending') {
            return fail(res, 'Bản nộp này đã được xử lý xong.');
        }

        const newStatus = action === 'approve' ? 'approved' : 'rejected';
        let chuTriStatus = sub.chu_tri_status;
        let phuTrachStatus = sub.phu_trach_status;

        if (role === 'chu_tri') {
            if (sub.chu_tri_status !== 'pending') return fail(res, 'Chủ trì đã duyệt trước đó.');
            chuTriStatus = newStatus;
            await db.query(
                `UPDATE work_profile_task_submissions
                 SET chu_tri_status = $2,
                     chu_tri_reviewer_id = $3,
                     chu_tri_comment = $4,
                     chu_tri_reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1`,
                [submissionId, newStatus, userId, trimmed]
            );
        } else {
            if (sub.phu_trach_status !== 'pending') return fail(res, 'Phụ trách đã duyệt trước đó.');
            phuTrachStatus = newStatus;
            await db.query(
                `UPDATE work_profile_task_submissions
                 SET phu_trach_status = $2,
                     phu_trach_reviewer_id = $3,
                     phu_trach_comment = $4,
                     phu_trach_reviewed_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1`,
                [submissionId, newStatus, userId, trimmed]
            );
        }

        // Xác định kết quả cuối
        let finalStatus = 'pending';
        if (chuTriStatus === 'rejected' || phuTrachStatus === 'rejected') {
            finalStatus = 'rejected';
        } else if (chuTriStatus === 'approved' && phuTrachStatus === 'approved') {
            finalStatus = 'approved';
        }
        if (finalStatus !== 'pending') {
            await db.query(
                `UPDATE work_profile_task_submissions SET final_status = $2, updated_at = NOW() WHERE id = $1`,
                [submissionId, finalStatus]
            );
            await recomputeWorkProfileProgress(profileId);
            // Đồng bộ trạng thái task
            if (finalStatus === 'approved') {
                await db.query(
                    `UPDATE work_profile_tasks
                     SET trang_thai = 'da_hoan_thanh',
                         ngay_hoan_thanh = CURRENT_DATE,
                         updated_at = NOW()
                     WHERE id = $1`,
                    [taskId]
                );
                const taskInfo = await db.query(
                    `SELECT assigned_user_id FROM work_profile_tasks WHERE id = $1`, [taskId]
                );
                if (taskInfo.rows[0]?.assigned_user_id) {
                    await updateParticipantStatus(profileId, taskInfo.rows[0].assigned_user_id, 'da_hoan_thanh');
                }
            } else {
                // Nếu bị reject → task quay về dang_xu_ly để nộp lại
                await db.query(
                    `UPDATE work_profile_tasks
                     SET trang_thai = 'dang_xu_ly', updated_at = NOW()
                     WHERE id = $1`,
                    [taskId]
                );
                const taskInfo = await db.query(
                    `SELECT assigned_user_id FROM work_profile_tasks WHERE id = $1`, [taskId]
                );
                if (taskInfo.rows[0]?.assigned_user_id) {
                    await updateParticipantStatus(profileId, taskInfo.rows[0].assigned_user_id, 'dang_xu_ly');
                }
            }
        }

        await logWorkProfileHistory({
            profileId,
            userId,
            hanhDong: action === 'approve' ? 'DUYET_KET_QUA' : 'KHONG_DUYET_KET_QUA',
            noiDung: `${role === 'chu_tri' ? 'Chủ trì' : 'Phụ trách'} ${action === 'approve' ? 'duyệt' : 'không duyệt'} kết quả đầu việc #${taskId}. Ý kiến: ${trimmed}`,
            meta: { taskId, submissionId, role, action, comment: trimmed, finalStatus },
        });

        const full = await db.query(`${SELECT_TASK_SQL} WHERE t.id = $1`, [taskId]);
        const shapes = await attachSubmissions(full.rows);
        return ok(res, shapes[0], action === 'approve' ? 'Đã duyệt kết quả.' : 'Đã từ chối kết quả.');
    } catch (e) {
        console.error('workProfileTask reviewSubmission:', e);
        return fail(res, 'Lỗi server khi duyệt kết quả.', 500);
    }
};

/** GET /ho-so/cong-viec/nhiem-vu/cua-toi — đầu việc user đang nhận (ẩn những task họ đã từ chối) */
const myAssignments = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    try {
        const result = await db.query(
            `${SELECT_TASK_SQL}
             WHERE t.assigned_user_id = $1
               AND t.accept_status <> 'rejected'
             ORDER BY t.created_at DESC`,
            [userId]
        );
        return ok(res, result.rows.map(toClientShape));
    } catch (e) {
        if (e.code === '42P01') return ok(res, []);
        console.error('workProfileTask myAssignments:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

module.exports = {
    list, create, update, destroy,
    accept, reject, submit, reviewSubmission,
    myAssignments,
};
