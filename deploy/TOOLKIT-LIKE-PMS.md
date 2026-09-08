# Toolkit — PMS와 동일하게 설정 (5분)

PMS(`/pms/`)와 **똑같은 방식**입니다. WordPress 페이지에 iframe 넣지 **않습니다**.

| | PMS | Toolkit |
|---|-----|---------|
| Server file | `public_html/pms/index.html` | `public_html/maritime-toolkit/index.html` |
| 메뉴 URL | `https://thevesselcode.com/pms/` | `https://thevesselcode.com/maritime-toolkit/` |
| 앱 주소 | `app.thevesselcode.com/?embed=1` | `app.thevesselcode.com/toolkit?embed=1` |

> `/toolkit/` 은 WordPress slug와 충돌합니다. **`/maritime-toolkit/`** 만 사용하세요.

---

## 1. cPanel — 파일 올리기 (가장 중요)

1. **Bluehost → cPanel → File Manager**
2. `public_html/toolkit/` 폴더 (없으면 생성)
3. 기존 `index.html` 있으면 **Delete** (0 bytes 파일이 백지 원인)
4. **Upload** → 이 레포의 `bluehost/toolkit/index.html` 선택
5. 크기 **1KB 이상** 확인 (0 bytes면 실패)

> Code Editor 저장이 0 bytes로 남으면 **Upload만** 사용하세요.

---

## 2. WordPress — 메뉴 (PMS와 동일)

1. **Appearance → Menus** (또는 Site Editor → Header → Navigation)
2. **Toolkit** 항목:
   - 타입: **Custom Link** (WordPress Page 아님)
   - URL: `https://thevesselcode.com/toolkit/`
   - 텍스트: `Toolkit`
3. PMS 옆에 배치 → **Save**

---

## 3. WordPress Toolkit 페이지 (선택)

**Pages → Toolkit** 에 넣은 Classic/HTML 코드는 **지워도 됩니다.**

더 깔끔하게:
- **Pages → Toolkit → Move to Trash** (휴지통)  
  → 메뉴는 Custom Link만 쓰면 됩니다.

---

## 4. 캐시

**Caching → Clear** (또는 Bluehost 캐시 삭제)

---

## 5. 확인

시크릿 창:

```
https://thevesselcode.com/toolkit/
```

→ 전체 화면 Maritime Toolkit (PMS처럼 헤더 없이 앱만)

### 백지 화면이 계속 나올 때 (1.82KB 파일인데도)

**먼저 색으로 구분하세요:**

| 화면 | 의미 |
|------|------|
| **흰색** 백지 (+ WordPress 헤더/메뉴) | 정적 `index.html`이 **아님** → WordPress 페이지가 `/toolkit/` 을 가로챔 |
| **남색** (#1a365d) + "로딩 중…" | 정적 embed는 맞음 → iframe 안 앱 로드 문제 |

**1) 페이지 소스 확인 (가장 중요)**

브라우저에서 `https://thevesselcode.com/toolkit/` 열기

> ⚠️ **iframe 안에서 우클릭 → 페이지 소스** 하면 **아무것도 안 나옵니다** (다른 도메인 iframe이라 정상).
> 전체 화면이 앱처럼 보여도, 소스 보기는 **부모 페이지**에서 해야 합니다.

**올바른 방법 (하나만):**
- 주소창 선택 후 **Ctrl+U** (Mac: **Cmd+Option+U**)
- 또는 주소창에 `view-source:https://thevesselcode.com/toolkit/` 입력

- ✅ 정상: `TVC-STATIC-TOOLKIT-EMBED-v2`, `tvcToolkitFrame`, `background: #1a365d` 보임
- ❌ 문제: `wp-content`, `wordpress` → WordPress가 응답
- ❌ **완전 빈 소스**: `index.html` 없음/0 bytes → cPanel에서 파일 재업로드

**1b) 테스트 파일 (선택)**

`public_html/toolkit/test.html` 업로드 후 브라우저에서:

```
https://thevesselcode.com/toolkit/test.html
```

→ "✅ 정적 파일 정상" 보이면 폴더/업로드는 OK, `index.html`만 점검

**2) WordPress Toolkit 페이지 휴지통**

1. **Pages → Toolkit → Move to Trash**
2. 메뉴는 **Custom Link** `https://thevesselcode.com/toolkit/` 만 사용 (WP Page 링크 아님)
3. **Caching → Clear**

**3) cPanel 파일 재확인**

`public_html/toolkit/` 에 다음 파일:

| 파일 | 크기 |
|------|------|
| `index.html` | ~3KB (0 bytes 아님) |
| `.htaccess` | 선택 (~180 bytes) |

**index.html 업로드:** `+ File` / Code Editor 말고 **Upload** 버튼 사용.

**`.htaccess` 만들기** (cPanel +File이 안 될 때):

1. File Manager → **Settings** → **Show Hidden Files (dotfiles)** 체크 → Save
2. 방법 A: `htaccess.txt` 생성 → 내용 붙여넣기 → **Rename** → `.htaccess`
3. 방법 B: PC에서 `.htaccess` 만든 뒤 **Upload**
4. 방법 C: `.htaccess` 없이도 `index.html`만 있으면 동작 가능 (WP 페이지는 휴지통 필수)

`.htaccess` 내용 (복사용):

```
DirectoryIndex index.html
Options -Indexes
<IfModule mod_rewrite.c>
RewriteEngine Off
</IfModule>
```

**4) PMS와 비교**

- `https://thevesselcode.com/pms/` 가 되면 → Toolkit만 문제 → 위 1~3번
- PMS도 안 되면 → Cloudflare/캐시/호스팅 전체 이슈

**5) 임시 우회 (메뉴)**

메뉴 Custom Link를 직접 앱으로:

`https://app.thevesselcode.com/toolkit`

---

## 자동 배포 (선택)

```bash
npm run deploy:bluehost
```

`BLUEHOST_FTP_*` 시크릿 필요.
