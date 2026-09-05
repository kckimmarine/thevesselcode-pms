# TVC-PMS 작업 인수인계 요약 (Gemini용)

> 생성일: 2026-09-05  
> 목적: Cursor Cloud Agent에서 진행한 UI/E2E 작업 내용을 Gemini에게 전달하기 위한 문서

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 저장소 | `thevesselcode-pms` |
| 기준 브랜치 | `cursor/playwright-e2e-ui-audit-f39c` |
| 데모 로그인 | username: `engineer`, password: `0000`, dept: `ENGINE` |
| 빌드 | `npm run build` |
| E2E | `npx playwright install chromium` 후 `npx playwright test e2e/...` |
| E2E base URL | `http://127.0.0.1:4173` (playwright.config.js webServer) |

---

## 2. 완료된 PR 목록

| PR | 제목 | 브랜치 | base |
|----|------|--------|------|
| #15 | Report History Detail Report 모달 빈 화면 수정 | `cursor/report-history-detail-modal-f39c` | master |
| #16 | Spare Report History 더블탭 + 모바일 requisition 모달 | `cursor/spare-hist-touch-mobile-f39c` | master |
| #17 | 모바일 PMS GROUP Tree compact | `cursor/pms-tree-mobile-compact-f39c` | master |
| #18 | Period datepicker 클릭/탭 수정 | `cursor/period-datepicker-fix-f39c` | `cursor/playwright-e2e-ui-audit-f39c` |
| #19 | 모바일 CSS 세로+가로 breakpoint 통합 | `cursor/mobile-orientation-media-f39c` | `cursor/playwright-e2e-ui-audit-f39c` |

**머지 순서 참고**: PR #19는 PR #18 커밋을 포함한 브랜치에서 분기됨. #18 → #19 순 검토 권장.

---

## 3. PR #15 — Report History Detail Report 모달

**문제**: Report History에서 Detail Report 클릭 시 모달 내용이 비어 보임.

**수정**:
- `js/app.js`: `resolveWrFormForView()`, `wrRoDisplay()`, `wf()` readonly fallback
- `css/app.css`, `index.html`: 모바일 `#workReportModal` (95vw/90vh, scrollable body)
- `e2e/hist-detail-modal.spec.js` 추가

**검증**: `npm run build` ✓, E2E 2/2 ✓

---

## 4. PR #16 — Spare Report History 터치 + 모달

**문제**: Spare Report History 행 더블탭 미동작, 모바일 requisition 모달 레이아웃.

**수정**:
- `js/ui/spareMenu.js`: `bindSpareHistReqListTouchEvents()` (300ms double-tap → `reqListOpenRow()`)
- `css/app.css`: 모바일 `#spareReqWorkModal` 1-column meta form, footer 버튼
- `e2e/spare-hist-touch.spec.js` 추가

**검증**: `npm run build` ✓, E2E ✓

---

## 5. PR #17 — PMS GROUP Tree compact (모바일)

**문제**: 모바일 PMS 탭 GROUP Tree 높이가 SPARE 대비 과도하게 큼.

**수정** (`css/app.css`, `@media max-width: 768px` — 이후 #19에서 landscape까지 확장):
- `#tab-actual .actual-layout .tree-panel` → `min-height: auto`
- `#tab-actual #actTree` → `max-height: 180px`, internal scroll, `touch-action: manipulation`

**검증**: `npm run build` ✓

---

## 6. PR #18 — Period Datepicker 클릭/탭 수정 ★

**문제**: Work Plan / Report History의 Period 필터 날짜 입력·달력 아이콘이 클릭/탭해도 datepicker가 안 열림.

**대상 파일**:
- `index.html`
- `js/pwa.js`
- `js/app.js`
- `css/app.css`

**Period 입력 ID**:
- Work Plan: `#actPeriodFrom`, `#actPeriodTo` (wrapper: `#actPeriodFilter`)
- Report History: `#histPeriodFrom`, `#histPeriodTo` (wrapper: `#histPeriodFilter`)

**수정 내용**:

1. **index.html**  
   - `type="date"` → `type="text"` + class `act-period-input tvc-date-input`  
   - `placeholder="YYYY-MM-DD"`, `autocomplete="off"`  
   - `onchange`는 기존 유지: `TVC_App.onActualPeriodChange()` / `onReportPeriodChange()`

2. **js/pwa.js**  
   - `attachDatePicker()`: calendar 버튼·텍스트 입력에 `click` + `touchend` (400ms debounce로 double-fire 방지)  
   - `initPeriodDatePickers(scope)`: `.act-period-filter` 및 `#actPeriodFilter`, `#histPeriodFilter` 대상  
   - `openDatePicker()` → `showPicker()` 또는 positioned native `<input type="date">` fallback

3. **js/app.js**  
   - `initPeriodDatePickers()` → `TVC_PWA.initPeriodDatePickers()` 호출  
   - 호출 시점: `refreshAll()`, `renderActualPlan()`, `renderWorkHistory()`  
   - **필터 로직 변경 없음** (`onActualPeriodChange`, `onReportPeriodChange`, state sync 그대로)

4. **css/app.css**  
   - `.act-period-filter`: `position: relative`, `z-index: 10`, `pointer-events: auto`, `touch-action: manipulation`  
   - 모바일(≤768px): period row `flex-wrap: wrap`, calendar btn `min 32×32px`

**검증**: `npm run build` ✓, `e2e/period-datepicker.spec.js` 2/2 ✓

---

## 7. PR #19 — 모바일 CSS 세로+가로 통합 ★

**문제**: `@media (max-width: 768px)`만 사용하면 **가로 모드**(예: iPhone 844×390)에서 모바일 스타일 미적용.  
→ PMS GROUP Tree가 landscape에서도 크게 표시됨.

**해결 — 표준 TVC 모바일 breakpoint** (`css/app.css` 상단 주석):

```css
@media screen and (max-width: 768px),
       screen and (max-height: 600px) and (max-width: 1024px) {
    /* 폰 전용 (세로 + 가로) */
}
```

| 조건 | 적용 대상 |
|------|-----------|
| `max-width: 768px` | 세로 폰 (390×844 등) |
| `max-height: 600px` AND `max-width: 1024px` | 가로 폰 (844×390 등) |

**변경 범위**:
- 기존 `@media (max-width: 768px)` 3곳 → OR 조건으로 교체
- `@media (max-width: 720px)`, `(max-width: 480px)` 폰 관련 블록(login, act-filter-dashboard, PWA legend 등)도 동일 OR 추가
- PMS GROUP Tree compact (`#actTree` max-height 180px) → 위 breakpoint 안에 포함
- `.tree-panel { min-height: 280px }` → 모바일 nav 블록에서 `min-height: auto`

**검증**:
- `npm run build` ✓
- `e2e/mobile-orientation.spec.js` (844×390): mobile nav visible, tree max-height ≤200px, period btn ≥32px ✓
- `e2e/period-datepicker.spec.js` 2/2 ✓

---

## 8. 앞으로 모바일 CSS 작성 규칙 (중요)

**하지 말 것**:
```css
@media (max-width: 768px) { ... }  /* 가로 폰에서 빠짐 */
```

**할 것**:
```css
@media screen and (max-width: 768px),
       screen and (max-height: 600px) and (max-width: 1024px) {
    /* Period, Tree, Modal, touch targets 등 폰 전용 */
}
```

`orientation: portrait/landscape` 단독 사용보다 **너비+높이 조합**이 PC 회귀를 더 잘 방지함.

---

## 9. E2E 테스트 파일

| 파일 | 내용 |
|------|------|
| `e2e/hist-detail-modal.spec.js` | Report History Detail Report 모달 |
| `e2e/spare-hist-touch.spec.js` | Spare history double-tap |
| `e2e/period-datepicker.spec.js` | Period datepicker desktop + 390px portrait |
| `e2e/mobile-orientation.spec.js` | 844×390 landscape: nav, tree, period btn |
| `e2e/mobile-ui.spec.js` | 390px overflow/overlap audit |
| `e2e/helpers/app.js` | `login`, `switchTab`, `waitForJobs` 등 |

**Playwright viewport 예시**:
```javascript
// 세로
await page.setViewportSize({ width: 390, height: 844 });
// 가로
await page.setViewportSize({ width: 844, height: 390 });
```

---

## 10. 주요 코드 위치 참조

| 기능 | 파일 | 비고 |
|------|------|------|
| Period 필터 HTML | `index.html` ~255–311 | `#actPeriodFilter`, `#histPeriodFilter` |
| Period change 핸들러 | `js/app.js` | `onActualPeriodChange`, `onReportPeriodChange`, `syncActualPeriodInputs`, `syncReportPeriodInputs` |
| Date picker UI | `js/pwa.js` | `initDateInputFormat`, `initPeriodDatePickers`, `attachDatePicker`, `openDatePicker` |
| Spare 동적 Period | `js/ui/spareMenu.js` | `renderReqListFiltersHtml()` — 이미 `tvc-date-input` 패턴 사용 |
| 모바일 nav | `js/pwa.js` | `initMobileNav`, `toggleMobileNav` |
| 모바일 CSS | `css/app.css` | `@media` 블록 다수, 맨 아래 mobile-only 섹션 ~10006행 근처 |
| responsive scale | `css/responsive-scale.css` | 960px만 사용, orientation 통합 **미적용** |

---

## 11. 미완 / 후속 검토 항목

- [ ] PR #18, #19 코드 리뷰 및 머지
- [ ] `css/app.css` 내 640px, 900px 등 breakpoint 중 **폰 전용** 규칙 추가 통합 여부
- [ ] `css/responsive-scale.css` orientation breakpoint 적용 필요 여부
- [ ] `js/pms.js`에는 Period UI 로직 없음 (스케줄링만) — Period 수정은 `app.js` / `pwa.js` 쪽

---

## 12. 한 줄 요약

Period datepicker 클릭/탭 수정(#18)과, 모바일 CSS가 **세로·가로 폰 모두** 적용되도록 breakpoint를 `(max-width:768px) OR (max-height:600px AND max-width:1024px)`로 통일하고 PMS Tree compact를 포함(#19)했다. 이후 폰 전용 CSS는 이 패턴을 따르면 된다.

---

## 13. GitHub PR 링크

- https://github.com/kckimmarine/thevesselcode-pms/pull/18 (Period datepicker)
- https://github.com/kckimmarine/thevesselcode-pms/pull/19 (Mobile orientation CSS)

(이전 PR #15–#17은 master 대상으로 이미 생성됨 — 저장소에서 상태 확인 필요)
