const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Helper: chuẩn hoá response
const ok = (res, data, message = 'Thành công', statusCode = 200) =>
    res.status(statusCode).json({ success: true, data, message });

const fail = (res, message = 'Thất bại', statusCode = 400) =>
    res.status(statusCode).json({ success: false, data: null, message });

// ─────────────────────────────────────────────
// GET /api/admin/users
// Query params: role, department_id, is_active, search, page, limit
// ─────────────────────────────────────────────
const getAllUsers = async (req, res) => {
    try {
        const {
            role,
            department_id,
            is_active,
            search,
            page = 1,
            limit = 10,
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const conditions = [];
        const params = [];
        let idx = 1;

        if (role) { conditions.push(`u.role = $${idx++}`); params.push(role); }
        if (department_id) { conditions.push(`u.department_id = $${idx++}`); params.push(department_id); }
        if (is_active !== undefined && is_active !== '') {
            conditions.push(`u.is_active = $${idx++}`);
            params.push(is_active === 'true');
        }
        if (search) {
            conditions.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx})`);
            params.push(`%${search}%`);
            idx++;
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        // Đếm tổng
        const countResult = await db.query(
            `SELECT COUNT(*) FROM users u ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        // Lấy danh sách
        const result = await db.query(
            `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at, u.is_representative,
                    d.id AS department_id, d.name AS department_name, d.code AS department_code
             FROM users u
             LEFT JOIN departments d ON u.department_id = d.id
             ${whereClause}
             ORDER BY u.created_at DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, parseInt(limit), offset]
        );

        return ok(res, {
            users: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        console.error('getAllUsers error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─────────────────────────────────────────────
// POST /api/admin/users — Tạo user mới
// ─────────────────────────────────────────────
const createUser = async (req, res) => {
    try {
        const { email, full_name, role, department_id, password, is_representative } = req.body;

        if (!email || !full_name || !role || !password) {
            return fail(res, 'Vui lòng điền đầy đủ thông tin bắt buộc');
        }

        const validRoles = ['admin', 'lanh_dao', 'van_thu', 'nhan_vien'];
        if (!validRoles.includes(role)) {
            return fail(res, 'Role không hợp lệ');
        }

        // Kiểm tra email đã tồn tại chưa
        const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return fail(res, 'Email đã tồn tại trong hệ thống');
        }

        // Logic mặc định is_representative
        let representativeValue = false;
        if (role === 'van_thu') {
            representativeValue = true;
        } else if (is_representative !== undefined) {
            representativeValue = is_representative;
        }

        const password_hash = await bcrypt.hash(password, 10);

        const result = await db.query(
            `INSERT INTO users (email, password_hash, full_name, role, department_id, is_representative)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, full_name, role, department_id, is_active, created_at, is_representative`,
            [email, password_hash, full_name, role, department_id || null, representativeValue]
        );

        return ok(res, result.rows[0], 'Tạo tài khoản thành công', 201);
    } catch (error) {
        console.error('createUser error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─────────────────────────────────────────────
// PUT /api/admin/users/:id — Cập nhật thông tin user
// ─────────────────────────────────────────────
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { email, full_name, role, department_id, is_representative } = req.body;

        // Kiểm tra user tồn tại
        const existing = await db.query('SELECT id, role FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return fail(res, 'Không tìm thấy người dùng', 404);
        }

        // Logic mặc định is_representative khi update
        // Nếu role mới là van_thu thì auto true
        // Nếu role cũ là van_thu mà đổi sang khác thì có thể chỉnh
        // Nếu truyền lên is_representative thì lấy giá trị đó, nếu ko thì giữ nguyên (COALESCE trong SQL)
        // Tuy nhiên logic nghiệp vụ: nếu role = van_thu thì luôn là true
        
        let newIsRepresentative = is_representative;
        const targetRole = role || existing.rows[0].role;
        
        if (targetRole === 'van_thu') {
            newIsRepresentative = true;
        }

        const result = await db.query(
            `UPDATE users SET
                email = COALESCE($1, email),
                full_name = COALESCE($2, full_name),
                role = COALESCE($3, role),
                department_id = COALESCE($4, department_id),
                is_representative = COALESCE($5, is_representative)
             WHERE id = $6
             RETURNING id, email, full_name, role, department_id, is_active, created_at, is_representative`,
            [email, full_name, role, department_id, newIsRepresentative, id]
        );

        return ok(res, result.rows[0], 'Cập nhật thành công');
    } catch (error) {
        console.error('updateUser error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─────────────────────────────────────────────
// PATCH /api/admin/users/:id/toggle-active
// ─────────────────────────────────────────────
const toggleActive = async (req, res) => {
    try {
        const { id } = req.params;

        // Không cho phép khóa chính mình
        if (parseInt(id) === req.user.id) {
            return fail(res, 'Không thể khóa tài khoản của chính bạn');
        }

        const existing = await db.query('SELECT id, is_active, full_name FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return fail(res, 'Không tìm thấy người dùng', 404);
        }

        const currentStatus = existing.rows[0].is_active;
        const result = await db.query(
            `UPDATE users SET is_active = $1 WHERE id = $2
             RETURNING id, email, full_name, role, is_active`,
            [!currentStatus, id]
        );

        const action = !currentStatus ? 'Mở khóa' : 'Khóa';
        return ok(res, result.rows[0], `${action} tài khoản thành công`);
    } catch (error) {
        console.error('toggleActive error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─────────────────────────────────────────────
// PUT /api/admin/users/:id/reset-password
// Body: { new_password }
// ─────────────────────────────────────────────
const resetPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { new_password } = req.body;

        if (!new_password || new_password.length < 6) {
            return fail(res, 'Mật khẩu mới phải có ít nhất 6 ký tự');
        }

        const existing = await db.query('SELECT id FROM users WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return fail(res, 'Không tìm thấy người dùng', 404);
        }

        const password_hash = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, id]);

        return ok(res, null, 'Đặt lại mật khẩu thành công');
    } catch (error) {
        console.error('resetPassword error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

// ─────────────────────────────────────────────
// GET /api/admin/departments — lấy danh sách phòng ban
// ─────────────────────────────────────────────
const getDepartments = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM departments ORDER BY name ASC');
        return ok(res, result.rows);
    } catch (error) {
        console.error('getDepartments error:', error);
        return fail(res, 'Lỗi server', 500);
    }
};

module.exports = { getAllUsers, createUser, updateUser, toggleActive, resetPassword, getDepartments };
