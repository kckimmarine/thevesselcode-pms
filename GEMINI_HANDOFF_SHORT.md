# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신 · master 반영됨)
- **#24 AI Help dual-engine** — MERGED ✅
- **#25 feedback API JSON validation** — MERGED ✅
- 포함: #21 Period/Machinery mobile, #22 WP modal, AI Help (#23 Feedback 대체)

## Gemini handoff (master)
https://raw.githubusercontent.com/kckimmarine/thevesselcode-pms/master/GEMINI_HANDOFF_SHORT.md
- `#modal-ai-help` — Mode A Quick Guide (instant chat, no GitHub)
- Mode B Report Issue → POST `/api/feedback` → GitHub Issue labels `pending-review`, `crew-feedback`
- `js/app.js`: `openAiHelp`, `askAiHelp`, `submitAiHelpReport`
- `api/feedback.js`: serverless GitHub issue creator (GITHUB_TOKEN server-side only)
- No auto-patch on user reports

## PR #23 Feedback → superseded by AI Help
## PR #22 WP modal mobile | #21 Period/Machinery mobile

## PR 링크
github.com/kckimmarine/thevesselcode-pms/pull/24

## 브랜치
cursor/ai-help-dual-engine-f39c (base: master)

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` only. CEO queue issues must stay `pending-review` — never auto-merge code from crew reports.
