const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const incomingDocumentController = require('../controllers/incomingDocumentController');
const duThaoController = require('../controllers/duThaoController');
const workProfileHeadingController = require('../controllers/workProfileHeadingController');
const workProfileController = require('../controllers/workProfileController');
const workProfileCommentController = require('../controllers/workProfileCommentController');
const workProfileFileController = require('../controllers/workProfileFileController');
const workProfileHistoryController = require('../controllers/workProfileHistoryController');
const workProfileTaskController = require('../controllers/workProfileTaskController');
const outgoingDocumentController = require('../controllers/outgoingDocumentController');
const upload = require('../middleware/uploadMiddleware');

router.use(verifyToken);
router.use(requireRole('nhan_vien', 'van_thu'));

// Tiếp nhận nội bộ (từ văn bản đi)
router.get('/van-ban-noi-bo-tiep-nhan',                outgoingDocumentController.listInternalInbox);
router.post('/van-ban-noi-bo-tiep-nhan/:inboxId/da-doc', outgoingDocumentController.markInboxAsRead);

router.get('/ho-so/dau-muc', workProfileHeadingController.list);
router.post('/ho-so/dau-muc', workProfileHeadingController.create);
router.put('/ho-so/dau-muc/:id', workProfileHeadingController.update);
router.delete('/ho-so/dau-muc/:id', workProfileHeadingController.destroy);
router.get('/ho-so/cong-viec', workProfileController.list);
router.post('/ho-so/cong-viec', workProfileController.create);
router.put('/ho-so/cong-viec/:id', workProfileController.update);
router.delete('/ho-so/cong-viec/:id', workProfileController.destroy);
router.patch('/ho-so/cong-viec/:id/tien-do', workProfileController.updateTienDo);
router.patch('/ho-so/cong-viec/:id/trang-thai-chu-tri', workProfileController.updateChuTriStatus);
router.patch('/ho-so/cong-viec/:id/phan-cong', workProfileController.phanCong);
router.patch('/ho-so/cong-viec/:id/duyet-ket-thuc', upload.array('files'), workProfileController.duyetKetThuc);
router.get ('/ho-so/cong-viec/:id/danh-gia',            workProfileController.listEvaluations);
router.post('/ho-so/cong-viec/:id/danh-gia',            workProfileController.submitEvaluations);
router.post('/ho-so/cong-viec/:id/danh-gia/bo-qua',     workProfileController.skipEvaluation);
router.post('/ho-so/cong-viec/:id/danh-gia/uy-quyen',   workProfileController.delegateEvaluation);
router.get('/ho-so/cong-viec/:id/y-kien', workProfileCommentController.list);
router.post('/ho-so/cong-viec/:id/y-kien', workProfileCommentController.create);
router.get('/ho-so/cong-viec/:id/files', workProfileFileController.list);
router.post('/ho-so/cong-viec/:id/files', upload.array('files'), workProfileFileController.upload);
router.post('/ho-so/cong-viec/:id/gan-van-ban', workProfileFileController.ganVanBan);
router.delete('/ho-so/cong-viec/:id/files/:fileId', workProfileFileController.remove);
router.get('/ho-so/cong-viec/:id/files/:fileId/onlyoffice-config', workProfileFileController.getOnlyOfficeViewConfig);
router.get('/ho-so/cong-viec/:id/lich-su', workProfileHistoryController.list);
router.get('/ho-so/cong-viec/nhiem-vu/cua-toi', workProfileTaskController.myAssignments);
router.get('/ho-so/cong-viec/:id/nhiem-vu', workProfileTaskController.list);
router.post('/ho-so/cong-viec/:id/nhiem-vu', workProfileTaskController.create);
router.patch('/ho-so/cong-viec/:id/nhiem-vu/:taskId', workProfileTaskController.update);
router.delete('/ho-so/cong-viec/:id/nhiem-vu/:taskId', workProfileTaskController.destroy);
router.post('/ho-so/cong-viec/:id/nhiem-vu/:taskId/nhan', workProfileTaskController.accept);
router.post('/ho-so/cong-viec/:id/nhiem-vu/:taskId/tu-choi', workProfileTaskController.reject);
router.post('/ho-so/cong-viec/:id/nhiem-vu/:taskId/nop', upload.array('files'), workProfileTaskController.submit);
router.post('/ho-so/cong-viec/:id/nhiem-vu/:taskId/nop/:submissionId/duyet', workProfileTaskController.reviewSubmission);

/* ─── Văn bản đến ─── */
router.get('/van-ban-den', incomingDocumentController.getNhanVienIncomingDocuments);
router.post('/van-ban-den/:id/ket-thuc-xu-ly', upload.array('files'), incomingDocumentController.ketThucXuLy);
router.get('/van-ban-den/:id/lich-su', incomingDocumentController.getDocumentHistory);
router.post('/van-ban-den/:id/da-xem-de-biet', incomingDocumentController.markDeBietAsRead);
router.post('/van-ban-den/:id/chuyen-de-biet', incomingDocumentController.forwardDeBiet);
router.get('/all-orgs-de-biet', incomingDocumentController.getAllOrgsForDeBiet);
router.post('/van-ban-den/:id/chuyen-phoi-hop', incomingDocumentController.forwardPhoiHop);
router.post('/van-ban-den/:id/y-kien-phoi-hop', upload.array('files'), incomingDocumentController.choYKienPhoiHop);

/* ─── Thông tin hỗ trợ form ─── */
router.get('/me', duThaoController.getMe);
router.get('/departments', duThaoController.getDepartments);
router.get('/loai-van-ban', duThaoController.getLoaiVanBan);

/* ─── Văn bản dự thảo ─── */
router.get('/du-thao/nguoi-ky', duThaoController.getNguoiKy);
router.get('/du-thao/org-tree', duThaoController.getOrgTree);
router.get('/du-thao/org/:orgId/members', duThaoController.getOrgMembers);
router.get('/du-thao/files/:fileId/preview', duThaoController.previewFileDuThao);
router.get('/du-thao/:id/files/:fileId/onlyoffice-config', duThaoController.getOnlyOfficeConfig);
router.post('/du-thao/:id/files/:fileId/onlyoffice-session-note', duThaoController.setOnlyOfficeSessionNote);
router.get('/du-thao', duThaoController.getDuThaoList);
router.post('/du-thao', upload.fields([
    { name: 'tep_ban_hanh', maxCount: 1 },
    { name: 'tep_kem_theo', maxCount: 10 }
]), duThaoController.taoVanBanDuThao);
router.get('/du-thao/:id', duThaoController.getDuThaoDetail);
router.get('/du-thao/:id/lich-su', duThaoController.getLichSuDuThao);
router.put('/du-thao/:id', upload.fields([
    { name: 'tep_ban_hanh', maxCount: 1 },
    { name: 'tep_kem_theo', maxCount: 10 }
]), duThaoController.capNhatDuThao);
router.post('/du-thao/:id/chuyen', duThaoController.chuyenDuThao);
router.delete('/du-thao/:id', duThaoController.xoaDuThao);
router.delete('/du-thao/:id/files/:fileId', duThaoController.xoaFileDuThao);
router.put('/du-thao/:id/files/:fileId', upload.single('file'), duThaoController.capNhatFileDuThao);

module.exports = router;
