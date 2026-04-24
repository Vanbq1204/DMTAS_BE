const jwt = require('jsonwebtoken');

// Middleware xác thực JWT token
const verifyToken = (req, res, next) => {
    try {
        // Lấy token từ header Authorization theo format "Bearer <token>"
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Không tìm thấy token. Vui lòng đăng nhập.' });
        }

        const token = authHeader.split(' ')[1];

        // Giải mã token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');

        // Gắn thông tin user vào req để dùng cho các middleware/controller sau
        req.user = decoded;

        next();
    } catch (error) {
        return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn.' });
    }
};

// Middleware phân quyền dựa trên role
// ...roles là danh sách các role được phép (vd: 'admin', 'lanh_dao')
const requireRole = (...roles) => {
    return (req, res, next) => {
        // Giả sử verifyToken đã chạy trước đó và gán req.user
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                message: 'Bạn không có quyền truy cập chức năng này.'
            });
        }
        next();
    };
};

module.exports = {
    verifyToken,
    requireRole
};
