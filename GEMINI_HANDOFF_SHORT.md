# TVC-PMS → Gemini (짧은 버전)

## 로그인
engineer / 0000 / ENGINE

## 완료 PR (최신 · master 반영됨)
- **#28 AI Help action guide copy** — MERGED ✅ 동선 titles + [Consumed Parts]/[New Requisition]
- **#27 AI Help UI workflows** — MERGED ✅
- **#26 AI Help chat fix** — MERGED ✅ (canvas JPEG 1200px + feedback API)

## Gemini handoff (master)
https://raw.githubusercontent.com/kckimmarine/thevesselcode-pms/master/GEMINI_HANDOFF_SHORT.md

## AI Help (Mode A + B)
- Mode A: fuzzy match → concrete click paths ([PMS], [Make Report], [Report History], [SPARE], [Consumed Parts], [New Requisition], [Period])
- Mode B: `compressImageFile()` canvas max 1200px JPEG 0.7 before POST `/api/feedback`
- `api/feedback.js`: 4MB limit, GITHUB_TOKEN check, try/catch GitHub issue create

## Gemini에게
모바일 CSS는 `@media screen and (max-width: 768px)` only. CEO queue issues must stay `pending-review` — never auto-merge code from crew reports.
