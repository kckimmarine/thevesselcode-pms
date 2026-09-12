# WordPress 홈 — Lead-gen FAB + 데모 신청 폼

Maritime Toolkit과 동일한 플로팅 버튼 + 데모 신청 모달을 `thevesselcode.com` 홈에 배치합니다.

---

## ⚠️ Site Editor(사이트 편집기)에서는 안 됩니다

캡처처럼 **외모 → 편집기 → Navigation/Header** 에 HTML을 넣으면:

> *Block contains unexpected or invalid content*

WordPress **사이트 편집기(FSE)** 는 헤더·네비 템플릿에서 `<script>` 를 막습니다.  
**여기에 넣지 마세요.**

| ❌ 하지 말 것 | ✅ 대신 할 것 |
|-------------|-------------|
| 외모 → **편집기** (Site Editor) | **WPCode** 푸터 또는 **cPanel JS 업로드** |
| Navigation / Header 템플릿에 HTML 블록 | **Pages → Home** (페이지 편집) — 스크립트 없는 카드만 |

---

## 방법 A — cPanel JS 업로드 + 한 줄 삽입 (가장 확실, 추천)

PMS `maritime-pms` 업로드와 같은 방식입니다.

### 1) cPanel — JS 파일 업로드

1. **File Manager** → `public_html/wp-tvc/` 폴더 생성
2. **Upload** → `bluehost/wp/tvc-home-lead-gen.js`
3. 크기 **5KB 이상** 확인 (0 bytes 아님)

### 2) WordPress — 푸터에 한 줄만

**WPCode** (또는 **Insert Headers and Footers** 플러그인):

1. **Add Snippet** → Custom Code
2. Location: **Site Wide Footer**
3. 아래 **한 줄만** 붙여넣기:

```html
<script src="https://thevesselcode.com/wp-tvc/tvc-home-lead-gen.js" defer></script>
```

(`bluehost/wp/footer-inject-one-line.html` 에 동일 내용)

4. **Activate** → **Caching → Purge All**

### 3) 확인

- `https://thevesselcode.com/` → 우측 하단 **🚢 Upgrade Your Fleet to TVC-PMS**
- 브라우저 주소창에 직접 입력: `https://thevesselcode.com/wp-tvc/tvc-home-lead-gen.js` → JS 코드 보이면 업로드 OK

---

## 방법 B — WPCode에 HTML 전체 붙여넣기

cPanel 없이 WPCode만 쓸 때:

1. WPCode → Site Wide Footer
2. `bluehost/wp/tvc-home-lead-gen.html` **전체** 붙여넣기
3. Activate

---

## 방법 C — 테마 footer.php (플러그인 없을 때)

1. **외모 → Theme File Editor** → `footer.php`
2. `</body>` **바로 위**에 방법 A의 한 줄 `<script src=...>` 추가
3. **Update File**

> Site Editor(블록 테마 편집기)와 **Theme File Editor**는 다릅니다.

---

## 방법 D — 홈 본문 고정 카드 (스크립트 없음)

플로팅 버튼 없이 Hero 아래 카드만:

1. **Pages → Home** 편집 (**Site Editor 아님!**)
2. **+** → **Custom HTML** 블록
3. `bluehost/wp/tvc-home-lead-card-static.html` 붙여넣기 ( `<script>` 없음 → 블록 오류 없음 )
4. **Update**

버튼은 `mailto:` / `#contact` 링크로 동작 (입력 필드 없는 간단 CTA).

---

## 방법 E — 메뉴에 직접 링크 (1초 임시)

**Appearance → Menus** → Custom Link 추가:

- URL: `https://thevesselcode.com/#contact`
- Label: `Request Demo`

또는 Maritime Toolkit FAB가 있는 페이지로:

- `https://thevesselcode.com/maritime-toolkit/`

---

## 파일 목록

| 파일 | 용도 |
|------|------|
| `bluehost/wp/tvc-home-lead-gen.js` | 방법 A — cPanel 업로드 |
| `bluehost/wp/footer-inject-one-line.html` | 방법 A — WPCode 한 줄 |
| `bluehost/wp/tvc-home-lead-gen.html` | 방법 B — WPCode 전체 HTML |
| `bluehost/wp/tvc-home-lead-card-static.html` | 방법 D — 스크립트 없는 카드 |
| `bluehost/wp/tvc-home-lead-card.html` | 카드 + JS (일부 환경에서 블록 오류 가능) |

---

## 지금 화면에서 할 일 (캡처 기준)

1. Site Editor에서 붙여넣은 **잘못된 HTML 블록 삭제** (Attempt recovery → 블록 제거)
2. **Review 1 change** 저장하지 말고 **Discard** 또는 블록만 삭제 후 저장
3. 위 **방법 A** 로 `wp-tvc/tvc-home-lead-gen.js` 업로드 + WPCode 한 줄

---

## 폼 제출 동작 (FAB 모달)

제출 시 `mailto:contact@thevesselcode.com` + `https://thevesselcode.com/#contact` 새 탭.
