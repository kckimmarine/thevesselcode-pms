# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신 · master 반영됨)
- **#29 AI Help visual wording** — MERGED ✅ screen-only labels, no Routine/Incident/Consumed Parts
- **#28–#26** — MERGED ✅ (compression, feedback API, UI workflows)

## Gemini handoff (master)
https://raw.githubusercontent.com/kckimmarine/thevesselcode-pms/master/GEMINI_HANDOFF_SHORT.md

## AI Help (Mode A + B)
- Mode A: **visual UI labels only** — no internal report type / DB names in answers
- Mode B: canvas JPEG 1200px q0.7 before POST `/api/feedback`
- `api/feedback.js`: 4MB limit, token check, try/catch → 200/500

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` only. CEO queue issues must stay `pending-review` — never auto-merge code from crew reports.
