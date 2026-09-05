# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신 · master 반영 예정)
- **#26 AI Help chat fix** — fuzzy guide matching + screenshot compression + feedback API hardening
- **#24 AI Help dual-engine** — MERGED ✅
- **#25 feedback API JSON validation** — MERGED ✅

## Gemini handoff (master)
https://raw.githubusercontent.com/kckimmarine/thevesselcode-pms/master/GEMINI_HANDOFF_SHORT.md

## AI Help (Mode A + B)
- `#modal-ai-help` — Mode A Quick Guide (instant chat, no GitHub)
- Mode B Report Issue → POST `/api/feedback` → GitHub Issue labels `pending-review`, `crew-feedback`
- **Mode A fuzzy keywords:** 레포트/종류/report, 스페어/부품/spare/재고, 동기화/sync/export/import
- **Mode B compression:** canvas max 1200px, JPEG quality 0.7 before POST (Vercel 4.5MB limit)
- `js/app.js`: `matchAiHelpGuide`, `compressImageFile`, `submitAiHelpReport`
- `api/feedback.js`: payload limit 4MB, GITHUB_TOKEN check, try/catch GitHub issue create

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` only. CEO queue issues must stay `pending-review` — never auto-merge code from crew reports.
