const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/authMiddleware');
const { getAllOrgs, createOrg, updateOrg, deleteOrg } = require('../controllers/orgController');
const { getAllPersonnel, getPersonnelById, createPersonnel, updatePersonnel, togglePersonnelActive, resetPersonnelPassword, getPersonnelPermissions, savePersonnelPermissions } = require('../controllers/personnelController');
const { getAllUsers, createUser, updateUser, toggleActive, resetPassword, getDepartments } = require('../controllers/userController');
const { getAllRoleConfigs, createRoleConfig, updateRoleConfig, deleteRoleConfig } = require('../controllers/roleConfigController');
const {
    getAllOrgTypes, createOrgType, updateOrgType, deleteOrgType,
    getAllOrgUnitNames, createOrgUnitName, updateOrgUnitName, deleteOrgUnitName,
    getAllPositionTitles, createPositionTitle, updatePositionTitle, deletePositionTitle,
} = require('../controllers/catalogController');

// Tất cả routes cần đăng nhập + admin
router.use(verifyToken, requireRole('admin'));

// ── Organizations (Cơ cấu tổ chức) ──────────────────────────────────────────
router.get('/organizations', getAllOrgs);
router.post('/organizations', createOrg);
router.put('/organizations/:id', updateOrg);
router.delete('/organizations/:id', deleteOrg);

// ── Personnel (Quản lý nhân sự) ──────────────────────────────────────────────
router.get('/personnel', getAllPersonnel);
router.get('/personnel/:id', getPersonnelById);
router.post('/personnel', createPersonnel);
router.put('/personnel/:id', updatePersonnel);
router.patch('/personnel/:id/toggle-active', togglePersonnelActive);
router.put('/personnel/:id/reset-password', resetPersonnelPassword);
router.get('/personnel/:id/permissions', getPersonnelPermissions);
router.put('/personnel/:id/permissions', savePersonnelPermissions);

// ── User accounts (Quản lý tài khoản) ────────────────────────────────────────
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.patch('/users/:id/toggle-active', toggleActive);
router.put('/users/:id/reset-password', resetPassword);

// ── Departments (cũ, giữ compatibility) ──────────────────────────────────────
router.get('/departments', getDepartments);

// ── Role Configs ──────────────────────────────────────────────────────────────
router.get('/role-configs', getAllRoleConfigs);
router.post('/role-configs', createRoleConfig);
router.put('/role-configs/:id', updateRoleConfig);
router.delete('/role-configs/:id', deleteRoleConfig);

// ── Catalog — Loại đơn vị ─────────────────────────────────────────────────────
router.get('/catalog/org-types', getAllOrgTypes);
router.post('/catalog/org-types', createOrgType);
router.put('/catalog/org-types/:id', updateOrgType);
router.delete('/catalog/org-types/:id', deleteOrgType);

// ── Catalog — Tên đơn vị ──────────────────────────────────────────────────────
router.get('/catalog/org-unit-names', getAllOrgUnitNames);
router.post('/catalog/org-unit-names', createOrgUnitName);
router.put('/catalog/org-unit-names/:id', updateOrgUnitName);
router.delete('/catalog/org-unit-names/:id', deleteOrgUnitName);

// ── Catalog — Chức danh ────────────────────────────────────────────────────────
router.get('/catalog/position-titles', getAllPositionTitles);
router.post('/catalog/position-titles', createPositionTitle);
router.put('/catalog/position-titles/:id', updatePositionTitle);
router.delete('/catalog/position-titles/:id', deletePositionTitle);

module.exports = router;
