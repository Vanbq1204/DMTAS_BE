const path = require('path');
const db = require('../config/db');
const { uploadBuffer, getObjectBuffer, removeObject } = require('../utils/minioClient');

const ok = (res, data, msg = 'OK') => res.json({ success: true, message: msg, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });

const allowedMime = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const allowedType = new Set(['signature', 'stamp']);

const initTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS user_sign_assets (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            asset_type  VARCHAR(20) NOT NULL CHECK (asset_type IN ('signature','stamp')),
            display_name VARCHAR(255),
            object_key  TEXT NOT NULL,
            mime_type   VARCHAR(100),
            file_size   INTEGER,
            is_default  BOOLEAN DEFAULT false,
            created_at  TIMESTAMP DEFAULT NOW(),
            updated_at  TIMESTAMP DEFAULT NOW(),
            is_deleted  BOOLEAN DEFAULT false
        )
    `);
};
initTable().catch((e) => console.error('init user_sign_assets error:', e));

const listAssets = async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await db.query(
            `SELECT id, asset_type, display_name, mime_type, file_size, is_default, created_at, updated_at
             FROM user_sign_assets
             WHERE user_id = $1 AND is_deleted = false
             ORDER BY asset_type, is_default DESC, updated_at DESC`,
            [userId]
        );
        return ok(res, result.rows);
    } catch (err) {
        console.error('listAssets error:', err);
        return fail(res, 'Lỗi lấy danh sách chữ ký/con dấu', 500);
    }
};

const uploadAsset = async (req, res) => {
    const userId = req.user.id;
    const assetType = (req.body?.asset_type || '').toString().trim();
    const displayName = (req.body?.display_name || req.file?.originalname || '').toString().trim();

    if (!req.file) return fail(res, 'Vui lòng chọn file ảnh');
    if (!allowedType.has(assetType)) return fail(res, 'Loại tài sản không hợp lệ');
    if (!allowedMime.has((req.file.mimetype || '').toLowerCase())) {
        return fail(res, 'Chỉ hỗ trợ ảnh PNG/JPG/WEBP');
    }

    try {
        const ext = path.extname(req.file.originalname || '').toLowerCase() || '.png';
        const objectKey = `sign-assets/${userId}/${assetType}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        await uploadBuffer(objectKey, req.file.buffer, {
            'Content-Type': req.file.mimetype || 'application/octet-stream',
        });

        await db.query(
            `UPDATE user_sign_assets
             SET is_default = false, updated_at = NOW()
             WHERE user_id = $1 AND asset_type = $2 AND is_default = true AND is_deleted = false`,
            [userId, assetType]
        );

        const inserted = await db.query(
            `INSERT INTO user_sign_assets
             (user_id, asset_type, display_name, object_key, mime_type, file_size, is_default)
             VALUES ($1,$2,$3,$4,$5,$6,true)
             RETURNING id, asset_type, display_name, mime_type, file_size, is_default, created_at, updated_at`,
            [userId, assetType, displayName || null, objectKey, req.file.mimetype || null, req.file.size || null]
        );
        return ok(res, inserted.rows[0], 'Tải lên thành công');
    } catch (err) {
        console.error('uploadAsset error:', err);
        return fail(res, 'Lỗi tải ảnh chữ ký/con dấu', 500);
    }
};

const updateAsset = async (req, res) => {
    const userId = req.user.id;
    const assetId = req.params.id;
    const displayName = (req.body?.display_name || '').toString().trim();
    const isDefault = req.body?.is_default;
    try {
        const own = await db.query(
            `SELECT id, user_id, asset_type
             FROM user_sign_assets
             WHERE id = $1 AND is_deleted = false`,
            [assetId]
        );
        if (!own.rows.length) return fail(res, 'Không tìm thấy tài sản', 404);
        if (Number(own.rows[0].user_id) !== Number(userId)) return fail(res, 'Không có quyền', 403);

        if (isDefault === true || isDefault === 'true') {
            await db.query(
                `UPDATE user_sign_assets
                 SET is_default = false, updated_at = NOW()
                 WHERE user_id = $1 AND asset_type = $2 AND is_deleted = false`,
                [userId, own.rows[0].asset_type]
            );
        }

        const updated = await db.query(
            `UPDATE user_sign_assets
             SET display_name = COALESCE($1, display_name),
                 is_default = COALESCE($2::boolean, is_default),
                 updated_at = NOW()
             WHERE id = $3
             RETURNING id, asset_type, display_name, mime_type, file_size, is_default, created_at, updated_at`,
            [displayName || null, typeof isDefault === 'undefined' ? null : isDefault, assetId]
        );
        return ok(res, updated.rows[0], 'Cập nhật thành công');
    } catch (err) {
        console.error('updateAsset error:', err);
        return fail(res, 'Lỗi cập nhật tài sản', 500);
    }
};

const deleteAsset = async (req, res) => {
    const userId = req.user.id;
    const assetId = req.params.id;
    try {
        const own = await db.query(
            `SELECT id, user_id, object_key
             FROM user_sign_assets
             WHERE id = $1 AND is_deleted = false`,
            [assetId]
        );
        if (!own.rows.length) return fail(res, 'Không tìm thấy tài sản', 404);
        if (Number(own.rows[0].user_id) !== Number(userId)) return fail(res, 'Không có quyền', 403);

        await db.query(
            `UPDATE user_sign_assets
             SET is_deleted = true, is_default = false, updated_at = NOW()
             WHERE id = $1`,
            [assetId]
        );
        try { await removeObject(own.rows[0].object_key); } catch (_) {}
        return ok(res, { id: Number(assetId) }, 'Đã xóa');
    } catch (err) {
        console.error('deleteAsset error:', err);
        return fail(res, 'Lỗi xóa tài sản', 500);
    }
};

const streamAsset = async (req, res) => {
    const userId = req.user.id;
    const assetId = req.params.id;
    try {
        const own = await db.query(
            `SELECT id, user_id, object_key, mime_type
             FROM user_sign_assets
             WHERE id = $1 AND is_deleted = false`,
            [assetId]
        );
        if (!own.rows.length) return fail(res, 'Không tìm thấy tài sản', 404);
        if (Number(own.rows[0].user_id) !== Number(userId)) return fail(res, 'Không có quyền', 403);

        const buf = await getObjectBuffer(own.rows[0].object_key);
        res.setHeader('Content-Type', own.rows[0].mime_type || 'application/octet-stream');
        res.setHeader('Cache-Control', 'private, max-age=60');
        return res.send(buf);
    } catch (err) {
        console.error('streamAsset error:', err);
        return fail(res, 'Không tải được ảnh chữ ký/con dấu', 500);
    }
};

module.exports = {
    listAssets,
    uploadAsset,
    updateAsset,
    deleteAsset,
    streamAsset,
};
