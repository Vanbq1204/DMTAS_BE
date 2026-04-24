const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// API: POST /api/auth/login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Vui lòng cung cấp email và mật khẩu' });
        }

        // Truy vấn user từ DB
        const query = `
            SELECT u.*, 
                   un.name as department_name,
                   un_parent.name as agency_name,
                   up.org_id as actual_org_id 
            FROM users u
            LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
            LEFT JOIN organizations o ON o.id = up.org_id
            LEFT JOIN org_unit_names un ON un.id = o.name_id
            LEFT JOIN organizations o_parent ON o_parent.id = o.parent_id
            LEFT JOIN org_unit_names un_parent ON un_parent.id = o_parent.name_id
            WHERE u.email = $1 AND u.is_active = true
        `;
        const result = await db.query(query, [email]);

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });
        }

        const user = result.rows[0];

        // So sánh mật khẩu bcrypt
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Sai email hoặc mật khẩu' });
        }

        // Tạo payload cho token
        const payload = {
            id: user.id,
            name: user.full_name,
            role: user.role,
            orgId: user.actual_org_id || user.department_id || 1,
            department_name: user.department_name,
            agency_name: user.agency_name
        };

        // Ký JWT Token (Hết hạn trong 8 tiếng)
        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '8h' }
        );

        res.json({
            message: 'Đăng nhập thành công',
            token,
            user: payload
        });
    } catch (error) {
        console.error('Lỗi login:', error);
        res.status(500).json({ message: 'Lỗi máy chủ nội bộ' });
    }
};

// API: POST /api/auth/logout
const logout = (req, res) => {
    // Với JWT phía backend thường không lưu trạng thái (stateless) 
    // Việc vô hiệu hoá token chủ yếu thực hiện ở Client (xoá localStorage)
    // Nếu muốn, có thể implement blacklist token ở backend, nhưng yêu cầu cơ bản chỉ cần xoá ở client
    res.json({ message: 'Đăng xuất thành công' });
};

// API: GET /api/auth/me
const getMe = async (req, res) => {
    try {
        // req.user được gán từ verifyToken middleware
        const userId = req.user.id;

        // Truy vấn lại thông tin từ DB để lấy detail (nếu cần thiết)
        const query = `
            SELECT u.id, u.email, u.full_name, u.role, u.department_id, u.is_active,
                   un.name as department_name,
                   un_parent.name as agency_name,
                   up.org_id as actual_org_id 
            FROM users u
            LEFT JOIN user_positions up ON up.user_id = u.id AND up.is_primary = true
            LEFT JOIN organizations o ON o.id = up.org_id
            LEFT JOIN org_unit_names un ON un.id = o.name_id
            LEFT JOIN organizations o_parent ON o_parent.id = o.parent_id
            LEFT JOIN org_unit_names un_parent ON un_parent.id = o_parent.name_id
            WHERE u.id = $1
        `;
        const result = await db.query(query, [userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Lỗi getMe:', error);
        res.status(500).json({ message: 'Lỗi máy chủ nội bộ' });
    }
};

module.exports = {
    login,
    logout,
    getMe
};
