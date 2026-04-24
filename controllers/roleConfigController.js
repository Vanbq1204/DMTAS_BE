const db = require('../config/db');
const ok = (res, data, message = 'Thành công', status = 200) => res.status(status).json({ success: true, data, message });
const fail = (res, message = 'Thất bại', status = 400) => res.status(status).json({ success: false, data: null, message });

// GET /api/admin/role-configs
const getAllRoleConfigs = async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id,role,level,label,weight,is_default,default_permissions,created_at
             FROM role_configs ORDER BY role, level ASC`);
        return ok(res, result.rows);
    } catch (err) { console.error(err); return fail(res, 'Lỗi server', 500); }
};

// POST /api/admin/role-configs
const createRoleConfig = async (req, res) => {
    try {
        const { role, label, default_permissions } = req.body;
        const VALID_ROLES = ['lanh_dao', 'van_thu', 'nhan_vien', 'admin'];
        if (!VALID_ROLES.includes(role)) return fail(res, 'Role không hợp lệ');
        if (!label?.trim()) return fail(res, 'Cần nhập tên cấp bậc');

        // Tự tính level tiếp theo
        const maxRes = await db.query('SELECT COALESCE(MAX(level),0) AS maxlv FROM role_configs WHERE role=$1', [role]);
        const newLevel = parseInt(maxRes.rows[0].maxlv) + 1;
        // Tự tính weight: cấp 1 = 10, cấp 2 = 8, cấp 3 = 6... (giảm 2 mỗi cấp, tối thiểu 1)
        const autoWeight = Math.max(1, 12 - newLevel * 2);

        const r = await db.query(
            `INSERT INTO role_configs (role,level,label,weight,is_default,default_permissions) VALUES ($1,$2,$3,$4,false,$5) RETURNING *`,
            [role, newLevel, label.trim(), autoWeight, JSON.stringify(default_permissions || [])]);
        return ok(res, r.rows[0], 'Thêm cấp bậc thành công', 201);
    } catch (err) { console.error(err); return fail(res, 'Lỗi server', 500); }
};

// PUT /api/admin/role-configs/:id  — chỉ cho đổi label
const updateRoleConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const { label, default_permissions } = req.body;
        if (!label?.trim()) return fail(res, 'Cần nhập tên cấp bậc');

        let updateQuery = `UPDATE role_configs SET label=$1`;
        let params = [label.trim(), id];

        if (default_permissions !== undefined) {
            updateQuery += `, default_permissions=$3`;
            params = [label.trim(), id, JSON.stringify(default_permissions)];
        }
        updateQuery += ` WHERE id=$2 RETURNING *`;

        const r = await db.query(updateQuery, params);
        if (!r.rows.length) return fail(res, 'Không tìm thấy', 404);
        return ok(res, r.rows[0], 'Cập nhật thành công');
    } catch (err) { console.error(err); return fail(res, 'Lỗi server', 500); }
};

// DELETE /api/admin/role-configs/:id
const deleteRoleConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const inUse = await db.query('SELECT id FROM user_positions WHERE role_config_id=$1 LIMIT 1', [id]);
        if (inUse.rows.length) return fail(res, 'Cấp bậc đang được sử dụng, không thể xóa');
        await db.query('DELETE FROM role_configs WHERE id=$1', [id]);
        return ok(res, null, 'Đã xóa');
    } catch (err) { console.error(err); return fail(res, 'Lỗi server', 500); }
};

module.exports = { getAllRoleConfigs, createRoleConfig, updateRoleConfig, deleteRoleConfig };
