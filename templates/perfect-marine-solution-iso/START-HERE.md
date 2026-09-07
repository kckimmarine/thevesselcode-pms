# PMS ISO 포털 시작 (이 저장소 전용)

`thevesselcode-pms`와 **별도**로 이 폴더만 Cursor에서 열었다면 아래만 실행합니다.

## 1. 터미널

**Terminal → New Terminal** (`` Ctrl+` ``)

```bash
npm install
npm start
```

## 2. 브라우저

**http://localhost:3010**

### 첫 화면: Publishable key

1. Supabase **pms-iso** → **Settings → API Keys**
2. **Publishable key** (`sb_publishable_…`) 복사
3. 포털 첫 화면에 붙여넣기 → **저장**

### 로그인

| 항목 | 값 |
|------|-----|
| 이메일 | Authentication에서 만든 주소 (예: `ktechship@gmail.com`) |
| 비밀번호 | Authentication에서 설정한 비밀번호 |

---

## Cursor 분리 설정

처음이면 → [`docs/CURSOR-별도-프로젝트.md`](docs/CURSOR-별도-프로젝트.md)

Supabase SQL·계정 설정 → [`docs/쉬운-설정.md`](docs/쉬운-설정.md)
