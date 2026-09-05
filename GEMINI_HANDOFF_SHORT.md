# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신 · master 반영됨)
- **#31 FEEDBACK_QUEUE.json** — MERGED ✅ Mode B appends ticket to repo queue + GitHub Issue
- **#29 AI Help visual wording** — MERGED ✅
- **#26–#28** — MERGED ✅ compression, feedback API, UI guides

## Gemini handoff (master)
https://raw.githubusercontent.com/kckimmarine/thevesselcode-pms/master/GEMINI_HANDOFF_SHORT.md

## Crew feedback queue (Gemini / Cursor read path)
- **`FEEDBACK_QUEUE.json`** at repo root — machine-readable pending tickets
- Each Mode B submit: `id` (`FB-YYYYMMDD-HHMMSS`), `timestamp`, `page`, `deviceInfo`, `issue`, `hasImage`, `status: pending`
- Also creates GitHub Issue labels `pending-review`, `crew-feedback`
- API: POST `/api/feedback` → `{ ok, ticketId, issueNumber, issueUrl }`

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` only. CEO queue issues must stay `pending-review` — never auto-merge code from crew reports.
