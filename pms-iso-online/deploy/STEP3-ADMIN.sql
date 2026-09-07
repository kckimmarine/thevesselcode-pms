-- 3단계: 로그인 계정을 관리자로 연결
-- Authentication에서 만든 이메일로 바꾼 뒤 Run

INSERT INTO iso_profiles (id, display_name, role)
SELECT id, email, 'admin'
FROM auth.users
WHERE email = '여기에-본인-이메일@example.com'
ON CONFLICT (id) DO UPDATE SET role = 'admin';
