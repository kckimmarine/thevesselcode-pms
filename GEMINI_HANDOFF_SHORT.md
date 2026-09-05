# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신)
- **#23 Header Feedback modal (multi photo + comment blocks)**

## PR #23 Feedback Modal
- `index.html`: `#btn-open-feedback` next to Settings in tab bar; `#modal-feedback`, `#feedback-item-list`
- `js/ui/feedback.js`: `TVC_Feedback` — dynamic cards, paste image, submit mock + toast
- `css/app.css`: `.btn-feedback`, `.feedback-modal` (520px desktop, 95vw mobile ≤768px)
- Settings / Dept / Refresh actions unchanged

## PR #22 Work Procedure Modal Mobile
- `#workProcedureModal` centering at ≤768px

## PR #21 Mobile Period + Machinery Card
- Period row flex-wrap; Machinery 2-row layout (≤768px only)

## PR 링크
github.com/kckimmarine/thevesselcode-pms/pull/22
github.com/kckimmarine/thevesselcode-pms/pull/23

## 브랜치
cursor/feedback-modal-f39c (base: master)

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` 안에만. Desktop (>768px) 레이아웃 변경 금지.
