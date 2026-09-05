# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신 · master 반영됨)
- **#27 AI Help UI workflows** — MERGED ✅ concrete [PMS]/[SPARE]/[Make Report] click paths
- **#26 AI Help chat fix** — MERGED ✅
- **#24 AI Help dual-engine** — MERGED ✅
- **#25 feedback API JSON validation** — MERGED ✅

## Gemini handoff (master)
https://raw.githubusercontent.com/kckimmarine/thevesselcode-pms/master/GEMINI_HANDOFF_SHORT.md

## AI Help (Mode A + B)
- Mode A: fuzzy keyword match → step-by-step UI workflows (not textbook descriptions)
- Topics: 레포트 작성([PMS]→[Make Report]→[Report History]), 부품([Page 2]/[SPARE]/[Make Requisition]), [Period] 필터
- Mode B: canvas JPEG compression + `/api/feedback` → GitHub `pending-review`, `crew-feedback`

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` only. CEO queue issues must stay `pending-review` — never auto-merge code from crew reports.
