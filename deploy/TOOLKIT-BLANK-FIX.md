# Toolkit 백지 화면 — cPanel 3분 복구

`view-source:https://thevesselcode.com/toolkit/` 가 **완전 빈 화면** = `index.html`이 **0 bytes** 또는 **없음**.

PMS(`/pms/`)가 되면, **같은 방법으로 복사**하면 됩니다.

---

## 방법 A — PMS 파일 복사 (가장 확실)

1. cPanel → **File Manager** → `public_html/pms/`
2. `index.html` 크기 확인 → **약 1.7KB** (0이면 PMS도 문제)
3. `index.html` 선택 → **Copy**
4. Destination: `/public_html/toolkit/index.html`
5. `public_html/toolkit/` 로 이동 → `index.html` **Edit**
6. 아래 **2곳만** 바꾸고 **Save Changes**:

| 찾기 | 바꾸기 |
|------|--------|
| `https://app.thevesselcode.com/?embed=1` | `https://app.thevesselcode.com/toolkit` |
| `PMS` (title 안) | `Maritime Toolkit` |

7. 파일 크기 **1KB 이상** 확인 (0 bytes면 저장 실패)
8. **Caching → Purge All**
9. 시크릿 창: `view-source:https://thevesselcode.com/toolkit/`
   → `<iframe` 와 `app.thevesselcode.com/toolkit` 보이면 성공

---

## 방법 B — Code Editor에 직접 붙여넣기

1. `public_html/toolkit/` 에서 기존 `index.html` **Delete**
2. **+ File** → 이름 `index.html`
3. **Edit** → 아래 전체 붙여넣기 → **Save Changes**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Maritime Toolkit — THE VESSEL CODE</title>
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#1a365d}
iframe{border:0;width:100%;height:100%;display:block}
</style>
</head>
<body>
<iframe src="https://app.thevesselcode.com/toolkit" title="Maritime Toolkit"></iframe>
</body>
</html>
```

4. 저장 후 **Right click → Refresh** → 크기 **500 bytes 이상** 확인

---

## 체크리스트

| 확인 | 기대값 |
|------|--------|
| 경로 | `public_html/toolkit/index.html` (public_html **안**) |
| 크기 | **0 bytes 아님** (최소 500B, 보통 1~3KB) |
| view-source | `<iframe` 보임 |
| 화면 | 남색 배경 + Toolkit 앱 |

---

## 메뉴 (WordPress)

**Appearance → Menus** → Custom Link:
- URL: `https://thevesselcode.com/toolkit/`
- Label: `Toolkit`

---

## 임시 우회

메뉴 URL을 바로: `https://app.thevesselcode.com/toolkit`
