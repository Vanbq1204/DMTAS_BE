const db = require('../config/db');
const logWorkProfileHistory = require('../helpers/logWorkProfileHistory');

const ok = (res, data, msg = 'OK') => res.json({ success: true, message: msg, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, message: msg });
const ALLOWED_ROLES = new Set(['van_thu', 'lanh_dao', 'nhan_vien']);
const ALLOWED_STATUS = new Set(['dang_xu_ly', 'da_ket_thuc']);
const ALLOWED_CHU_TRI_STATUS = new Set(['chua_xu_ly', 'da_xu_ly', 'cho_chuyen_luu_tru', 'da_chuyen_luu_tru']);
const toISODate = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
        const s = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return '';
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
};

const parseParticipants = (raw) => {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item) => ({
            userId: Number(item?.userId) || null,
            name: String(item?.name || '').trim(),
            role: String(item?.role || '').trim(),
            chucVu: String(item?.chucVu || '').trim(),
            status: String(item?.status || '').trim() || 'chua_xu_ly',
            request: String(item?.request || '').trim(),
            deadline: item?.deadline ? String(item.deadline).slice(0, 10) : '',
        }))
        .filter((item) => item.userId);
};

const clampPercent = (value) => {
    const n = Number(value);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
};

const normalizePayload = (body = {}) => ({
    heading_id: body.loaiHoSoId ? Number(body.loaiHoSoId) : null,
    ky_hieu: String(body.kyHieu || '').trim(),
    loai_ho_so: String(body.loaiHoSo || '').trim(),
    ma_ky_hieu_tien_to: String(body.maKyHieuTienTo || '').trim(),
    tieu_de: String(body.tieuDe || '').trim(),
    noi_dung: String(body.noiDung || '').trim(),
    van_ban_den_id: body.vanBanDenId ? Number(body.vanBanDenId) : null,
    van_ban_den_chu_tri_text: String(body.vanBanDenChuTriText || '').trim(),
    lanh_dao_phu_trach_id: body.lanhDaoPhuTrachId ? Number(body.lanhDaoPhuTrachId) : null,
    chu_tri_xu_ly_id: body.chuTriXuLyId ? Number(body.chuTriXuLyId) : null,
    chu_tri_trang_thai: ALLOWED_CHU_TRI_STATUS.has(body.chuTriTrangThai) ? body.chuTriTrangThai : 'chua_xu_ly',
    han_xu_ly: body.hanXuLy ? toISODate(body.hanXuLy) : null,
    ngay_xu_ly: body.ngayXuLy ? toISODate(body.ngayXuLy) : null,
    tinh_trang_xu_ly: ALLOWED_STATUS.has(body.tinhTrangXuLy) ? body.tinhTrangXuLy : 'dang_xu_ly',
    tien_do: clampPercent(body.tienDo ?? body.tien_do ?? 0),
    nguoi_tao: String(body.nguoiTao || '').trim(),
    don_vi_tao: String(body.donViTao || '').trim(),
    ngay_tao: body.ngayTao ? toISODate(body.ngayTao) : new Date().toISOString().slice(0, 10),
    participants: parseParticipants(body.participants),
});

const toClientShape = (row) => ({
    id: row.id,
    loaiHoSoId: row.heading_id ? String(row.heading_id) : '',
    kyHieu: row.ky_hieu || '',
    loaiHoSo: row.loai_ho_so || '',
    maKyHieuTienTo: row.ma_ky_hieu_tien_to || '',
    tieuDe: row.tieu_de || '',
    noiDung: row.noi_dung || '',
    vanBanDenId: row.van_ban_den_id ? String(row.van_ban_den_id) : '',
    vanBanDenChuTriText: row.van_ban_den_chu_tri_text || '',
    lanhDaoPhuTrachId: row.lanh_dao_phu_trach_id ? String(row.lanh_dao_phu_trach_id) : '',
    chuTriXuLyId: row.chu_tri_xu_ly_id ? String(row.chu_tri_xu_ly_id) : '',
    chuTriTrangThai: row.chu_tri_trang_thai || 'chua_xu_ly',
    hanXuLy: toISODate(row.han_xu_ly),
    ngayXuLy: toISODate(row.ngay_xu_ly),
    tinhTrangXuLy: row.tinh_trang_xu_ly || 'dang_xu_ly',
    tienDo: clampPercent(row.tien_do ?? 0),
    nguoiTao: row.nguoi_tao || '',
    donViTao: row.don_vi_tao || '',
    ngayTao: toISODate(row.ngay_tao),
    participants: Array.isArray(row.participants) ? row.participants : [],
    // Duyệt kết thúc 2 bước
    phuTrachKetThucStatus: row.phu_trach_ket_thuc_status || 'pending',
    phuTrachKetThucComment: row.phu_trach_ket_thuc_comment || '',
    phuTrachKetThucAt: row.phu_trach_ket_thuc_at || null,
    chuTriKetThucStatus: row.chu_tri_ket_thuc_status || 'pending',
    chuTriKetThucComment: row.chu_tri_ket_thuc_comment || '',
    chuTriKetThucAt: row.chu_tri_ket_thuc_at || null,
    // Đánh giá
    evaluationStatus: row.evaluation_status || 'pending',
    evaluationDelegatedToId: row.evaluation_delegated_to_id ? String(row.evaluation_delegated_to_id) : '',
    createdById: row.created_by_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const validatePayload = async (payload) => {
    if (!payload.ky_hieu) return 'Thiếu ký hiệu hồ sơ.';
    if (!payload.tieu_de) return 'Thiếu tiêu đề hồ sơ.';
    if (payload.han_xu_ly && payload.ngay_tao && payload.han_xu_ly <= payload.ngay_tao) {
        return 'Hạn xử lý phải lớn hơn ngày tạo.';
    }
    return null;
};

const list = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const orgId = Number(req.user?.orgId) || null;
    if (!userId || !ALLOWED_ROLES.has(role)) {
        return fail(res, 'Không xác định được người dùng hoặc role.', 403);
    }
    try {
        const result = await db.query(
            `SELECT *
             FROM work_profiles
             WHERE created_by_id = $1
                OR lanh_dao_phu_trach_id = $1
                OR chu_tri_xu_ly_id = $1
                OR EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(work_profiles.participants) AS p
                    WHERE (p->>'userId')::int = $1
                )
             ORDER BY created_at DESC, id DESC`,
            [userId]
        );
        return ok(res, result.rows.map(toClientShape));
    } catch (e) {
        if (e.code === '42P01') {
            return fail(res, 'Chưa chạy migration bảng work_profiles. Vui lòng chạy file migrations/012_work_profiles.sql', 500);
        }
        console.error('workProfile list:', e);
        return fail(res, 'Lỗi server khi tải hồ sơ công việc', 500);
    }
};

const create = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const orgId = Number(req.user?.orgId) || null;
    if (!userId || !ALLOWED_ROLES.has(role)) {
        return fail(res, 'Không xác định được người dùng hoặc role.', 403);
    }
    try {
        const payload = normalizePayload(req.body || {});
        const validationError = await validatePayload(payload);
        if (validationError) return fail(res, validationError);

        const result = await db.query(
            `INSERT INTO work_profiles (
                role, created_by_id, heading_id, ky_hieu, loai_ho_so, ma_ky_hieu_tien_to,
                tieu_de, noi_dung, van_ban_den_id, van_ban_den_chu_tri_text,
                lanh_dao_phu_trach_id, chu_tri_xu_ly_id, chu_tri_trang_thai,
                han_xu_ly, ngay_xu_ly, tinh_trang_xu_ly, tien_do, nguoi_tao, don_vi_tao, ngay_tao, participants
             ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb
             )
             RETURNING *`,
            [
                role, userId, payload.heading_id, payload.ky_hieu, payload.loai_ho_so, payload.ma_ky_hieu_tien_to,
                payload.tieu_de, payload.noi_dung, payload.van_ban_den_id, payload.van_ban_den_chu_tri_text,
                payload.lanh_dao_phu_trach_id, payload.chu_tri_xu_ly_id, payload.chu_tri_trang_thai,
                payload.han_xu_ly, payload.ngay_xu_ly, payload.tinh_trang_xu_ly, payload.tien_do, payload.nguoi_tao, payload.don_vi_tao, payload.ngay_tao,
                JSON.stringify(payload.participants),
            ]
        );
        const newProfile = result.rows[0];
        await logWorkProfileHistory({
            profileId: newProfile.id,
            userId,
            hanhDong: 'TAO_HO_SO',
            noiDung: `Tạo hồ sơ: ${newProfile.tieu_de}`,
            denTrangThai: newProfile.tinh_trang_xu_ly,
        });
        return ok(res, toClientShape(newProfile), 'Đã tạo hồ sơ công việc.');
    } catch (e) {
        console.error('workProfile create:', e);
        return fail(res, 'Lỗi server khi tạo hồ sơ công việc', 500);
    }
};

const update = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const orgId = Number(req.user?.orgId) || null;
    const id = Number(req.params.id);
    if (!userId || !ALLOWED_ROLES.has(role)) {
        return fail(res, 'Không xác định được người dùng hoặc role.', 403);
    }
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const payload = normalizePayload(req.body || {});
        const validationError = await validatePayload(payload);
        if (validationError) return fail(res, validationError);

        const result = await db.query(
            `UPDATE work_profiles
             SET heading_id = $1,
                 ky_hieu = $2,
                 loai_ho_so = $3,
                 ma_ky_hieu_tien_to = $4,
                 tieu_de = $5,
                 noi_dung = $6,
                 van_ban_den_id = $7,
                 van_ban_den_chu_tri_text = $8,
                 lanh_dao_phu_trach_id = $9,
                 chu_tri_xu_ly_id = $10,
                 chu_tri_trang_thai = $11,
                 han_xu_ly = $12,
                 ngay_xu_ly = $13,
                 tinh_trang_xu_ly = $14,
                 tien_do = $15,
                 nguoi_tao = $16,
                 don_vi_tao = $17,
                 ngay_tao = $18,
                 participants = $19::jsonb,
                 updated_at = NOW()
             WHERE id = $20
               AND (
                    created_by_id = $21
                    OR lanh_dao_phu_trach_id = $21
                    OR chu_tri_xu_ly_id = $21
                    OR EXISTS (
                        SELECT 1 FROM jsonb_array_elements(work_profiles.participants) AS p
                        WHERE (p->>'userId')::int = $21
                    )
               )
             RETURNING *`,
            [
                payload.heading_id, payload.ky_hieu, payload.loai_ho_so, payload.ma_ky_hieu_tien_to, payload.tieu_de,
                payload.noi_dung, payload.van_ban_den_id, payload.van_ban_den_chu_tri_text,
                payload.lanh_dao_phu_trach_id, payload.chu_tri_xu_ly_id, payload.chu_tri_trang_thai,
                payload.han_xu_ly, payload.ngay_xu_ly, payload.tinh_trang_xu_ly, payload.tien_do, payload.nguoi_tao, payload.don_vi_tao, payload.ngay_tao,
                JSON.stringify(payload.participants),
                id, userId,
            ]
        );
        if (!result.rows.length) return fail(res, 'Không tìm thấy hồ sơ hoặc không có quyền.', 404);
        await logWorkProfileHistory({
            profileId: id,
            userId,
            hanhDong: 'CAP_NHAT',
            noiDung: `Cập nhật hồ sơ: ${result.rows[0].tieu_de}`,
        });
        return ok(res, toClientShape(result.rows[0]), 'Đã cập nhật hồ sơ.');
    } catch (e) {
        console.error('workProfile update:', e);
        return fail(res, 'Lỗi server khi cập nhật hồ sơ công việc', 500);
    }
};

const destroy = async (req, res) => {
    const userId = req.user?.id;
    const role = req.user?.role;
    const id = Number(req.params.id);
    if (!userId || !ALLOWED_ROLES.has(role)) {
        return fail(res, 'Không xác định được người dùng hoặc role.', 403);
    }
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const checkRes = await db.query(
            `SELECT id, tinh_trang_xu_ly,
                    created_by_id, lanh_dao_phu_trach_id, chu_tri_xu_ly_id,
                    participants
             FROM work_profiles
             WHERE id = $1`,
            [id]
        );
        if (!checkRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = checkRes.rows[0];

        const uid = Number(userId);
        const hasRight =
            Number(profile.created_by_id) === uid
            || Number(profile.lanh_dao_phu_trach_id) === uid
            || Number(profile.chu_tri_xu_ly_id) === uid
            || (Array.isArray(profile.participants) && profile.participants.some((p) => Number(p?.userId) === uid));
        if (!hasRight) {
            return fail(res, 'Bạn không có quyền xoá hồ sơ này.', 403);
        }

        if (profile.tinh_trang_xu_ly !== 'da_ket_thuc') {
            return fail(res, 'Chỉ được xoá hồ sơ đã kết thúc. Hồ sơ này vẫn đang xử lý.', 409);
        }

        const result = await db.query(
            `DELETE FROM work_profiles WHERE id = $1 RETURNING id`,
            [id]
        );
        if (!result.rows.length) return fail(res, 'Không xoá được hồ sơ.', 500);
        return ok(res, { id }, 'Đã xoá hồ sơ.');
    } catch (e) {
        console.error('workProfile delete:', e);
        return fail(res, 'Lỗi server khi xóa hồ sơ công việc', 500);
    }
};

/** PATCH /ho-so/cong-viec/:id/trang-thai-chu-tri — chủ trì cập nhật trạng thái xử lý */
const updateChuTriStatus = async (req, res) => {
    const userId = req.user?.id;
    const id = Number(req.params.id);
    const { chuTriTrangThai } = req.body || {};
    if (!ALLOWED_CHU_TRI_STATUS.has(chuTriTrangThai)) {
        return fail(res, 'Trạng thái không hợp lệ.');
    }
    try {
        const profileRes = await db.query(
            `SELECT id, chu_tri_xu_ly_id, chu_tri_trang_thai FROM work_profiles WHERE id = $1`,
            [id]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        if (Number(profile.chu_tri_xu_ly_id) !== Number(userId)) {
            return fail(res, 'Chỉ chủ trì xử lý mới được cập nhật trạng thái này.', 403);
        }
        const tuTrangThai = profile.chu_tri_trang_thai;
        await db.query(
            `UPDATE work_profiles SET chu_tri_trang_thai = $1, updated_at = NOW() WHERE id = $2`,
            [chuTriTrangThai, id]
        );
        await logWorkProfileHistory({
            profileId: id,
            userId,
            hanhDong: 'CHUYEN_TRANG_THAI',
            noiDung: `Chuyển trạng thái chủ trì: ${tuTrangThai} → ${chuTriTrangThai}`,
            tuTrangThai,
            denTrangThai: chuTriTrangThai,
        });
        return ok(res, { id, chuTriTrangThai }, 'Đã cập nhật trạng thái xử lý.');
    } catch (e) {
        console.error('workProfile updateChuTriStatus:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** PATCH /ho-so/cong-viec/:id/phan-cong — phụ trách đổi chủ trì hoặc thêm/xóa người phối hợp */
const phanCong = async (req, res) => {
    const userId = req.user?.id;
    const id = Number(req.params.id);
    const { chuTriXuLyId, participants } = req.body || {};
    try {
        const profileRes = await db.query(
            `SELECT id, lanh_dao_phu_trach_id, chu_tri_xu_ly_id, participants FROM work_profiles WHERE id = $1`,
            [id]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        if (Number(profile.lanh_dao_phu_trach_id) !== Number(userId)) {
            return fail(res, 'Chỉ lãnh đạo phụ trách mới được phân công.', 403);
        }
        const updates = [];
        const params = [];
        let idx = 1;
        if (chuTriXuLyId !== undefined) {
            updates.push(`chu_tri_xu_ly_id = $${idx++}`);
            params.push(chuTriXuLyId ? Number(chuTriXuLyId) : null);
        }
        if (participants !== undefined) {
            updates.push(`participants = $${idx++}::jsonb`);
            params.push(JSON.stringify(parseParticipants(participants)));
        }
        if (!updates.length) return fail(res, 'Không có thay đổi nào.');
        updates.push(`updated_at = NOW()`);
        params.push(id);
        await db.query(
            `UPDATE work_profiles SET ${updates.join(', ')} WHERE id = $${idx}`,
            params
        );
        const logParts = [];
        if (chuTriXuLyId !== undefined) logParts.push(`Đổi chủ trì → userId ${chuTriXuLyId}`);
        if (participants !== undefined) logParts.push(`Cập nhật danh sách phối hợp`);
        await logWorkProfileHistory({
            profileId: id,
            userId,
            hanhDong: 'THEM_NGUOI',
            noiDung: logParts.join('; '),
        });
        return ok(res, { id }, 'Đã cập nhật phân công.');
    } catch (e) {
        console.error('workProfile phanCong:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** Kiểm tra: có được phép tiến hành duyệt kết thúc (tất cả đầu việc non-rejected đã hoàn thành)? */
const allTasksDone = async (profileId) => {
    const r = await db.query(
        `SELECT
            COUNT(*) FILTER (WHERE accept_status <> 'rejected')                                   AS total,
            COUNT(*) FILTER (WHERE accept_status <> 'rejected' AND trang_thai = 'da_hoan_thanh') AS done
         FROM work_profile_tasks WHERE profile_id = $1`,
        [profileId]
    );
    const total = Number(r.rows[0]?.total || 0);
    const done = Number(r.rows[0]?.done || 0);
    return total > 0 && total === done;
};

/** PATCH /ho-so/cong-viec/:id/duyet-ket-thuc
 *  Body: { comment: string }
 *  Multipart (chủ trì): files[] — file báo cáo kết quả cuối (loai_file='ket_qua_cuoi')
 *  Role được xác định tự động theo lanh_dao_phu_trach_id / chu_tri_xu_ly_id.
 *  - Phụ trách duyệt: cập nhật phu_trach_ket_thuc_status='approved' + comment.
 *  - Chủ trì duyệt: cập nhật chu_tri_ket_thuc_status='approved' + comment + upload file kết quả cuối.
 *  - Khi CẢ HAI approved → tinh_trang_xu_ly='da_ket_thuc', ngay_xu_ly = CURRENT_DATE.
 */
const duyetKetThuc = async (req, res) => {
    const userId = req.user?.id;
    const id = Number(req.params.id);
    const comment = String(req.body?.comment || '').trim();
    const files = req.files || [];
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    if (!comment) return fail(res, 'Vui lòng nhập ý kiến duyệt kết thúc.');

    try {
        const profileRes = await db.query(
            `SELECT id, lanh_dao_phu_trach_id, chu_tri_xu_ly_id, tinh_trang_xu_ly,
                    phu_trach_ket_thuc_status, chu_tri_ket_thuc_status, evaluation_status
             FROM work_profiles WHERE id = $1`,
            [id]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        if (profile.tinh_trang_xu_ly === 'da_ket_thuc') {
            return fail(res, 'Hồ sơ đã kết thúc.');
        }

        const isPhuTrach = Number(profile.lanh_dao_phu_trach_id) === Number(userId);
        const isChuTri = Number(profile.chu_tri_xu_ly_id) === Number(userId);
        if (!isPhuTrach && !isChuTri) {
            return fail(res, 'Chỉ chủ trì hoặc phụ trách mới được duyệt kết thúc.', 403);
        }

        // Điều kiện tiên quyết: tất cả đầu việc phải hoàn thành
        const done = await allTasksDone(id);
        if (!done) {
            return fail(res, 'Chưa đủ điều kiện duyệt kết thúc: còn đầu việc chưa hoàn thành.');
        }

        const role = isPhuTrach ? 'phu_trach' : 'chu_tri';

        if (role === 'phu_trach') {
            if (profile.phu_trach_ket_thuc_status === 'approved') {
                return fail(res, 'Bạn đã duyệt trước đó.');
            }
            // Phụ trách duyệt cần đánh giá xong hoặc đã bỏ qua/uỷ quyền
            if (profile.evaluation_status === 'pending') {
                return fail(res, 'Vui lòng đánh giá thành viên (hoặc bỏ qua/uỷ quyền) trước khi duyệt kết thúc.');
            }
            await db.query(
                `UPDATE work_profiles
                 SET phu_trach_ket_thuc_status = 'approved',
                     phu_trach_ket_thuc_comment = $2,
                     phu_trach_ket_thuc_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1`,
                [id, comment]
            );
        } else {
            if (profile.chu_tri_ket_thuc_status === 'approved') {
                return fail(res, 'Bạn đã duyệt trước đó.');
            }
            await db.query(
                `UPDATE work_profiles
                 SET chu_tri_ket_thuc_status = 'approved',
                     chu_tri_ket_thuc_comment = $2,
                     chu_tri_ket_thuc_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1`,
                [id, comment]
            );
            // Upload file báo cáo cuối (loai_file='ket_qua_cuoi')
            for (const file of files) {
                await db.query(
                    `INSERT INTO work_profile_files
                        (profile_id, loai_file, ten_file, duong_dan, kich_thuoc, doc_type, uploaded_by)
                     VALUES ($1, 'ket_qua_cuoi', $2, $3, $4, 'upload', $5)`,
                    [id, file.originalname, file.filename, file.size, userId]
                );
            }
        }

        await logWorkProfileHistory({
            profileId: id,
            userId,
            hanhDong: role === 'phu_trach' ? 'PHU_TRACH_DUYET_KET_THUC' : 'CHU_TRI_DUYET_KET_THUC',
            noiDung: `${role === 'phu_trach' ? 'Phụ trách' : 'Chủ trì'} duyệt kết thúc${role === 'chu_tri' && files.length ? ` (kèm ${files.length} file báo cáo)` : ''}. Ý kiến: ${comment}`,
            meta: { role, fileCount: role === 'chu_tri' ? files.length : 0 },
        });

        // Sau khi duyệt, kiểm tra cả hai đã approved chưa → kết thúc
        const reload = await db.query(
            `SELECT phu_trach_ket_thuc_status, chu_tri_ket_thuc_status
             FROM work_profiles WHERE id = $1`, [id]
        );
        const p = reload.rows[0];
        let bothApproved = false;
        if (p.phu_trach_ket_thuc_status === 'approved' && p.chu_tri_ket_thuc_status === 'approved') {
            bothApproved = true;
            await db.query(
                `UPDATE work_profiles
                 SET tinh_trang_xu_ly = 'da_ket_thuc',
                     ngay_xu_ly = CURRENT_DATE,
                     chu_tri_trang_thai = 'da_xu_ly',
                     updated_at = NOW()
                 WHERE id = $1`,
                [id]
            );
            await logWorkProfileHistory({
                profileId: id,
                userId,
                hanhDong: 'KET_THUC_HO_SO',
                noiDung: 'Hồ sơ được duyệt kết thúc (cả chủ trì và phụ trách đều đã duyệt).',
                tuTrangThai: profile.tinh_trang_xu_ly,
                denTrangThai: 'da_ket_thuc',
            });
        }

        return ok(res, {
            id,
            role,
            bothApproved,
            tinhTrangXuLy: bothApproved ? 'da_ket_thuc' : profile.tinh_trang_xu_ly,
        }, bothApproved ? 'Hồ sơ đã được duyệt kết thúc.' : 'Đã ghi nhận duyệt. Chờ bên còn lại duyệt để kết thúc.');
    } catch (e) {
        console.error('workProfile duyetKetThuc:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/* ══════════════════════════════════════════════════════════
 *  ĐÁNH GIÁ HIỆU QUẢ THÀNH VIÊN
 * ══════════════════════════════════════════════════════════ */

/** GET /ho-so/cong-viec/:id/danh-gia */
const listEvaluations = async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const r = await db.query(
            `SELECT e.*, u.full_name AS evaluated_name, ur.full_name AS evaluator_name
             FROM work_profile_evaluations e
             LEFT JOIN users u  ON u.id  = e.evaluated_user_id
             LEFT JOIN users ur ON ur.id = e.evaluator_user_id
             WHERE e.profile_id = $1
             ORDER BY e.id ASC`,
            [id]
        );
        return ok(res, r.rows.map((row) => ({
            id: row.id,
            profileId: row.profile_id,
            evaluatedUserId: row.evaluated_user_id,
            evaluatedName: row.evaluated_name || '',
            evaluatorUserId: row.evaluator_user_id,
            evaluatorName: row.evaluator_name || '',
            evaluatorRole: row.evaluator_role,
            score: Number(row.score),
            comment: row.comment || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })));
    } catch (e) {
        console.error('workProfile listEvaluations:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/danh-gia
 *  Body: { evaluations: [{ evaluatedUserId, score, comment }] }
 *  Người có quyền đánh giá:
 *   - Lãnh đạo phụ trách (mặc định)
 *   - Chủ trì (chỉ khi evaluation_status = 'delegated' và evaluation_delegated_to_id = chu_tri_xu_ly_id)
 */
const submitEvaluations = async (req, res) => {
    const userId = req.user?.id;
    const id = Number(req.params.id);
    const evaluations = Array.isArray(req.body?.evaluations) ? req.body.evaluations : [];
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    if (!evaluations.length) return fail(res, 'Chưa có đánh giá nào.');

    try {
        const profileRes = await db.query(
            `SELECT id, lanh_dao_phu_trach_id, chu_tri_xu_ly_id, evaluation_status, evaluation_delegated_to_id
             FROM work_profiles WHERE id = $1`,
            [id]
        );
        if (!profileRes.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = profileRes.rows[0];
        const isPhuTrach = Number(profile.lanh_dao_phu_trach_id) === Number(userId);
        const isDelegatedChuTri =
            profile.evaluation_status === 'delegated' &&
            Number(profile.evaluation_delegated_to_id) === Number(userId) &&
            Number(profile.chu_tri_xu_ly_id) === Number(userId);
        if (!isPhuTrach && !isDelegatedChuTri) {
            return fail(res, 'Bạn không có quyền đánh giá hồ sơ này.', 403);
        }
        const evaluatorRole = isPhuTrach ? 'phu_trach' : 'chu_tri';

        for (const ev of evaluations) {
            const evaluatedUserId = Number(ev.evaluatedUserId);
            const score = Number(ev.score);
            const comment = String(ev.comment || '').trim();
            if (!evaluatedUserId) continue;
            if (Number.isNaN(score) || score < 0 || score > 10) {
                return fail(res, 'Điểm đánh giá phải từ 0 đến 10.');
            }
            await db.query(
                `INSERT INTO work_profile_evaluations
                    (profile_id, evaluated_user_id, evaluator_user_id, evaluator_role, score, comment)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (profile_id, evaluated_user_id) DO UPDATE
                    SET evaluator_user_id = EXCLUDED.evaluator_user_id,
                        evaluator_role    = EXCLUDED.evaluator_role,
                        score             = EXCLUDED.score,
                        comment           = EXCLUDED.comment,
                        updated_at        = NOW()`,
                [id, evaluatedUserId, userId, evaluatorRole, score, comment]
            );
        }

        await db.query(
            `UPDATE work_profiles SET evaluation_status = 'done', updated_at = NOW() WHERE id = $1`,
            [id]
        );
        await logWorkProfileHistory({
            profileId: id,
            userId,
            hanhDong: 'DANH_GIA_THANH_VIEN',
            noiDung: `${evaluatorRole === 'phu_trach' ? 'Phụ trách' : 'Chủ trì (được uỷ quyền)'} đã đánh giá ${evaluations.length} thành viên.`,
            meta: { count: evaluations.length, evaluatorRole },
        });
        return ok(res, { id, evaluationStatus: 'done' }, 'Đã ghi nhận đánh giá.');
    } catch (e) {
        console.error('workProfile submitEvaluations:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/danh-gia/bo-qua — Phụ trách bỏ qua đánh giá */
const skipEvaluation = async (req, res) => {
    const userId = req.user?.id;
    const id = Number(req.params.id);
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const r = await db.query(
            `SELECT id, lanh_dao_phu_trach_id, evaluation_status FROM work_profiles WHERE id = $1`, [id]
        );
        if (!r.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        if (Number(r.rows[0].lanh_dao_phu_trach_id) !== Number(userId)) {
            return fail(res, 'Chỉ lãnh đạo phụ trách mới bỏ qua đánh giá.', 403);
        }
        await db.query(
            `UPDATE work_profiles
             SET evaluation_status = 'skipped',
                 evaluation_delegated_to_id = NULL,
                 updated_at = NOW()
             WHERE id = $1`, [id]
        );
        await logWorkProfileHistory({
            profileId: id, userId,
            hanhDong: 'DANH_GIA_BO_QUA',
            noiDung: 'Phụ trách bỏ qua đánh giá thành viên.',
        });
        return ok(res, { id, evaluationStatus: 'skipped' }, 'Đã bỏ qua đánh giá.');
    } catch (e) {
        console.error('workProfile skipEvaluation:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** POST /ho-so/cong-viec/:id/danh-gia/uy-quyen — Phụ trách uỷ quyền chủ trì đánh giá */
const delegateEvaluation = async (req, res) => {
    const userId = req.user?.id;
    const id = Number(req.params.id);
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const r = await db.query(
            `SELECT id, lanh_dao_phu_trach_id, chu_tri_xu_ly_id, evaluation_status FROM work_profiles WHERE id = $1`, [id]
        );
        if (!r.rows.length) return fail(res, 'Không tìm thấy hồ sơ.', 404);
        const profile = r.rows[0];
        if (Number(profile.lanh_dao_phu_trach_id) !== Number(userId)) {
            return fail(res, 'Chỉ lãnh đạo phụ trách mới uỷ quyền đánh giá.', 403);
        }
        if (!profile.chu_tri_xu_ly_id) {
            return fail(res, 'Hồ sơ chưa có chủ trì để uỷ quyền.');
        }
        await db.query(
            `UPDATE work_profiles
             SET evaluation_status = 'delegated',
                 evaluation_delegated_to_id = $2,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, profile.chu_tri_xu_ly_id]
        );
        await logWorkProfileHistory({
            profileId: id, userId,
            hanhDong: 'DANH_GIA_UY_QUYEN',
            noiDung: 'Phụ trách uỷ quyền chủ trì đánh giá thành viên.',
        });
        return ok(res, { id, evaluationStatus: 'delegated' }, 'Đã uỷ quyền chủ trì đánh giá.');
    } catch (e) {
        console.error('workProfile delegateEvaluation:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

/** PATCH /ho-so/cong-viec/:id/tien-do — DEPRECATED
 * Tiến độ hiện tự động tính theo số đầu việc đã duyệt / tổng số đầu việc.
 * Giữ endpoint để tương thích ngược, nhưng chỉ trả về giá trị auto-compute hiện tại.
 */
const updateTienDo = async (req, res) => {
    const userId = req.user?.id;
    const id = Number(req.params.id);
    if (!userId) return fail(res, 'Không xác định được người dùng.', 403);
    if (!id) return fail(res, 'ID hồ sơ không hợp lệ.');
    try {
        const recomputeWorkProfileProgress = require('../helpers/recomputeWorkProfileProgress');
        const tienDo = await recomputeWorkProfileProgress(id);
        return ok(res, { id, tienDo }, 'Tiến độ được tính tự động theo số đầu việc đã duyệt.');
    } catch (e) {
        console.error('workProfile updateTienDo:', e);
        return fail(res, 'Lỗi server.', 500);
    }
};

module.exports = {
    list, create, update, destroy, updateChuTriStatus, phanCong, duyetKetThuc, updateTienDo,
    listEvaluations, submitEvaluations, skipEvaluation, delegateEvaluation,
};
