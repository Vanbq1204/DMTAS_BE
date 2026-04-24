/**
 * Migration v2 — Catalog-driven org/title system
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool({
    user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_NAME, password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

const ORG_FACTOR = { 1: 55, 2: 45, 3: 35, 4: 25, 5: 15 };
const perm = (orgLv, weight) => (ORG_FACTOR[orgLv] || 15) + weight;

// ─── ROLE CONFIGS ─────────────────────────────────────────────────────────────
const ROLE_CONFIGS = [
    { id: 1, role: 'admin', level: 1, label: 'Quản trị viên', weight: 10, is_default: true },
    { id: 2, role: 'lanh_dao', level: 1, label: 'Lãnh đạo cấp cao', weight: 10, is_default: false },
    { id: 3, role: 'lanh_dao', level: 2, label: 'Lãnh đạo cấp trường', weight: 8, is_default: false },
    { id: 4, role: 'lanh_dao', level: 3, label: 'Lãnh đạo cấp đơn vị', weight: 6, is_default: true },
    { id: 5, role: 'van_thu', level: 1, label: 'Văn thư cơ quan', weight: 8, is_default: false },
    { id: 6, role: 'van_thu', level: 2, label: 'Văn thư trường', weight: 6, is_default: false },
    { id: 7, role: 'van_thu', level: 3, label: 'Văn thư đơn vị', weight: 4, is_default: true },
    { id: 8, role: 'nhan_vien', level: 1, label: 'Nhân viên', weight: 3, is_default: true },
];
const RCM = Object.fromEntries(ROLE_CONFIGS.map(r => [`${r.role}_${r.level}`, r.id]));

const DEFAULT_PERMS = {
    'admin_1': ['adm_system', 'adm_org', 'adm_catalog'],
    'lanh_dao_1': ['reg_den_dh', 'reg_di_dh', 'ext_in_so', 'ext_stat', 'ext_task', 'hscv_all_dh', 'disp_assign_dh', 'disp_dist_dh', 'vdi_all_dh', 'vden_all_dh', 'pt_all_dh', 'draft_all_dh', 'proc_assigned', 'sign_doc'],
    'lanh_dao_2': ['reg_den_truong', 'reg_di_truong', 'ext_stat', 'ext_task', 'hscv_all_truong', 'disp_assign_truong', 'disp_dist_truong', 'vdi_all_truong', 'vden_all_truong', 'pt_all_truong', 'draft_all_truong', 'proc_assigned', 'sign_doc'],
    'lanh_dao_3': ['reg_den_phong', 'reg_di_phong', 'ext_stat', 'ext_task', 'hscv_all_phong', 'disp_assign_phong', 'vdi_all_phong', 'vden_all_phong', 'pt_all_phong', 'draft_all_phong', 'proc_assigned', 'sign_doc'],
    'van_thu_1': ['reg_den_dh', 'reg_di_dh', 'reg_den_truong', 'reg_di_truong', 'ext_in_so', 'ext_stat', 'hscv_all_dh', 'hscv_all_truong', 'vdi_all_dh', 'vdi_all_truong', 'vden_all_dh', 'vden_all_truong', 'pt_all_dh', 'pt_all_truong'],
    'van_thu_2': ['reg_den_truong', 'reg_di_truong', 'reg_den_phong', 'reg_di_phong', 'ext_in_so', 'ext_stat', 'hscv_all_truong', 'hscv_all_phong', 'vdi_all_truong', 'vdi_all_phong', 'vden_all_truong', 'vden_all_phong', 'pt_all_truong', 'pt_all_phong'],
    'van_thu_3': ['reg_den_phong', 'reg_di_phong', 'ext_stat', 'hscv_all_phong', 'vdi_all_phong', 'vden_all_phong', 'pt_all_phong', 'draft_all_phong'],
    'nhan_vien_1': ['ext_task', 'proc_assigned']
};
DEFAULT_PERMS['nhan_vien_2'] = DEFAULT_PERMS['nhan_vien_1'];
DEFAULT_PERMS['nhan_vien_3'] = DEFAULT_PERMS['nhan_vien_1'];

// ─── LOẠI ĐƠN VỊ (org_types) ──────────────────────────────────────────────────
const ORG_TYPES = [
    { id: 1, code: 'truong', label: 'Trường' },
    { id: 2, code: 'ban', label: 'Ban' },
    { id: 3, code: 'khoi', label: 'Khối' },
    { id: 4, code: 'phong', label: 'Phòng' },
    { id: 5, code: 'khoa', label: 'Khoa' },
    { id: 6, code: 'vien', label: 'Viện' },
    { id: 7, code: 'tt', label: 'Trung tâm' }
];

// ─── TÊN ĐƠN VỊ (org_unit_names) ──────────────────────────────────────────────
const ORG_UNIT_NAMES = [
    { id: 1, type_id: 1, name: 'Đại học Kinh tế Quốc dân', short_name: 'NEU' },
    { id: 2, type_id: 3, name: 'Khối Đơn vị Chức năng', short_name: 'KDVCN' },
    { id: 3, type_id: 3, name: 'Khối Đơn vị Đào tạo', short_name: 'KDVDT' },
    { id: 4, type_id: 4, name: 'Phòng Tổng hợp', short_name: 'PTH' },
    { id: 5, type_id: 4, name: 'Phòng Tổ chức Cán bộ', short_name: 'PTCCB' },
    { id: 6, type_id: 4, name: 'Phòng Quản lý Đào tạo', short_name: 'PQLDT' },
    { id: 7, type_id: 4, name: 'Phòng Tài chính Kế toán', short_name: 'PTCKT' },
    { id: 8, type_id: 1, name: 'Trường Kinh tế và Quản lý công', short_name: 'TKTQLC' },
    { id: 9, type_id: 1, name: 'Trường Kinh doanh', short_name: 'TKD' },
    { id: 10, type_id: 1, name: 'Trường Công nghệ', short_name: 'TCN' },
    { id: 11, type_id: 5, name: 'Khoa Kinh tế học', short_name: 'KTH' },
    { id: 12, type_id: 5, name: 'Khoa Kế hoạch và Phát triển', short_name: 'KHPT' },
    { id: 13, type_id: 5, name: 'Khoa Đầu tư', short_name: 'DT' },
    { id: 14, type_id: 5, name: 'Khoa Marketing', short_name: 'MKT' },
    { id: 15, type_id: 5, name: 'Khoa Quản trị Kinh doanh', short_name: 'QTKD' },
    { id: 16, type_id: 5, name: 'Khoa Kế toán', short_name: 'KKT' },
    { id: 17, type_id: 5, name: 'Khoa Công nghệ thông tin', short_name: 'CNTT' },
    { id: 18, type_id: 5, name: 'Khoa Trí tuệ nhân tạo', short_name: 'AI' },
    { id: 19, type_id: 5, name: 'Khoa Hệ thống thông tin', short_name: 'HTTT' },
];

// ─── CƠ CẤU TỔ CHỨC (organizations) ──────────────────────────────────────────
const ORGS = [
    { id: 1, pid: null, name_id: 1, code: 'NEU', type: 'truong', lv: 1 },
    { id: 2, pid: 1, name_id: 2, code: 'KDVCN', type: 'khoi', lv: 2 },
    { id: 3, pid: 1, name_id: 3, code: 'KDVDT', type: 'khoi', lv: 2 },
    { id: 4, pid: 2, name_id: 4, code: 'PTH', type: 'phong', lv: 3 },
    { id: 5, pid: 2, name_id: 5, code: 'PTCCB', type: 'phong', lv: 3 },
    { id: 6, pid: 2, name_id: 6, code: 'PQLDT', type: 'phong', lv: 3 },
    { id: 7, pid: 2, name_id: 7, code: 'PTCKT', type: 'phong', lv: 3 },
    { id: 8, pid: 3, name_id: 8, code: 'TKTQLC', type: 'truong', lv: 3 },
    { id: 9, pid: 3, name_id: 9, code: 'TKD', type: 'truong', lv: 3 },
    { id: 10, pid: 3, name_id: 10, code: 'TCN', type: 'truong', lv: 3 },
    { id: 11, pid: 8, name_id: 11, code: 'KTH', type: 'khoa', lv: 4 },
    { id: 12, pid: 8, name_id: 12, code: 'KHPT', type: 'khoa', lv: 4 },
    { id: 13, pid: 8, name_id: 13, code: 'DT', type: 'khoa', lv: 4 },
    { id: 14, pid: 9, name_id: 14, code: 'MKT', type: 'khoa', lv: 4 },
    { id: 15, pid: 9, name_id: 15, code: 'QTKD', type: 'khoa', lv: 4 },
    { id: 16, pid: 9, name_id: 16, code: 'KKT', type: 'khoa', lv: 4 },
    { id: 17, pid: 10, name_id: 17, code: 'CNTT', type: 'khoa', lv: 4 },
    { id: 18, pid: 10, name_id: 18, code: 'AI', type: 'khoa', lv: 4 },
    { id: 19, pid: 10, name_id: 19, code: 'HTTT', type: 'khoa', lv: 4 },
];

// ─── CHỨC DANH theo Tên Đơn vị (name_id) ──────────────────────────────────────
const POSITION_TITLES = [];
let ptId = 1;
for (const org of ORGS) {
    if ([1, 2, 3].includes(org.id)) continue; // skip NEU / Khối
    let l_role = 'lanh_dao', l_lvl = 3;
    let v_role = 'van_thu', v_lvl = 3;
    if (org.lv === 1) { l_lvl = 1; v_lvl = 1; }
    else if (org.lv === 3 && org.type === 'truong') { l_lvl = 2; v_lvl = 2; }

    const l_rc = ROLE_CONFIGS.find(r => r.role === l_role && r.level === l_lvl);
    const v_rc = ROLE_CONFIGS.find(r => r.role === v_role && r.level === v_lvl);
    const n_rc = ROLE_CONFIGS.find(r => r.role === 'nhan_vien' && r.level === 1);

    const isTruong = org.type === 'truong';
    const isKhoa = org.type === 'khoa';

    let truong_cd = isTruong ? 'Hiệu trưởng' : (isKhoa ? 'Trưởng khoa' : 'Trưởng phòng');
    let pho_cd = isTruong ? 'Phó Hiệu trưởng' : (isKhoa ? 'Phó Trưởng khoa' : 'Phó Trưởng phòng');
    let cv_cd = (isTruong || isKhoa) ? 'Giảng viên' : 'Chuyên viên';
    let vanthu_cd = isKhoa ? 'Thư ký khoa' : 'Văn thư';

    // To unique constraint (name_id, title), make sure we only add title per name_id once
    if (!POSITION_TITLES.find(t => t.name_id === org.name_id && t.title === truong_cd)) {
        POSITION_TITLES.push({ id: ptId++, name_id: org.name_id, title: truong_cd, role: l_role, role_config_id: l_rc?.id });
        POSITION_TITLES.push({ id: ptId++, name_id: org.name_id, title: pho_cd, role: l_role, role_config_id: l_rc?.id });
        POSITION_TITLES.push({ id: ptId++, name_id: org.name_id, title: cv_cd, role: 'nhan_vien', role_config_id: n_rc?.id });
        POSITION_TITLES.push({ id: ptId++, name_id: org.name_id, title: vanthu_cd, role: v_role, role_config_id: v_rc?.id });
    }
}

// ─── NHÂN SỰ MẪU ──────────────────────────────────────────────────────────────
const NP = {
    tp: ['GS.TS. Nguyễn Văn Anh', 'PGS.TS. Trần Minh Đức', 'TS. Lê Hoài Nam', 'PGS.TS. Phạm Đức Hùng', 'TS. Hoàng Văn Tùng', 'PGS.TS. Đỗ Quốc Bảo', 'TS. Vũ Thanh Hải', 'TS. Bùi Trọng Minh', 'PGS.TS. Đặng Văn Long', 'TS. Lý Tuấn Kiệt', 'PGS.TS. Đinh Thị Hoa', 'TS. Ngô Thị Lan'],
    pp: ['ThS. Trần Thị Hoa', 'ThS. Lê Thanh Phương', 'ThS. Phạm Thu Lan', 'ThS. Hoàng Ngọc Anh', 'ThS. Nguyễn Việt Hùng', 'ThS. Đỗ Thị Bích', 'ThS. Vũ Minh Hiếu', 'ThS. Bùi Thị Ngọc', 'ThS. Đặng Quang Trường', 'ThS. Lương Thị Hằng', 'ThS. Phan Thành Đạt', 'ThS. Lê Minh Tú'],
    vt: ['Nguyễn Thị Hà', 'Trần Thị Mai', 'Lê Thị Thúy', 'Phạm Thị Linh', 'Hoàng Thị Hạnh', 'Đỗ Thị Liên', 'Vũ Thị Nga', 'Bùi Thị Trang', 'Đặng Thị Thu', 'Lý Thị Ngân', 'Ngô Thị Hương', 'Tạ Thị Loan'],
    cv1: ['Trần Văn Dũng', 'Lê Văn Chính', 'Phạm Văn Thắng', 'Hoàng Văn Quân', 'Đỗ Văn Bình', 'Vũ Văn Lâm', 'Bùi Hữu Hoa', 'Nguyễn Ngọc Hải', 'Phan Văn Tuấn', 'Tạ Hữu Lực', 'Đinh Văn Sơn', 'Trịnh Văn Hải'],
    cv2: ['Nguyễn Thị Bích', 'Trần Thị Thanh', 'Lê Thị Phương', 'Phạm Thị Nhung', 'Hoàng Thị Thảo', 'Đỗ Thị Hà', 'Vũ Thị Oanh', 'Bùi Thị Diệp', 'Đặng Thị Cẩm', 'Lý Thị Kim', 'Phan Thị Mỹ', 'Tạ Thị Liên'],
};
const SKIP_IDS = new Set([1, 2, 3]);

function genUsers(org, idx) {
    const c = org.code.toLowerCase(), i = idx % 12;
    const isTruong = org.type === 'truong';
    const isKhoa = org.type === 'khoa';
    let truong_cd = isTruong ? 'Hiệu trưởng' : (isKhoa ? 'Trưởng khoa' : 'Trưởng phòng');
    let pho_cd = isTruong ? 'Phó Hiệu trưởng' : (isKhoa ? 'Phó Trưởng khoa' : 'Phó Trưởng phòng');
    let cv_cd = (isTruong || isKhoa) ? 'Giảng viên' : 'Chuyên viên';
    let vanthu_cd = isKhoa ? 'Thư ký khoa' : 'Văn thư';

    let l_role = 'lanh_dao', l_lvl = 3, v_lvl = 3;
    if (org.lv === 1) { l_lvl = 1; v_lvl = 1; }
    else if (org.lv === 3 && isTruong) { l_lvl = 2; v_lvl = 2; }

    return [
        { email: `tp.${c}@neu.edu.vn`, full_name: NP.tp[i], role: l_role, rc_key: `lanh_dao_${l_lvl}`, title: truong_cd },
        { email: `pp.${c}@neu.edu.vn`, full_name: NP.pp[i], role: l_role, rc_key: `lanh_dao_${l_lvl}`, title: pho_cd },
        { email: `vt.${c}@neu.edu.vn`, full_name: NP.vt[i], role: 'van_thu', rc_key: `van_thu_${v_lvl}`, title: vanthu_cd },
        { email: `cv1.${c}@neu.edu.vn`, full_name: NP.cv1[i], role: 'nhan_vien', rc_key: 'nhan_vien_1', title: cv_cd },
        { email: `cv2.${c}@neu.edu.vn`, full_name: NP.cv2[i], role: 'nhan_vien', rc_key: 'nhan_vien_1', title: cv_cd },
    ].map(u => ({ ...u, org_id: org.id, org_lv: org.lv }));
}

// ─── MIGRATION ────────────────────────────────────────────────────────────────
async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DROP TABLE IF EXISTS user_permissions CASCADE').catch(() => { });
        await client.query('DROP TABLE IF EXISTS user_positions CASCADE').catch(() => { });
        await client.query('DROP TABLE IF EXISTS position_titles CASCADE').catch(() => { });
        await client.query('DROP TABLE IF EXISTS organizations CASCADE').catch(() => { });
        await client.query('DROP TABLE IF EXISTS org_unit_names CASCADE').catch(() => { });
        await client.query('DROP TABLE IF EXISTS org_types CASCADE').catch(() => { });
        await client.query('DROP TABLE IF EXISTS role_configs CASCADE').catch(() => { });
        await client.query('DELETE FROM users').catch(() => { });
        await client.query(`ALTER SEQUENCE IF EXISTS users_id_seq RESTART WITH 1`).catch(() => { });
        console.log('🗑️  Dropped old schema');

        await client.query(`CREATE TABLE IF NOT EXISTS org_types (
            id SERIAL PRIMARY KEY,
            code VARCHAR(50) UNIQUE NOT NULL,
            label VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS org_unit_names (
            id SERIAL PRIMARY KEY,
            type_id INTEGER NOT NULL REFERENCES org_types(id),
            name VARCHAR(255) NOT NULL,
            short_name VARCHAR(50),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS organizations (
            id SERIAL PRIMARY KEY,
            parent_id INTEGER REFERENCES organizations(id),
            name_id INTEGER REFERENCES org_unit_names(id),
            code VARCHAR(50) UNIQUE NOT NULL,
            type VARCHAR(50) NOT NULL,
            level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS role_configs (
            id SERIAL PRIMARY KEY,
            role VARCHAR(50) NOT NULL,
            level INTEGER NOT NULL,
            label VARCHAR(100) NOT NULL,
            weight INTEGER NOT NULL DEFAULT 5,
            is_default BOOLEAN DEFAULT false,
            default_permissions JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(role, level)
        )`);

        // Catalog-driven: position titles connected to name_id instead of org_id
        await client.query(`CREATE TABLE IF NOT EXISTS position_titles (
            id SERIAL PRIMARY KEY,
            name_id INTEGER NOT NULL REFERENCES org_unit_names(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL,
            role_config_id INTEGER REFERENCES role_configs(id),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(name_id, title)
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS user_positions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            org_id INTEGER NOT NULL REFERENCES organizations(id),
            title VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL,
            role_config_id INTEGER REFERENCES role_configs(id),
            permission_level INTEGER NOT NULL DEFAULT 0,
            is_primary BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await client.query(`CREATE TABLE IF NOT EXISTS user_permissions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission_key VARCHAR(100) NOT NULL,
            UNIQUE(user_id, permission_key)
        )`);

        for (const col of ['dob DATE', 'phone VARCHAR(20)', 'contact_email VARCHAR(255)', 'address TEXT', 'cccd VARCHAR(20)'])
            await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`).catch(() => { });

        for (const t of ORG_TYPES)
            await client.query(`INSERT INTO org_types (id,code,label) VALUES ($1,$2,$3)`, [t.id, t.code, t.label]);
        await client.query(`SELECT setval('org_types_id_seq',(SELECT MAX(id) FROM org_types))`);

        for (const u of ORG_UNIT_NAMES)
            await client.query(`INSERT INTO org_unit_names (id,type_id,name,short_name) VALUES ($1,$2,$3,$4)`,
                [u.id, u.type_id, u.name, u.short_name]);
        await client.query(`SELECT setval('org_unit_names_id_seq',(SELECT MAX(id) FROM org_unit_names))`);

        for (const o of ORGS)
            await client.query(`INSERT INTO organizations (id,parent_id,name_id,code,type,level) VALUES ($1,$2,$3,$4,$5,$6)`,
                [o.id, o.pid, o.name_id, o.code, o.type, o.lv]);
        await client.query(`SELECT setval('organizations_id_seq',(SELECT MAX(id) FROM organizations))`);

        for (const rc of ROLE_CONFIGS) {
            const key = `${rc.role}_${rc.level}`;
            const perms = DEFAULT_PERMS[key] || (rc.role === 'admin' ? DEFAULT_PERMS['admin_1'] : (rc.role === 'nhan_vien' ? DEFAULT_PERMS['nhan_vien_1'] : []));
            await client.query(`INSERT INTO role_configs (id,role,level,label,weight,is_default,default_permissions) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [rc.id, rc.role, rc.level, rc.label, rc.weight, rc.is_default, JSON.stringify(perms)]);
        }
        await client.query(`SELECT setval('role_configs_id_seq',(SELECT MAX(id) FROM role_configs))`);

        for (const pt of POSITION_TITLES)
            await client.query(`INSERT INTO position_titles (name_id, title, role, role_config_id) VALUES ($1,$2,$3,$4)`,
                [pt.name_id, pt.title, pt.role, pt.role_config_id]);
        await client.query(`SELECT setval('position_titles_id_seq',(SELECT MAX(id) FROM position_titles))`);

        const pw = await bcrypt.hash('NEU@2024', 10);
        const ar = await client.query(
            `INSERT INTO users (email,password_hash,full_name,role,is_active) VALUES ('admin@neu.edu.vn',$1,'Quản trị viên Hệ thống','admin',true) RETURNING id`, [pw]);
        const adminId = ar.rows[0].id;
        await client.query(
            `INSERT INTO user_positions (user_id,org_id,title,role,role_config_id,permission_level,is_primary) VALUES ($1,1,'Quản trị hệ thống','admin',1,65,true)`,
            [adminId]);
        for (const kx of DEFAULT_PERMS['admin_1']) {
            await client.query('INSERT INTO user_permissions (user_id, permission_key) VALUES ($1,$2)', [adminId, kx]);
        }

        let total = 0;
        const workOrgs = ORGS.filter(o => !SKIP_IDS.has(o.id));
        for (let i = 0; i < workOrgs.length; i++) {
            for (const u of genUsers(workOrgs[i], i)) {
                const rcId = RCM[u.rc_key] || null;
                const rcWeight = ROLE_CONFIGS.find(r => r.id === rcId)?.weight || 5;
                const ur = await client.query(
                    `INSERT INTO users (email,password_hash,full_name,role,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
                    [u.email, pw, u.full_name, u.role]);
                const newUserId = ur.rows[0].id;
                await client.query(
                    `INSERT INTO user_positions (user_id,org_id,title,role,role_config_id,permission_level,is_primary) VALUES ($1,$2,$3,$4,$5,$6,true)`,
                    [newUserId, u.org_id, u.title, u.role, rcId, perm(u.org_lv, rcWeight)]);

                // Fetch the config to know the key: u.rc_key has it directly, it's something like "lanh_dao_1".
                const fallbackKey = u.role === 'nhan_vien' ? 'nhan_vien_1' : u.rc_key;
                const perms = DEFAULT_PERMS[fallbackKey] || [];
                for (const kx of perms) {
                    await client.query('INSERT INTO user_permissions (user_id, permission_key) VALUES ($1,$2)', [newUserId, kx]);
                }

                total++;
            }
        }

        await client.query('COMMIT');
        console.log('\n✅ Migration hoàn tất! Admin: admin@neu.edu.vn | Pass: NEU@2024\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌', err.message, '\n', err.stack);
    } finally {
        client.release();
        await pool.end();
    }
}
migrate();
