-- Không còn yêu cầu "loại hồ sơ" (heading) — trường này đã bị xoá khỏi UI,
-- nhưng cột vẫn tồn tại (NOT NULL). Chuyển thành nullable + default rỗng để tránh lỗi insert.
ALTER TABLE work_profiles
    ALTER COLUMN loai_ho_so DROP NOT NULL,
    ALTER COLUMN loai_ho_so SET DEFAULT '';

UPDATE work_profiles SET loai_ho_so = '' WHERE loai_ho_so IS NULL;
