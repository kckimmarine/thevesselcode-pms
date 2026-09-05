# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신)
- #20 SW 즉시 새로고침 + Cursor PR 자동 머지 (master)
- **#21 모바일 Period row + Machinery info card 레이아웃 (≤768px)**

## PR #21 Mobile Period + Machinery Card
- 파일: `css/app.css` only
- 범위: `@media screen and (max-width: 768px)` ONLY — desktop (>768px) 변경 없음
- Period row: `.filter-bar.list-filter-period-row`, `.act-period-filter` flex-wrap, gap 8px, date inputs 50% each
- Machinery card: `.spare-gh-row-plan-split.spare-gh-row-primary-split` → Row1 PMS+Equipment 50/50, Row2 Critical Equipment 100%
- JS/HTML/필터 핸들러 변경 없음

## PR #20 Automation
- service-worker.js + js/pwa.js instant refresh
- ci.yml + cursor-auto-merge.yml

## E2E
period-datepicker.spec.js, mobile-orientation.spec.js

## PR 링크
github.com/kckimmarine/thevesselcode-pms/pull/20
github.com/kckimmarine/thevesselcode-pms/pull/21

## 브랜치
cursor/mobile-period-machinery-f39c (base: master)

## Gemini에게
위 맥락으로 TVC-PMS UI/E2E/자동화 이어서 작업. 모바일 전용 CSS는 반드시 `@media screen and (max-width: 768px)` 안에만 작성.
