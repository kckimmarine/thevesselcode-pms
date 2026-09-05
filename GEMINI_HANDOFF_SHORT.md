# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR
- #15 Report History Detail 모달 빈화면
- #16 Spare history 더블탭 + 모바일 modal
- #17 PMS Tree compact
- #18 Period datepicker 클릭/탭 수정
- #19 모바일 CSS 세로+가로 통합
- #20 SW 즉시 새로고침 + Cursor PR 자동 머지

## PR #20 Automation & Cache (최신)
- 브랜치: `cursor/automation-cache-automerge-f39c` → base `master`
- **Service Worker**: `service-worker.js` cache `tvc-pms-1.0.6-automerge`, `SKIP_WAITING`, fetch `no-store`, skipWaiting + clients.claim
- **PWA**: `js/pwa.js` — 웹포털 포함 SW 등록, `updateViaCache: 'none'`, 업데이트 시 즉시 활성화 + reload
- **Vercel**: `vercel.json` — `/js/*`, `/css/*` no-cache
- **CI**: `.github/workflows/ci.yml` — PR/push 시 `npm run build`
- **Auto-merge**: `.github/workflows/cursor-auto-merge.yml` — `cursor/*` → `master`, CI green 시 자동 머지 (same-repo, fork 제외)
- IndexedDB(`js/core/db.js`) 변경 없음

## PR #18 Period datepicker
- 파일: index.html, js/pwa.js, js/app.js, css/app.css
- 입력: #actPeriodFrom/To, #histPeriodFrom/To → text + tvc-date-input
- pwa.js: touchend+click → openDatePicker(), initPeriodDatePickers()
- app.js: refreshAll/renderActualPlan/renderWorkHistory 후 init 호출
- 필터 함수 변경 없음 (onActualPeriodChange, onReportPeriodChange)

## PR #19 모바일 세로+가로
폰 전용 CSS는 반드시:
```css
@media screen and (max-width: 768px),
       screen and (max-height: 600px) and (max-width: 1024px) { }
```
- 세로: width≤768 / 가로폰: height≤600 & width≤1024
- #actTree max-height 180px (세로·가로 공통)

## E2E
period-datepicker.spec.js, mobile-orientation.spec.js (844×390)

## PR 링크
github.com/kckimmarine/thevesselcode-pms/pull/18
github.com/kckimmarine/thevesselcode-pms/pull/19
github.com/kckimmarine/thevesselcode-pms/pull/20

## 브랜치
cursor/period-datepicker-fix-f39c
cursor/mobile-orientation-media-f39c
cursor/automation-cache-automerge-f39c
(base: cursor/playwright-e2e-ui-audit-f39c, #20 base: master)

## Gemini에게
위 맥락으로 TVC-PMS UI/E2E/자동화 이어서 작업. 모바일 CSS는 768px만 쓰지 말고 OR breakpoint 사용. PR #20은 master 머지 후 cursor/* PR 자동 머지 활성화.
