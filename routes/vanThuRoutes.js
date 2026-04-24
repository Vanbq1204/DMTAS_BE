
const express = require('express');
const router = express.Router();
const incomingDocumentController = require('../controllers/incomingDocumentController');
const outgoingDocumentController = require('../controllers/outgoingDocumentController');
const workProfileHeadingController = require('../controllers/workProfileHeadingController');
const workProfileController = require('../controllers/workProfileController');
const workProfileCommentController = require('../controllers/workProfileCommentController');
const workProfileFileController = require('../controllers/workProfileFileController');
const workProfileHistoryController = require('../controllers/workProfileHistoryController');
const workProfileTaskController = require('../controllers/workProfileTaskController');
const { verifyToken } = require('../middleware/authMiddleware');

// Apply auth middleware to all routes
router.use(verifyToken);

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
// duyet-ket-thuc được định nghĩa phía dưới (cần handleUpload)
router.get ('/ho-so/cong-viec/:id/danh-gia',            workProfileController.listEvaluations);
router.post('/ho-so/cong-viec/:id/danh-gia',            workProfileController.submitEvaluations);
router.post('/ho-so/cong-viec/:id/danh-gia/bo-qua',     workProfileController.skipEvaluation);
router.post('/ho-so/cong-viec/:id/danh-gia/uy-quyen',   workProfileController.delegateEvaluation);
router.get('/ho-so/cong-viec/:id/y-kien', workProfileCommentController.list);
router.post('/ho-so/cong-viec/:id/y-kien', workProfileCommentController.create);
router.get('/ho-so/cong-viec/:id/files', workProfileFileController.list);
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

const upload = require('../middleware/uploadMiddleware');

const multer = require('multer');

// Wrapper for multer to handle errors
const handleUpload = (req, res, next) => {
    upload.array('files')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ success: false, message: 'Kích thước tệp tin quá lớn (Tối đa 20MB)' });
            }
            return res.status(400).json({ success: false, message: `Lỗi tải tệp: ${err.message}` });
        } else if (err) {
            return res.status(500).json({ success: false, message: `Lỗi server khi tải tệp: ${err.message}` });
        }
        next();
    });
};

// Work Profile file upload (needs multer, so defined after handleUpload)
router.post('/ho-so/cong-viec/:id/files', handleUpload, workProfileFileController.upload);
router.post('/ho-so/cong-viec/:id/nhiem-vu/:taskId/nop', handleUpload, workProfileTaskController.submit);
router.patch('/ho-so/cong-viec/:id/duyet-ket-thuc', handleUpload, workProfileController.duyetKetThuc);
router.post('/ho-so/cong-viec/:id/nhiem-vu/:taskId/nop/:submissionId/duyet', workProfileTaskController.reviewSubmission);

// Incoming Documents
router.get('/van-ban-den', incomingDocumentController.getIncomingDocuments);
router.post('/van-ban-den', handleUpload, incomingDocumentController.createIncomingDocument);
router.put('/van-ban-den/:id', handleUpload, incomingDocumentController.updateIncomingDocument);
router.delete('/van-ban-den/:id', incomingDocumentController.deleteIncomingDocument);
router.get('/so-van-ban-den', incomingDocumentController.getIncomingDocumentBooks);
router.get('/lanh-dao', incomingDocumentController.getLeaders);
router.get('/document-symbols', incomingDocumentController.getDocumentSymbols);
router.get('/van-ban-den/:id/lich-su', incomingDocumentController.getDocumentHistory);
router.post('/van-ban-den/:id/da-xem-de-biet', incomingDocumentController.markDeBietAsRead);
router.post('/van-ban-den/:id/chuyen-de-biet', incomingDocumentController.forwardDeBiet);
router.get('/all-orgs-de-biet', incomingDocumentController.getAllOrgsForDeBiet);
router.post('/van-ban-den/:id/chuyen-phoi-hop', incomingDocumentController.forwardPhoiHop);
router.post('/van-ban-den/:id/y-kien-phoi-hop', handleUpload, incomingDocumentController.choYKienPhoiHop);

/* ─── Văn bản đi (văn thư) ─── */
router.get('/van-ban-di',                outgoingDocumentController.list);
router.get('/van-ban-di/nguoi-ky',       outgoingDocumentController.getSigners);
router.get('/van-ban-di/users',          outgoingDocumentController.searchInternalUsers);
router.get('/van-ban-di/don-vi',         outgoingDocumentController.getOrganizations);
router.get('/van-ban-di/don-vi/:orgId/thanh-vien', outgoingDocumentController.getOrgMembers);
router.get('/so-van-ban-di',             outgoingDocumentController.getBooks);
router.get('/van-ban-di/:id',            outgoingDocumentController.detail);
router.get('/van-ban-di/:id/noi-nhan',   outgoingDocumentController.getRecipients);
router.post('/van-ban-di/:id/gui-noi-bo', outgoingDocumentController.guiNoiBo);
router.post('/van-ban-di',               handleUpload, outgoingDocumentController.create);
router.put('/van-ban-di/:id',            handleUpload, outgoingDocumentController.update);
router.delete('/van-ban-di/:id',         outgoingDocumentController.destroy);
router.patch('/van-ban-di/:id/trang-thai', outgoingDocumentController.changeStatus);

// Internal Incoming Documents (Văn bản đến nội bộ)
router.get('/van-ban-noi-bo', incomingDocumentController.getInternalIncomingDocuments);
router.get('/van-ban-noi-bo/targets', incomingDocumentController.getNoiBoForwardTargets);
router.post('/van-ban-noi-bo/:id/khong-vao-so', incomingDocumentController.markAsKhongVaoSo);
router.post('/van-ban-noi-bo/chuyen-tiep', incomingDocumentController.forwardInternalDocuments);

// Tiếp nhận nội bộ (từ văn bản đi)
router.get('/van-ban-noi-bo-tiep-nhan',                outgoingDocumentController.listInternalInbox);
router.post('/van-ban-noi-bo-tiep-nhan/:inboxId/da-doc', outgoingDocumentController.markInboxAsRead);

/* ─── Văn bản dự thảo (văn thư) ─── */
const duThaoController = require('../controllers/duThaoController');
const uploadFields = require('../middleware/uploadMiddleware');
router.get('/me', duThaoController.getMe);
router.get('/departments', duThaoController.getDepartments);
router.get('/loai-van-ban', duThaoController.getLoaiVanBan);
router.get('/du-thao/nguoi-ky', duThaoController.getNguoiKy);
router.get('/du-thao/org-tree', duThaoController.getOrgTree);
router.get('/du-thao/org/:orgId/members', duThaoController.getOrgMembers);
router.get('/du-thao/files/:fileId/preview', duThaoController.previewFileDuThao);
router.get('/du-thao/:id/files/:fileId/onlyoffice-config', duThaoController.getOnlyOfficeConfig);
router.get('/du-thao', duThaoController.getDuThaoList);
router.post('/du-thao', uploadFields.fields([
    { name: 'tep_ban_hanh', maxCount: 1 },
    { name: 'tep_kem_theo', maxCount: 10 }
]), duThaoController.taoVanBanDuThao);
router.get('/du-thao/:id', duThaoController.getDuThaoDetail);
router.get('/du-thao/:id/lich-su', duThaoController.getLichSuDuThao);
router.put('/du-thao/:id', uploadFields.fields([
    { name: 'tep_ban_hanh', maxCount: 1 },
    { name: 'tep_kem_theo', maxCount: 10 }
]), duThaoController.capNhatDuThao);
router.post('/du-thao/:id/chuyen', duThaoController.chuyenDuThao);
router.delete('/du-thao/:id', duThaoController.xoaDuThao);
router.delete('/du-thao/:id/files/:fileId', duThaoController.xoaFileDuThao);
router.put('/du-thao/:id/files/:fileId', uploadFields.single('file'), duThaoController.capNhatFileDuThao);

module.exports = router;
