const db = require('../config/db');

const ok = (res, data, message = 'Thành công', status = 200) => res.status(status).json({ success: true, data, message });
const fail = (res, message = 'Thất bại', status = 400) => res.status(status).json({ success: false, data: null, message });

// ════════════════════════════════════════════════════════════════════
// ORG TYPES — Loại đơn vị
// ════════════════════════════════════════════════════════════════════
const getAllOrgTypes = async (req, res) => {
    try {
        const r = await db.query(`SELECT * FROM org_types ORDER BY id`);
        ok(res, r.rows);
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const createOrgType = async (req, res) => {
    try {
        const { code, label } = req.body;
        if (!code?.trim() || !label?.trim()) return fail(res, 'Cần code và label');
        const dup = await db.query('SELECT id FROM org_types WHERE code=$1', [code.trim()]);
        if (dup.rows.length) return fail(res, `Code "${code}" đã tồn tại`);
        const r = await db.query(`INSERT INTO org_types (code,label) VALUES ($1,$2) RETURNING *`, [code.trim(), label.trim()]);
        ok(res, r.rows[0], 'Thêm loại đơn vị thành công', 201);
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const updateOrgType = async (req, res) => {
    try {
        const { id } = req.params;
        const { code, label } = req.body;
        const r = await db.query(
            `UPDATE org_types SET code=COALESCE($1,code), label=COALESCE($2,label) WHERE id=$3 RETURNING *`,
            [code?.trim() || null, label?.trim() || null, id]
        );
        if (!r.rows.length) return fail(res, 'Không tìm thấy', 404);
        ok(res, r.rows[0], 'Cập nhật thành công');
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const deleteOrgType = async (req, res) => {
    try {
        const { id } = req.params;
        const used = await db.query('SELECT id FROM org_unit_names WHERE type_id=$1 LIMIT 1', [id]);
        if (used.rows.length) return fail(res, 'Loại đang được sử dụng, không thể xóa');
        await db.query('DELETE FROM org_types WHERE id=$1', [id]);
        ok(res, null, 'Đã xóa');
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

// ════════════════════════════════════════════════════════════════════
// ORG UNIT NAMES — Tên đơn vị
// ════════════════════════════════════════════════════════════════════
const getAllOrgUnitNames = async (req, res) => {
    try {
        const r = await db.query(`
            SELECT u.*, t.code AS type_code, t.label AS type_label
            FROM org_unit_names u
            JOIN org_types t ON t.id = u.type_id
            ORDER BY t.id, u.name
        `);
        ok(res, r.rows);
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const createOrgUnitName = async (req, res) => {
    try {
        const { type_id, name, short_name } = req.body;
        if (!type_id || !name?.trim()) return fail(res, 'Cần loại và tên đơn vị');
        const typeExists = await db.query('SELECT id FROM org_types WHERE id=$1', [type_id]);
        if (!typeExists.rows.length) return fail(res, 'Loại đơn vị không tồn tại', 404);
        const r = await db.query(
            `INSERT INTO org_unit_names (type_id,name,short_name) VALUES ($1,$2,$3) RETURNING *`,
            [type_id, name.trim(), short_name?.trim() || null]
        );
        ok(res, r.rows[0], 'Thêm tên đơn vị thành công', 201);
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const updateOrgUnitName = async (req, res) => {
    try {
        const { id } = req.params;
        const { type_id, name, short_name, is_active } = req.body;
        const r = await db.query(
            `UPDATE org_unit_names SET
                type_id    = COALESCE($1, type_id),
                name       = COALESCE($2, name),
                short_name = COALESCE($3, short_name),
                is_active  = COALESCE($4, is_active)
             WHERE id=$5 RETURNING *`,
            [type_id || null, name?.trim() || null, short_name?.trim() || null, is_active ?? null, id]
        );
        if (!r.rows.length) return fail(res, 'Không tìm thấy', 404);
        ok(res, r.rows[0], 'Cập nhật thành công');
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const deleteOrgUnitName = async (req, res) => {
    try {
        const { id } = req.params;
        const used = await db.query('SELECT id FROM organizations WHERE name_id=$1 LIMIT 1', [id]);
        if (used.rows.length) return fail(res, 'Tên đang được dùng trong cơ cấu tổ chức, không thể xóa');
        await db.query('DELETE FROM org_unit_names WHERE id=$1', [id]);
        ok(res, null, 'Đã xóa');
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

// ════════════════════════════════════════════════════════════════════
// POSITION TITLES — Chức danh
// ════════════════════════════════════════════════════════════════════
const getAllPositionTitles = async (req, res) => {
    try {
        const { name_id } = req.query;
        let query = `
            SELECT pt.*, un.short_name AS org_code,
                   un.name AS org_name, ot.label AS org_type_label
            FROM position_titles pt
            JOIN org_unit_names un ON un.id = pt.name_id
            LEFT JOIN org_types ot ON ot.id = un.type_id
        `;
        const params = [];
        if (name_id) { query += ` WHERE pt.name_id = $1`; params.push(name_id); }
        query += ` ORDER BY un.id, pt.title`;
        const r = await db.query(query, params);
        ok(res, r.rows);
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const createPositionTitle = async (req, res) => {
    try {
        const { name_id, title, role, role_config_id } = req.body;
        if (!name_id || !title?.trim()) return fail(res, 'Cần đơn vị và tên chức danh');
        const orgExists = await db.query('SELECT id FROM org_unit_names WHERE id=$1', [name_id]);
        if (!orgExists.rows.length) return fail(res, 'Đơn vị không tồn tại', 404);
        const r = await db.query(
            `INSERT INTO position_titles (name_id, title, role, role_config_id) VALUES ($1,$2,$3,$4)
             ON CONFLICT (name_id,title) DO NOTHING RETURNING *`,
            [name_id, title.trim(), role || 'nhan_vien', role_config_id || null]
        );
        if (!r.rows.length) return fail(res, 'Chức danh này đã tồn tại trong đơn vị');
        ok(res, r.rows[0], 'Thêm chức danh thành công', 201);
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const updatePositionTitle = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, is_active, role, role_config_id } = req.body;
        const r = await db.query(
            `UPDATE position_titles SET
                title          = COALESCE($1, title),
                is_active      = COALESCE($2, is_active),
                role           = COALESCE($3, role),
                role_config_id = $4
             WHERE id=$5 RETURNING *`,
            [title?.trim() || null, is_active ?? null, role || null, role_config_id || null, id]
        );
        if (!r.rows.length) return fail(res, 'Không tìm thấy', 404);
        ok(res, r.rows[0], 'Cập nhật thành công');
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

const deletePositionTitle = async (req, res) => {
    try {
        const { id } = req.params;
        const r = await db.query('SELECT title FROM position_titles WHERE id=$1', [id]);
        if (!r.rows.length) return fail(res, 'Không tìm thấy', 404);
        await db.query('DELETE FROM position_titles WHERE id=$1', [id]);
        ok(res, null, 'Đã xóa chức danh');
    } catch (err) { console.error(err); fail(res, 'Lỗi server', 500); }
};

module.exports = {
    getAllOrgTypes, createOrgType, updateOrgType, deleteOrgType,
    getAllOrgUnitNames, createOrgUnitName, updateOrgUnitName, deleteOrgUnitName,
    getAllPositionTitles, createPositionTitle, updatePositionTitle, deletePositionTitle,
};
