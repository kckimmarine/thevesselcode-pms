# Toolkit — PMS와 동일하게 설정 (5분)

PMS(`/pms/`)와 **똑같은 방식**입니다. WordPress 페이지에 iframe 넣지 **않습니다**.

| | PMS | Toolkit |
|---|-----|---------|
| 서버 파일 | `public_html/pms/index.html` | `public_html/toolkit/index.html` |
| 메뉴 URL | `https://thevesselcode.com/pms/` | `https://thevesselcode.com/toolkit/` |
| 앱 주소 | `app.thevesselcode.com/?embed=1` | `app.thevesselcode.com/toolkit` |

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

---

## 자동 배포 (선택)

```bash
npm run deploy:bluehost
```

`BLUEHOST_FTP_*` 시크릿 필요.
