const express = require('express');
const router = express.Router();
const SoVanBanController = require('./so-van-ban.controller');
const { verifyToken } = require('../../../middleware/authMiddleware'); // Đảm bảo đã có middleware này
// Có thể thêm requireRole middleware check role 'van_thu' ở đây

router.use(verifyToken); // Tất cả route Sổ văn bản đều cần auth

// ---------- SỔ VĂN BẢN ----------
router.get('/books', SoVanBanController.getAllBooks);
router.post('/books', SoVanBanController.createBook);
router.put('/books/:id', SoVanBanController.updateBook);
router.delete('/books/:id', SoVanBanController.deleteBook);

// ---------- KÝ HIỆU VĂN BẢN ----------
router.get('/symbols', SoVanBanController.getAllSymbols);
router.post('/symbols', SoVanBanController.createSymbol);
router.put('/symbols/:id', SoVanBanController.updateSymbol);
router.delete('/symbols/:id', SoVanBanController.deleteSymbol);

module.exports = router;
