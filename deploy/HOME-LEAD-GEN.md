# WordPress 홈 — Lead-gen FAB + 데모 신청 폼

Maritime Toolkit과 **동일한** 플로팅 버튼 + 데모 신청 모달을 `thevesselcode.com` **홈 화면**에 배치합니다.

| 파일 | 용도 |
|------|------|
| `bluehost/wp/tvc-home-lead-gen.html` | 방법 1 — FAB + 클릭 시 모달 (전체 사이트 푸터) |
| `bluehost/wp/tvc-home-lead-card.html` | 방법 2 — 홈 본문 고정 카드 (Custom HTML 블록) |

스타일·문구는 `js/ui/storePublicLead.js` + `css/store-public.css` 와 동일 브랜드입니다.

---

## 방법 1 — 플로팅 버튼 + 모달 (추천, 1분)

**홈에서만** 우측 하단 `🚢 Upgrade Your Fleet to TVC-PMS` 버튼이 보입니다.

### WPCode (또는 Insert Headers and Footers)

1. WordPress → **WPCode** → **Add Snippet** → **Add Your Custom Code**
2. Code Type: **HTML Snippet**
3. Location: **Site Wide Footer**
4. `bluehost/wp/tvc-home-lead-gen.html` **전체** 붙여넣기
5. **Activate**

### 테마 footer.php (대안)

`wp-content/themes/…/footer.php` 의 `</body>` 직전에 동일 코드 붙여넣기.

### 확인

1. **Caching → Purge All**
2. 시크릿 창 → `https://thevesselcode.com/`
3. 우측 하단 FAB 클릭 → 모달 폼 표시
4. `/maritime-toolkit/` 등 **다른 페이지**에서는 FAB **안 보임** (정상)

---

## 방법 2 — 홈 본문 고정 카드

팝업 없이 Hero 아래에 항상 보이는 신청 창구.

1. WordPress → **Pages → Home** 편집
2. 적절한 위치에 **Custom HTML** 블록 추가
3. `bluehost/wp/tvc-home-lead-card.html` **전체** 붙여넣기
4. **Update** → 캐시 삭제

방법 1 + 2 **동시 사용 가능** (FAB는 푸터, 카드는 본문).

---

## 폼 제출 동작

제출 시:

1. `mailto:contact@thevesselcode.com` (이름·이메일·회사·역할 포함)
2. `https://thevesselcode.com/#contact` 새 탭

나중에 HubSpot / Formspree 등으로 바꿀 때는 `<form>` 의 `action` 만 교체하면 됩니다.

---

## 주의

- Code Editor 저장 후 **0 bytes** 되면 → 내용 **Upload** 또는 다시 붙여넣기 (PMS embed 와 동일)
- FAB가 다른 페이지에도 보이면 → 스니펫에 `isHome` 조건이 빠졌는지 확인
- 연락 이메일 변경 시 스니펫 내 `contact@thevesselcode.com` 검색·교체
