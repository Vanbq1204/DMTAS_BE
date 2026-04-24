const bcrypt = require('bcryptjs');
const db = require('../config/db');

const ok = (res, data, message = 'Thành công', status = 200) =>
    res.status(status).json({ success: true, data, message });
const fail = (res, message = 'Thất bại', status = 400) =>
    res.status(status).json({ success: false, data: null, message });

// Tính permission_level: org_factor + role_weight
const DEFAULT_PERMS = {
    'admin_1': ['adm_system', 'adm_org', 'adm_catalog'],
    'lanh_dao_1': ['reg_den_dh', 'reg_di_dh', 'ext_in_so', 'ext_stat', 'ext_task', 'hscv_all_dh', 'disp_assign_dh', 'disp_dist_dh', 'vdi_all_dh', 'vden_all_dh', 'pt_all_dh', 'draft_all_dh', 'proc_assigned', 'sign_doc'],
    'lanh_dao_2': ['reg_den_truong', 'reg_di_truong', 'ext_stat', 'ext_task', 'hscv_all_truong', 'disp_assign_truong', 'disp_dist_truong', 'vdi_all_truong', 'vden_all_truong', 'pt_all_truong', 'draft_all_truong', 'proc_assigned', 'sign_doc'],
    'lanh_dao_3': ['reg_den_phong', 'reg_di_phong', 'ext_stat', 'ext_task', 'hscv_all_phong', 'disp_assign_phong', 'vdi_all_phong', 'vden_all_phong', 'pt_all_phong', 'draft_all_phong', 'proc_assigned', 'sign_doc'],
    'van_thu_1': ['reg_den_dh', 'reg_di_dh', 'reg_den_truong', 'reg_di_truong', 'ext_in_so', 'ext_stat', 'hscv_all_dh', 'hscv_all_truong', 'vdi_all_dh', 'vdi_all_truong', 'vden_all_dh', 'vden_all_truong', 'pt_all_dh', 'pt_all_truong'],
    'van_thu_2': ['reg_den_truong', 'reg_di_truong', 'reg_den_phong', 'reg_di_phong', 'ext_in_so', 'ext_stat', 'hscv_all_truong', 'hscv_all_phong', 'vdi_all_truong', 'vdi_all_phong', 'vden_all_truong', 'vden_all_phong', 'pt_all_truong', 'pt_all_phong'],
    'van_thu_3': ['reg_den_phong', 'reg_di_phong', 'ext_stat', 'hscv_all_phong', 'vdi_all_phong', 'vden_all_phong', 'pt_all_phong', 'draft_all_phong'],
    'nhan_vien_1': ['ext_task', 'proc_assigned']
};
DEFAULT_PERMS['nhan_vien_2'] = DEFAULT_PERMS['nhan_vien_1'];
DEFAULT_PERMS['nhan_vien_3'] = DEFAULT_PERMS['nhan_vien_1'];

const ORG_FACTOR = { 1: 55, 2: 45, 3: 35, 4: 25, 5: 15 };
const ROLE_WEIGHT = { admin: 10, lanh_dao: 7, van_thu: 5, nhan_vien: 3 };
const calcPermLevel = (orgLevel, role) =>
    (ORG_FACTOR[orgLevel] || 15) + (ROLE_WEIGHT[role] || 3);

// Helper: lấy tất cả org_id trong cây con của 1 org
const getSubtreeIds = async (orgId) => {
    const result = await db.query(
        `WITH RECURSIVE subtree AS (
            SELECT id FROM organizations WHERE id = $1
            UNION ALL
            SELECT o.id FROM organizations o
            INNER JOIN subtree s ON o.parent_id = s.id
        ) SELECT id FROM subtree`,
        [orgId]
    );
    return result.rows.map(r => r.id);
};

// ─── GET /api/admin/personnel ─────────────────────────────────────────────────
// Query: org_id, role, search, page, limit, include_subtree (default true)
const getAllPersonnel = async (req, res) => {
    try {
        const { org_id, role, search, page = 1, limit = 20, include_subtree = 'true' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const conditions = [];
        const params = [];
        let idx = 1;

        // Lọc theo org (với subtree)
        if (org_id) {
            let orgIds = [parseInt(org_id)];
            if (include_subtree === 'true') {
                orgIds = await getSubtreeIds(parseInt(org_id));
            }
            conditions.push(`EXISTS (
                SELECT 1 FROM user_positions up2
                WHERE up2.user_id = u.id
                AND up2.org_id = ANY($${idx}::int[])
            )`);
            params.push(orgIds);
            idx++;
        }

        // Lọc theo role của chức vụ chính
        if (role) {
            conditions.push(`EXISTS (
                SELECT 1 FROM user_positions up3
                WHERE up3.user_id = u.id AND up3.is_primary = true AND up3.role = $${idx}
            )`);
            params.push(role);
            idx++;
        }

        if (search) {
            conditions.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.email ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countRes = await db.query(`SELECT COUNT(*) FROM users u ${where}`, params);
        const total = parseInt(countRes.rows[0].count);

        const usersRes = await db.query(
            `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at,
                    u.dob, u.phone, u.contact_email, u.address, u.cccd, u.is_representative,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id', up.id,
                                'title', up.title,
                                'role', up.role,
                                'role_config_id', up.role_config_id,
                                'role_label', rc.label,
                                'org_id', up.org_id,
                                'org_name', un.name,
                                'org_level', o.level,
                                'org_type', o.type,
                                'permission_level', up.permission_level,
                                'is_primary', up.is_primary
                            ) ORDER BY up.is_primary DESC, up.permission_level DESC
                        ) FILTER (WHERE up.id IS NOT NULL),
                        '[]'
                    ) AS positions
             FROM users u
             LEFT JOIN user_positions up ON up.user_id = u.id
             LEFT JOIN organizations o ON o.id = up.org_id
             LEFT JOIN org_unit_names un ON un.id = o.name_id
             LEFT JOIN role_configs rc ON rc.id = up.role_config_id
             ${where}

             GROUP BY u.id
             ORDER BY u.full_name ASC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, parseInt(limit), offset]
        );

        return ok(res, {
            personnel: usersRes.rows,
            pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) },
        });
    } catch (err) {
        console.error('getAllPersonnel:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── GET /api/admin/personnel/:id ────────────────────────────────────────────
const getPersonnelById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at,
                    u.dob, u.phone, u.contact_email, u.address, u.cccd, u.is_representative,
                    COALESCE(
                        json_agg(json_build_object(
                            'role_config_id', up.role_config_id, 'role_label', rc.label,
                            'org_id', up.org_id, 'org_name', un.name, 'org_level', o.level,
                            'permission_level', up.permission_level, 'is_primary', up.is_primary
                        ) ORDER BY up.is_primary DESC) FILTER (WHERE up.id IS NOT NULL), '[]'
                    ) AS positions
             FROM users u
             LEFT JOIN user_positions up ON up.user_id = u.id
             LEFT JOIN organizations o ON o.id = up.org_id
             LEFT JOIN org_unit_names un ON un.id = o.name_id
             LEFT JOIN role_configs rc ON rc.id = up.role_config_id
             WHERE u.id = $1
             GROUP BY u.id`,

            [id]
        );
        if (result.rows.length === 0) return fail(res, 'Không tìm thấy nhân sự', 404);
        return ok(res, result.rows[0]);
    } catch (err) {
        console.error('getPersonnelById:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── POST /api/admin/personnel ────────────────────────────────────────────────
const createPersonnel = async (req, res) => {
    try {
        const { email, full_name, password, role, positions = [], is_representative } = req.body;
        if (!email || !full_name || !password) return fail(res, 'Thiếu thông tin bắt buộc');

        const dup = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (dup.rows.length > 0) return fail(res, 'Email đã tồn tại');

        // Logic is_representative
        let representativeValue = false;
        if (role === 'van_thu') {
            representativeValue = true;
        } else if (is_representative !== undefined) {
            representativeValue = is_representative;
        }

        const pw_hash = await bcrypt.hash(password, 10);
        const userRes = await db.query(
            `INSERT INTO users (email, password_hash, full_name, role, is_active, is_representative)
             VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
            [email, pw_hash, full_name, role || 'nhan_vien', representativeValue]
        );
        const userId = userRes.rows[0].id;

        // Insert positions
        for (const pos of positions) {
            const orgRes = await db.query('SELECT level FROM organizations WHERE id = $1', [pos.org_id]);
            const orgLevel = orgRes.rows[0]?.level || 3;
            // Lấy weight từ role_config hoặc fallback
            let rcWeight = 5;
            if (pos.role_config_id) {
                const rcRes = await db.query('SELECT weight FROM role_configs WHERE id=$1', [pos.role_config_id]);
                rcWeight = rcRes.rows[0]?.weight || 5;
            }
            const permLevel = (ORG_FACTOR[orgLevel] || 15) + rcWeight;
            await db.query(
                `INSERT INTO user_positions (user_id, org_id, title, role, role_config_id, permission_level, is_primary)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [userId, pos.org_id, pos.title, pos.role, pos.role_config_id || null, permLevel, pos.is_primary || false]
            );
        }

        // Tích quyền mặc định dựa vào Cấp chức vụ
        const allRc = await db.query('SELECT id, role, level, default_permissions FROM role_configs');
        const rcMap = new Map();
        for (const r of allRc.rows) rcMap.set(r.id, r);

        const permsToInsert = new Set();
        if (role === 'admin') DEFAULT_PERMS['admin_1'].forEach(k => permsToInsert.add(k));
        for (const p of positions) {
            if (p.role === 'admin') {
                DEFAULT_PERMS['admin_1'].forEach(k => permsToInsert.add(k));
                continue;
            }
            if (p.role_config_id && rcMap.has(p.role_config_id)) {
                const rc = rcMap.get(p.role_config_id);
                if (rc.default_permissions && Array.isArray(rc.default_permissions)) {
                    rc.default_permissions.forEach(kx => permsToInsert.add(kx));
                }
            } else {
                // Thêm một quyền mặc định cơ bản nếu không chọn cấp
                if (p.role === 'nhan_vien') DEFAULT_PERMS['nhan_vien_1'].forEach(kx => permsToInsert.add(kx));
            }
        }

        for (const kx of permsToInsert) {
            await db.query('INSERT INTO user_permissions (user_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, kx]);
        }

        return ok(res, { id: userId }, 'Tạo nhân sự thành công', 201);
    } catch (err) {
        console.error('createPersonnel:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── PUT /api/admin/personnel/:id ─────────────────────────────────────────────
const updatePersonnel = async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, email, role, positions, dob, phone, contact_email, address, cccd, is_representative } = req.body;

        const existing = await db.query('SELECT id, role FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) return fail(res, 'Không tìm thấy nhân sự', 404);

        let newIsRepresentative = is_representative;
        const targetRole = role || existing.rows[0].role;
        if (targetRole === 'van_thu') {
            newIsRepresentative = true;
        }

        await db.query(
            `UPDATE users SET
                full_name = COALESCE($1, full_name),
                email = COALESCE($2, email),
                role = COALESCE($3, role),
                dob = COALESCE($4, dob),
                phone = COALESCE($5, phone),
                contact_email = COALESCE($6, contact_email),
                address = COALESCE($7, address),
                cccd = COALESCE($8, cccd),
                is_representative = COALESCE($9, is_representative)
             WHERE id = $10`,
            [full_name, email, role, dob || null, phone || null, contact_email || null, address || null, cccd || null, newIsRepresentative, id]
        );

        if (positions !== undefined) {
            await db.query('DELETE FROM user_positions WHERE user_id = $1', [id]);
            for (const pos of positions) {
                const orgRes = await db.query('SELECT level FROM organizations WHERE id = $1', [pos.org_id]);
                const orgLevel = orgRes.rows[0]?.level || 3;
                let rcWeight = 5;
                if (pos.role_config_id) {
                    const rcRes = await db.query('SELECT weight FROM role_configs WHERE id=$1', [pos.role_config_id]);
                    rcWeight = rcRes.rows[0]?.weight || 5;
                }
                const permLevel = (ORG_FACTOR[orgLevel] || 15) + rcWeight;
                await db.query(
                    `INSERT INTO user_positions (user_id, org_id, title, role, role_config_id, permission_level, is_primary)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [id, pos.org_id, pos.title, pos.role, pos.role_config_id || null, permLevel, pos.is_primary || false]
                );
            }
        }

        return ok(res, null, 'Cập nhật thành công');
    } catch (err) {
        console.error('updatePersonnel:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── PATCH /api/admin/personnel/:id/toggle-active ────────────────────────────
const togglePersonnelActive = async (req, res) => {
    try {
        const { id } = req.params;
        if (parseInt(id) === req.user.id) return fail(res, 'Không thể khóa chính mình');

        const res2 = await db.query('SELECT is_active FROM users WHERE id = $1', [id]);
        if (res2.rows.length === 0) return fail(res, 'Không tìm thấy nhân sự', 404);

        const newStatus = !res2.rows[0].is_active;
        await db.query('UPDATE users SET is_active = $1 WHERE id = $2', [newStatus, id]);
        return ok(res, { is_active: newStatus }, `${newStatus ? 'Mở khóa' : 'Khóa'} thành công`);
    } catch (err) {
        console.error('togglePersonnelActive:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── GET /api/admin/personnel/:id/permissions ─────────────────────────────
const getPersonnelPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'SELECT permission_key FROM user_permissions WHERE user_id = $1 ORDER BY permission_key', [id]);
        return ok(res, result.rows.map(r => r.permission_key));
    } catch (err) { console.error(err); return fail(res, 'Lỗi server', 500); }
};

// ─── PUT /api/admin/personnel/:id/permissions ─────────────────────────────
const savePersonnelPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const { permissions = [] } = req.body;
        await db.query('DELETE FROM user_permissions WHERE user_id = $1', [id]);
        for (const key of permissions)
            await db.query('INSERT INTO user_permissions (user_id, permission_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, key]);
        return ok(res, null, 'Lưu phân quyền thành công');
    } catch (err) { console.error(err); return fail(res, 'Lỗi server', 500); }
};

// ─── PUT /api/admin/personnel/:id/reset-password ─────────────────────────────
const resetPersonnelPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { new_password } = req.body;
        if (!new_password || new_password.length < 6)
            return fail(res, 'Mật khẩu phải từ 6 ký tự trở lên');
        const existing = await db.query('SELECT id, full_name FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) return fail(res, 'Không tìm thấy nhân sự', 404);
        const hash = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
        return ok(res, { user: existing.rows[0].full_name }, 'Đặt lại mật khẩu thành công');
    } catch (err) { console.error('resetPersonnelPassword:', err); return fail(res, 'Lỗi server', 500); }
};

module.exports = { getAllPersonnel, getPersonnelById, createPersonnel, updatePersonnel, togglePersonnelActive, resetPersonnelPassword, getPersonnelPermissions, savePersonnelPermissions };
