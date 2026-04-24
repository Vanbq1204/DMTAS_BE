const express = require('express');
const router = express.Router();
const { login, logout, getMe } = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');

// Route Đăng nhập
router.post('/login', login);

// Route Đăng xuất
router.post('/logout', logout);

// Route Trả về thông tin người dùng hiện tại
router.get('/me', verifyToken, getMe);

module.exports = router;
