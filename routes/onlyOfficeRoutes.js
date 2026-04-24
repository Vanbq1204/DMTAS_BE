const express = require('express');
const router = express.Router();
const duThaoController = require('../controllers/duThaoController');

// Callback từ OnlyOffice Document Server (không dùng JWT app của người dùng)
router.post('/callback/:fileId', duThaoController.onlyOfficeCallback);

module.exports = router;
