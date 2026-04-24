const db = require('../config/db');

const ok = (res, data, message = 'Thành công', status = 200) => res.status(status).json({ success: true, data, message });
const fail = (res, message = 'Thất bại', status = 400) => res.status(status).json({ success: false, data: null, message });

// ─── GET /api/admin/organizations ─────────────────────────────────────────────
const getAllOrgs = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT o.id, o.parent_id, o.name_id, o.code, o.type, o.level, o.is_active, o.created_at,
                   un.name, un.short_name,
                   ot.id AS type_id_ref, ot.label AS type_label
            FROM organizations o
            LEFT JOIN org_unit_names un ON un.id = o.name_id
            LEFT JOIN org_types ot ON ot.id = un.type_id
            ORDER BY o.level ASC, o.id ASC
        `);
        return ok(res, result.rows);
    } catch (err) {
        console.error('getAllOrgs:', err);
        return fail(res, 'Lỗi server: ' + err.message, 500);
    }
};

// ─── POST /api/admin/organizations ────────────────────────────────────────────
const createOrg = async (req, res) => {
    try {
        const { parent_id, name_id, code, type } = req.body;
        if (!name_id || !code?.trim() || !type) {
            return fail(res, 'Vui lòng chọn tên đơn vị, nhập mã và loại');
        }

        // Validate name_id exists
        const nameRow = await db.query('SELECT id FROM org_unit_names WHERE id=$1', [name_id]);
        if (!nameRow.rows.length) return fail(res, 'Tên đơn vị không tồn tại', 404);

        // Tính level từ parent
        let level = 1;
        if (parent_id) {
            const parent = await db.query('SELECT level FROM organizations WHERE id=$1', [parent_id]);
            if (!parent.rows.length) return fail(res, 'Đơn vị cha không tồn tại', 404);
            level = parent.rows[0].level + 1;
            if (level > 5) return fail(res, 'Không thể thêm đơn vị quá cấp 5');
        }

        const dup = await db.query('SELECT id FROM organizations WHERE code=$1', [code]);
        if (dup.rows.length) return fail(res, `Mã "${code}" đã tồn tại`);

        const result = await db.query(
            `INSERT INTO organizations (parent_id, name_id, code, type, level)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING *`,
            [parent_id || null, name_id, code.trim().toUpperCase(), type, level]
        );
        // Return with joined name
        const row = result.rows[0];
        const nameData = await db.query(`
            SELECT un.name, un.short_name, ot.label AS type_label
            FROM org_unit_names un JOIN org_types ot ON ot.id=un.type_id
            WHERE un.id=$1`, [name_id]);
        return ok(res, { ...row, ...nameData.rows[0] }, 'Thêm đơn vị thành công', 201);
    } catch (err) {
        console.error('createOrg:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── PUT /api/admin/organizations/:id ─────────────────────────────────────────
const updateOrg = async (req, res) => {
    try {
        const { id } = req.params;
        const { name_id, code, type } = req.body;

        const existing = await db.query('SELECT id FROM organizations WHERE id=$1', [id]);
        if (!existing.rows.length) return fail(res, 'Không tìm thấy đơn vị', 404);

        if (code) {
            const dup = await db.query('SELECT id FROM organizations WHERE code=$1 AND id!=$2', [code, id]);
            if (dup.rows.length) return fail(res, `Mã "${code}" đã tồn tại`);
        }

        const result = await db.query(
            `UPDATE organizations SET
                name_id = COALESCE($1, name_id),
                code    = COALESCE($2, code),
                type    = COALESCE($3, type)
             WHERE id=$4 RETURNING *`,
            [name_id || null, code?.trim().toUpperCase() || null, type || null, id]
        );
        return ok(res, result.rows[0], 'Cập nhật thành công');
    } catch (err) {
        console.error('updateOrg:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─── DELETE /api/admin/organizations/:id ──────────────────────────────────────
const deleteOrg = async (req, res) => {
    try {
        const { id } = req.params;

        const hasChildren = await db.query('SELECT id FROM organizations WHERE parent_id=$1 LIMIT 1', [id]);
        if (hasChildren.rows.length) return fail(res, 'Không thể xóa — còn đơn vị con bên trong');

        const hasPersonnel = await db.query('SELECT id FROM user_positions WHERE org_id=$1 LIMIT 1', [id]);
        if (hasPersonnel.rows.length) return fail(res, 'Không thể xóa — còn nhân sự đang thuộc đơn vị này');

        await db.query('DELETE FROM organizations WHERE id=$1', [id]);
        return ok(res, null, 'Đã xóa đơn vị');
    } catch (err) {
        console.error('deleteOrg:', err);
        return fail(res, 'Lỗi server', 500);
    }
};

module.exports = { getAllOrgs, createOrg, updateOrg, deleteOrg };
