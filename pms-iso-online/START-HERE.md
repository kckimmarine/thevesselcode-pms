# ④ 포털 시작 (3단계)

Supabase 설정은 **끝**입니다. 이제 **컴퓨터에서 포털만** 엽니다.

## 1. Cursor에서 Terminal 열기

메뉴 **Terminal → New Terminal** (또는 `` Ctrl+` ``)

## 2. 아래 두 줄 붙여넣기 → Enter

```bash
cd pms-iso-online
npm start
```

`thevesselcode-pms` repo를 Cursor로 열었다면 `pms-iso-online` 폴더가 있습니다.  
없으면 채팅에 **「포털 폴더 없음」**이라고 보내 주세요.

## 3. 브라우저

자동으로 열리거나, 주소창에 입력:

**http://localhost:3010**

### 첫 화면: Publishable key

1. Supabase → **Settings → API Keys**
2. **Publishable key** (`sb_publishable_…`) **복사**
3. 포털 첫 화면에 **붙여넣기** → **저장**

### 로그인

| 항목 | 값 |
|------|-----|
| 이메일 | `ktechship@gmail.com` |
| 비밀번호 | Authentication에서 만든 비밀번호 |

---

## 완료

대시보드·문서 대장·체크리스트·증빙 업로드가 보이면 **온라인 모드 완료**입니다.
