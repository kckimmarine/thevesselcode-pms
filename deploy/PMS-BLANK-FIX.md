# PMS 백지 화면 — cPanel 3분 복구

`view-source:https://thevesselcode.com/pms/` 가 **완전 빈 화면** = WordPress slug `pms` 가 경로를 가로채거나, `index.html`이 **0 bytes / 없음**.

**앱 서버는 정상:** `https://app.thevesselcode.com` 로그인 화면이 보이면 Vercel 쪽 문제 아님.

Maritime Toolkit과 **동일한 원인**입니다. `/toolkit/` → `/maritime-toolkit/` 로 바꿨듯, PMS는 **`/maritime-pms/`** 를 사용하세요.

---

## 1. WordPress PMS 페이지 휴지통 (필수)

1. WordPress → **Pages**
2. slug **`pms`** 인 페이지 찾기 (제목: PMS 등)
3. **Move to Trash**
4. 메뉴는 **Custom Link** 만 사용 (WordPress Page 링크 아님)

> `/pms/` URL 은 WP 페이지가 살아 있으면 정적 `public_html/pms/index.html` 보다 우선합니다.

---

## 2. cPanel — 정적 embed 업로드

1. **Bluehost → cPanel → File Manager**
2. `public_html/maritime-pms/` 폴더 생성 (없으면)
3. **Upload** → 레포 `bluehost/maritime-pms/index.html`
4. 크기 **1KB 이상** 확인 (0 bytes면 저장 실패 → Upload만 사용)

---

## 3. WordPress 메뉴

**Appearance → Menus** → PMS 항목:

| 항목 | 값 |
|------|-----|
| 타입 | **Custom Link** |
| URL | `https://thevesselcode.com/maritime-pms/` |
| Label | PMS |

**Save** → **Caching → Purge All**

---

## 4. 확인

시크릿 창:

```
view-source:https://thevesselcode.com/maritime-pms/
```

| 결과 | 의미 |
|------|------|
| ✅ `tvcPmsFrame`, `app.thevesselcode.com/?embed=1`, `#1a365d` | 정상 |
| ❌ 완전 빈 소스 | 파일 없음/0 bytes → 재업로드 |
| ❌ `wp-content`, `wordpress` | WP 페이지가 여전히 가로챔 → 휴지통 확인 |

화면: 남색 배경 + PMS 로그인 (또는 "PMS 로딩 중…" 후 앱)

---

## 5. `/pms/` 를 꼭 써야 할 때 (선택)

WP PMS 페이지를 휴지통한 뒤:

1. `public_html/pms/index.html` 재업로드 (레포 `bluehost/pms/index.html`)
2. `view-source:https://thevesselcode.com/pms/` 에 iframe HTML 확인

slug 충돌이 다시 생기면 **`/maritime-pms/`** 가 안전한 운영 URL 입니다.

---

## 임시 우회

메뉴 URL을 바로:

`https://app.thevesselcode.com/?embed=1`
