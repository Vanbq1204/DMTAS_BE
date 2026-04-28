# DMS Backend — Hệ thống Quản lý Văn bản & Hồ sơ Công việc

API backend cho hệ thống quản lý văn bản điện tử (DMS), xây dựng bằng **Node.js / Express** + **PostgreSQL**.

---

## Mục lục

- [Tổng quan](#tổng-quan)
- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Cài đặt](#cài-đặt)
- [Cấu hình biến môi trường](#cấu-hình-biến-môi-trường)
- [Chạy ứng dụng](#chạy-ứng-dụng)
- [Cơ sở dữ liệu & Migration](#cơ-sở-dữ-liệu--migration)
- [Phân quyền vai trò](#phân-quyền-vai-trò)
- [Tổng quan API](#tổng-quan-api)
- [Tích hợp bên ngoài](#tích-hợp-bên-ngoài)

---

## Tổng quan

Hệ thống DMS (Document Management System) hỗ trợ số hóa toàn bộ quy trình văn thư — từ tiếp nhận, xử lý, phát hành văn bản đến quản lý hồ sơ công việc nội bộ. Các chức năng chính bao gồm:

- **Văn bản đến**: tiếp nhận, vào sổ, phân công xử lý, chuyển phối hợp, theo dõi tiến độ
- **Văn bản đi**: soạn thảo, trình ký, ký số, phát hành nội bộ
- **Dự thảo văn bản**: tạo, chỉnh sửa trực tuyến (OnlyOffice), luân chuyển, ký số và đóng dấu
- **Hồ sơ công việc**: tạo hồ sơ, giao nhiệm vụ, theo dõi tiến độ, đánh giá, duyệt kết thúc
- **Thông báo thời gian thực** qua Socket.IO
- **Lưu trữ tệp** trên MinIO (chữ ký, con dấu, tài liệu đính kèm)

---

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| Runtime | Node.js |
| Web framework | Express 5 |
| Cơ sở dữ liệu | PostgreSQL |
| Xác thực | JWT (jsonwebtoken) + bcryptjs |
| Upload tệp | Multer |
| Lưu trữ đối tượng | MinIO |
| Chỉnh sửa tài liệu | OnlyOffice Document Server |
| Thời gian thực | Socket.IO |
| Xử lý PDF | pdf-lib |
| Đọc DOCX | Mammoth |
| Validation | Joi |
| Dev server | Nodemon |

---

## Cấu trúc thư mục

```
backend/
├── config/
│   └── db.js                  # Kết nối PostgreSQL (Pool)
├── controllers/               # Xử lý logic nghiệp vụ
│   ├── authController.js
│   ├── incomingDocumentController.js
│   ├── outgoingDocumentController.js
│   ├── duThaoController.js
│   ├── workProfileController.js
│   ├── workProfileTaskController.js
│   ├── workProfileHistoryController.js
│   ├── workProfileCommentController.js
│   ├── workProfileFileController.js
│   ├── signatureAssetController.js
│   ├── orgController.js
│   ├── personnelController.js
│   ├── userController.js
│   ├── roleConfigController.js
│   └── catalogController.js
├── middleware/
│   ├── authMiddleware.js      # Xác thực JWT + kiểm tra vai trò
│   └── uploadMiddleware.js    # Cấu hình Multer
├── migrations/                # Các file SQL migration theo thứ tự
├── realtime/
│   └── socket.js              # Khởi tạo Socket.IO
├── routes/
│   ├── authRoutes.js
│   ├── adminRoutes.js
│   ├── vanThuRoutes.js
│   ├── lanhDaoRoutes.js
│   ├── nhanVienRoutes.js
│   └── onlyOfficeRoutes.js
├── src/
│   └── modules/
│       └── so-van-ban/        # Module quản lý sổ văn bản
├── uploads/                   # Tệp tải lên (cục bộ, tạm thời)
├── utils/
│   └── minioClient.js         # Client MinIO
├── .env                       # Biến môi trường (không đưa lên git)
├── server.js                  # Entry point
└── package.json
```

---

## Yêu cầu hệ thống

- **Node.js** >= 18
- **PostgreSQL** >= 14
- **MinIO** (tự host hoặc dùng S3-compatible service) — dùng để lưu chữ ký và con dấu
- **OnlyOffice Document Server** (Docker) — dùng để chỉnh sửa tài liệu trực tuyến

---

## Cài đặt

```bash
cd backend
npm install
```

---

## Cấu hình biến môi trường

Tạo file `.env` trong thư mục `backend/` (hoặc sao chép từ `.env.example`):

```env
# Server
PORT=8080

# PostgreSQL
DB_USER=your_pg_user
DB_HOST=localhost
DB_NAME=dms_db
DB_PASSWORD=your_pg_password
DB_PORT=5432

# JWT
JWT_SECRET=your_jwt_secret

# OnlyOffice Document Server
ONLYOFFICE_DOCUMENT_SERVER_URL=http://localhost:8081
PUBLIC_FILE_BASE_URL=http://host.docker.internal:8080
ONLYOFFICE_CALLBACK_BASE_URL=http://host.docker.internal:8080
ONLYOFFICE_JWT_SECRET=your_onlyoffice_jwt_secret

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=dms-assets
```

---

## Chạy ứng dụng

**Development** (tự động reload khi thay đổi code):
```bash
npm run dev
```

**Production**:
```bash
npm start
```

Server sẽ chạy tại: `http://localhost:8080`

---

## Cơ sở dữ liệu & Migration

### 1. Tạo database

```sql
CREATE DATABASE dms_db;
```

### 2. Chạy các file migration theo thứ tự

Các file SQL trong thư mục `migrations/` đánh số từ `002` đến `031`. Chạy lần lượt:

```bash
psql -U your_pg_user -d dms_db -f migrations/002_danh_muc_so.sql
psql -U your_pg_user -d dms_db -f migrations/003_update_so_van_ban.sql
# ... tiếp tục đến 031
```

Hoặc dùng script JS đi kèm (nếu có):
```bash
node migrations/run_002.js
```

> **Lưu ý**: Phải chạy đúng thứ tự vì các migration sau phụ thuộc vào migration trước.

---

## Phân quyền vai trò

| Vai trò | Mô tả |
|---|---|
| `admin` | Quản trị hệ thống: quản lý người dùng, tổ chức, danh mục, cấu hình vai trò |
| `lanh_dao` | Lãnh đạo: phân công xử lý văn bản, phê duyệt dự thảo, ký văn bản, quản lý hồ sơ |
| `van_thu` | Văn thư: tiếp nhận, vào sổ văn bản đến/đi, soạn thảo, phát hành |
| `nhan_vien` | Nhân viên: xử lý văn bản được phân công, soạn dự thảo, thực hiện nhiệm vụ trong hồ sơ |

Mỗi vai trò có route riêng (`/api/admin`, `/api/lanh-dao`, `/api/van-thu`, `/api/nhan-vien`) và middleware `requireRole()` bảo vệ từng nhóm.

---

## Tổng quan API

### Xác thực
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập, nhận JWT |
| GET | `/api/auth/me` | Thông tin người dùng hiện tại |

### Quản trị (`/api/admin`)
| Endpoint | Mô tả |
|---|---|
| `/organizations` | CRUD cơ cấu tổ chức |
| `/personnel` | CRUD nhân sự |
| `/users` | CRUD tài khoản người dùng |
| `/role-configs` | Cấu hình vai trò |
| `/catalog/org-types` | Danh mục loại đơn vị |
| `/catalog/org-unit-names` | Danh mục tên đơn vị |
| `/catalog/position-titles` | Danh mục chức danh |

### Văn thư / Lãnh đạo / Nhân viên (dùng chung)
| Endpoint | Mô tả |
|---|---|
| `/van-ban-den` | Danh sách và chi tiết văn bản đến |
| `/van-ban-den/:id/lich-su` | Lịch sử thao tác văn bản đến |
| `/van-ban-den/:id/chuyen-de-biet` | Chuyển để biết |
| `/van-ban-den/:id/chuyen-phoi-hop` | Chuyển phối hợp xử lý |
| `/van-ban-den/:id/y-kien-phoi-hop` | Gửi ý kiến phối hợp |
| `/van-ban-di` | CRUD văn bản đi |
| `/van-ban-di/:id/gui-noi-bo` | Phát hành nội bộ |
| `/van-ban-noi-bo-tiep-nhan` | Hộp thư văn bản nội bộ |
| `/du-thao` | CRUD dự thảo văn bản |
| `/du-thao/:id/chuyen` | Luân chuyển dự thảo |
| `/ho-so/cong-viec` | CRUD hồ sơ công việc |
| `/ho-so/cong-viec/:id/nhiem-vu` | CRUD nhiệm vụ trong hồ sơ |
| `/ho-so/cong-viec/:id/nhiem-vu/:taskId/nop` | Nộp kết quả nhiệm vụ |
| `/ho-so/cong-viec/:id/nhiem-vu/:taskId/nop/:subId/duyet` | Duyệt kết quả |
| `/ho-so/cong-viec/:id/danh-gia` | Đánh giá thành viên |
| `/ho-so/cong-viec/:id/duyet-ket-thuc` | Duyệt kết thúc hồ sơ |
| `/ho-so/cong-viec/:id/lich-su` | Lịch sử thao tác hồ sơ |

### OnlyOffice
| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/onlyoffice/config/:fileId` | Lấy cấu hình editor OnlyOffice |
| POST | `/api/onlyoffice/callback` | Nhận callback lưu file từ OnlyOffice |

---

## Tích hợp bên ngoài

### OnlyOffice Document Server
Dùng để chỉnh sửa trực tuyến file DOCX/XLSX/PPTX ngay trong trình duyệt.
- Triển khai qua Docker: `docker run -d -p 8081:80 onlyoffice/documentserver`
- Backend đóng vai trò Document Storage Service — cung cấp URL tải file và nhận callback khi lưu.

### MinIO
Lưu trữ hình ảnh chữ ký và con dấu số.
- Triển khai qua Docker: `docker run -d -p 9000:9000 -p 9001:9001 minio/minio server /data --console-address ":9001"`
- Tạo bucket `dms-assets` qua MinIO Console tại `http://localhost:9001`.

### Socket.IO
Thông báo thời gian thực cho người dùng (văn bản mới được phân công, nhiệm vụ mới, ...).
- Server lắng nghe tại `/socket.io` (cùng port với HTTP).
