# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신)
- #21 모바일 Period row + Machinery info card (≤768px)
- **#22 Work Procedure modal 모바일 centering + left clipping fix (≤768px)**

## PR #22 Work Procedure Modal Mobile
- 파일: `css/app.css` only
- `@media screen and (max-width: 768px)` ONLY
- `#workProcedureModal#workProcedureModal .modal-box.wp-modal` — fixed center, 95vw, 90dvh
- Header/tabs/body/footer mobile layout; double-ID beats responsive-scale 820px !important
- JS/HTML 변경 없음

## PR #21 Mobile Period + Machinery Card
- Period row flex-wrap; Machinery card 2-row layout (≤768px only)

## PR #20 Automation
- SW instant refresh + cursor/* auto-merge (master)

## PR 링크
github.com/kckimmarine/thevesselcode-pms/pull/21
github.com/kckimmarine/thevesselcode-pms/pull/22

## 브랜치
cursor/wp-modal-mobile-f39c (base: master)

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` 안에만. Desktop (>768px) 변경 금지.
