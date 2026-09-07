# Supabase 설정 — PMS ISO 온라인 모드

**약 10분.** TVC-PMS와 **별도** Supabase 프로젝트를 만듭니다.

## 1. Supabase 프로젝트 생성

1. [supabase.com/dashboard](https://supabase.com/dashboard) 로그인
2. **New project**
   - Name: `pms-iso` (또는 `perfect-marine-solution-iso`)
   - Database password: 안전하게 저장
   - Region: `Northeast Asia (Seoul)` 권장
3. 프로젝트가 **Active** 될 때까지 대기 (1~2분)

## 2. API 키 복사

**Project Settings → API**

| 항목 | `.env.local` 키 |
|------|-----------------|
| Project URL | `SUPABASE_URL` |
| anon public | `SUPABASE_ANON_KEY` |
| service_role (secret) | `SUPABASE_SERVICE_ROLE_KEY` |

## 3. Database URL

**Project Settings → Database → Connection string → URI**

- Mode: **Session pooler** (IPv4 호환) 또는 Direct
- `DATABASE_URL=` 에 붙여넣기
- 비밀번호 특수문자는 URL 인코딩 (`@` → `%40`)

## 4. 로컬 env 파일

```bash
cd perfect-marine-solution-iso
cp deploy/.env.example deploy/.env.local
# 편집기로 deploy/.env.local 채우기
```

Cursor Cloud Agent 사용 시 **Environment secrets**에 동일 키 추가:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `PMS_ISO_ADMIN_EMAIL` / `PMS_ISO_ADMIN_PASSWORD` (선택)

## 5. 스키마 자동 적용

```bash
npm install
npm run setup:apply
```

다음이 자동 실행됩니다:

- 테이블·RLS·체크리스트 seed
- Storage 버킷 `iso-evidence`
- Storage 정책
- `portal/js/config.js` 작성
- (선택) 관리자 Auth 사용자 + `iso_profiles` admin

## 6. 확인

```bash
npm start
# http://localhost:3010
# deploy/.env.local 의 관리자 이메일/비밀번호로 로그인
```

## 7. Vercel 배포

1. `perfect-marine-solution-iso` repo push
2. Vercel Import → **Root Directory: `portal`**
3. (선택) Build에서 env로 config 주입 — 로컬 `config.js` 커밋은 Private repo에서만

## 문제 해결

| 오류 | 조치 |
|------|------|
| `relation does not exist` | `npm run setup:apply` 재실행 |
| 로그인 후 데이터 안 보임 | SQL로 `iso_profiles`에 admin 행 확인 |
| 증빙 업로드 실패 | 버킷 `iso-evidence` 존재·Storage 정책 확인 |
| RLS 거부 | 해당 사용자 `iso_profiles.role` = `admin` 또는 `editor` |

수동 SQL만 쓰려면: `deploy/supabase-schema.sql` → SQL Editor에 붙여넣기.
