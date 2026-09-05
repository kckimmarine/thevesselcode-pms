# Gemini ↔ Cursor Collaboration Guide

This document is the **handoff layer** between Google Gemini (design, domain, review) and Cursor (implementation, E2E, PR).

---

## Roles

| Tool | Best for |
|------|----------|
| **Gemini** | Domain rules, Korean UX copy, workflow validation, comparing requirements to manuals, reviewing screenshots, drafting acceptance criteria |
| **Cursor** | Code changes, IndexedDB/transaction logic, Playwright E2E, git/PR, running `npm start` / `test:e2e` |

**Shared truth:** [`AGENTS.md`](../AGENTS.md), [`UI-MAP.md`](UI-MAP.md), [`workflow-manual-v1.md`](workflow-manual-v1.md)

---

## ⚠️ Golden rule — review before implement

When the user pastes content **from Gemini** (requirements, designs, refactors, full rewrites):

1. **Do not apply blindly.** Gemini output is input, not an order.
2. **Compare first** against the current codebase and docs (`UI-MAP.md`, `workflow-manual-v1.md`, running behavior).
3. **Decide what is truly necessary** — skip duplicate work, wrong file targets, or changes that break desktop/offline/stock rules.
4. **Improve incrementally** — smallest correct diff from **today’s** state; one logical step per PR when possible.
5. **Say what you skipped** — briefly list Gemini items deferred or rejected and why.

Cursor should reply with a short **gap analysis** (As-Is vs Gemini proposal → adopt / defer / reject) **before** large edits, unless the user explicitly says “implement as written.”

---

## Handoff protocol

### Gemini → Cursor (implementation task)

Paste this block at the top of the Cursor agent message:

```markdown
## Handoff from Gemini
- **Task ID:** (e.g. TVC-PMS-WR-001)
- **Goal:** (one sentence)
- **As-Is:** (current behavior + file:function)
- **To-Be:** (desired behavior)
- **Review mode:** compare with repo first; incremental only; do not blind-apply
- **Files allowed:** js/app.js, js/ui/spareMenu.js, css/app.css (list explicitly)
- **Files forbidden:** index.html, js/auth.js (unless listed)
- **Constraints:** offline only; desktop >768px no regression; atomic stock
- **Acceptance:** (bullets + how to test)
- **Open questions:** (none / list)
```

**Cursor first response should include:** (1) what already exists, (2) what from Gemini is needed now, (3) proposed minimal step.

### Cursor → Gemini (review task)

Paste after implementation:

```markdown
## Handoff to Gemini for review
- **Branch / PR:** cursor/…-f39c
- **Diff summary:** (3–5 bullets)
- **Test evidence:** TEST_REPORT.md / screenshots / e2e pass count
- **Please verify:** domain rules §X, Korean labels, mobile 390px
- **Known gaps:** (honest list)
```

---

## Gemini system context (copy-paste)

Use the following as **Gemini custom instructions** or the first message in a Gemini chat about TVC-PMS:

---

### TVC-PMS context pack (v1)

You are advising on **THE VESSEL CODE PMS** — an offline-first ship maintenance app (PMS + SPICS).

**Stack:** Vanilla JS SPA, `index.html` + `css/app.css` + `js/app.js` (~18k lines). IndexedDB via `js/core/db.js`. No React/Vue.

**Main tabs:** Menu | PMS | SPARE | Report History

**Report types:**

| Type | Modal | JS module |
|------|-------|-----------|
| Maintenance / Postpone | `#workReportModal` | `TVC_App` in `js/app.js` |
| Defect | `#defectReportModal` | `TVC_DefectReport` |
| Work Permit | `#workPermitModal` | `TVC_WorkPermitReport` |
| Spare consumption | `#spareConsumeModal` | `TVC_SpareMenu` |

**Work Report today:**

- Page 1: full maintenance form (`renderWrRepairMaintenanceBody`)
- Page 2: spare virtual list (`renderWrSparePage2Html`)
- Save: `saveWorkReport` → `syncConsumeLogFromWorkReport` → stock deduct in IndexedDB
- Footer: Save + Cancel (not yet Draft/Submit in Korean)

**Roles (password `0000`):** `officer` Deck, `engineer` Engine, `ce`/`captain` confirm, `hq` approve.

**Status flow:** REPORTED → CONFIRMED → APPROVED; sync via ZIP only.

**Mobile:** 390px audit in `TEST_REPORT.md`; drawer/header bugs documented in `docs/MOBILE-UX.md`.

**Do not assume:** Work Report UI is in `js/pms.js` (that file is scheduling helpers only).

When proposing UI changes, specify: modal id, Page tab, `data-wf` field keys, desktop vs mobile-only CSS, and stock lifecycle (draft vs submit).

**Process:** Proposals will be compared to the existing repo before implementation. Prefer incremental improvements over full rewrites unless the gap analysis justifies a larger change.

---

## Active backlog (shared)

Track cross-tool work here; update when status changes.

| ID | Summary | Owner | Status |
|----|---------|-------|--------|
| WR-001 | Routine-only form + Trouble/Defect conditional RCA | Cursor | **Not started** (schema keys only) |
| WR-002 | Inline spare search on WR Page 1 | Cursor | **Not started** |
| WR-003 | Footer: 임시저장 + 제출; draft skips stock | Cursor | **Not started** |
| WR-004 | `isDraftStatus` in rbac — wire to save flow | Cursor | **Partial** |
| MOB-001 | Drawer vs End / hamburger z-index | TBD | Open (see TEST_REPORT) |
| MOB-002 | PMS stack layout @ 390px | TBD | Open |

---

## Filled example — Station Work Report task

### Handoff from Gemini → Cursor

```markdown
## Handoff from Gemini
- **Task ID:** WR-001..003
- **Goal:** Station Work Report — compact form, inline spare, draft/submit, mobile-safe desktop
- **As-Is:**
  - Form: `js/app.js` `renderWrRepairMaintenanceBody` shows all fields always
  - Spare: Page 2 only (`spareMenu.js` `renderWrSparePage2Html`)
  - Save: single `saveWorkReport()` always REPORTED + stock sync
  - Footer: Save + Cancel (`renderWorkReportModal` ~16627)
- **To-Be:**
  1. Default fields: Job title, Date, Person in charge, Job Description
  2. Checkbox "Trouble / Defect" reveals RCA + meStop + delayHours
  3. Inline spare quick-search on Page 1; stock on **제출** only
  4. Footer: 임시저장 (Save Draft) | 제출 (Submit)
  5. Card padding 12–14px (already in CSS; verify mobile)
- **Files allowed:** js/app.js, js/ui/spareMenu.js, css/app.css (@media max 768px), js/rbac.js, js/services/transaction.js (draft status only)
- **Files forbidden:** index.html, js/auth.js
- **Constraints:** offline IndexedDB; atomic stock once per line; desktop >768px layout unchanged
- **Acceptance:**
  - Engineer: PMS → Make Report → inline spare qty → 제출 → currentStock decreases once
  - 임시저장 → stock unchanged
  - Trouble unchecked → RCA hidden
  - `npm run test:e2e` still passes or updated intentionally
- **Open questions:** Should draft appear in History tab? (default: yes with DRAFT status)
```

### Acceptance checklist (Korean) — for Gemini review

제미나이 검수 시 아래 3항을 확인:

1. **재고 차감:** 제출 시에만 `currentStock`이 정확히 1회 차감되는가? 임시저장·재제출·수정 시 중복 차감이 없는가?
2. **Trouble 폼:** Trouble/Defect 미체크 시 RCA·지연 필드가 숨겨지고, 체크 시에만 노출되는가?
3. **데스크톱:** 769px 이상에서 기존 1000px 모달·그리드가 깨지지 않았는가?

---

## Repository map (quick)

```
/workspace
├── AGENTS.md              ← AI entry point
├── docs/
│   ├── UI-MAP.md          ← screens & modals
│   ├── UI-PATTERNS.md     ← wr-maint, spare, stock
│   ├── MOBILE-UX.md       ← 390px issues
│   ├── GEMINI-COLLAB.md   ← this file
│   └── workflow-manual-v1.md
├── js/app.js              ← Work Report controller
├── js/ui/spareMenu.js     ← Spare UI + WR page 2
├── js/pms.js              ← NOT report UI
├── css/app.css
├── e2e/                   ← Playwright
└── TEST_REPORT.md         ← last E2E evidence
```

---

## Versioning

| Doc | Version | Date |
|-----|---------|------|
| GEMINI-COLLAB | 1.0 | 2026-09-04 |
| UI-MAP | 1.0 | 2026-09-04 |

When Gemini and Cursor agree on a workflow change, bump version and add a one-line changelog at the bottom of this file.

### Changelog

- **2026-09-04** — Golden rule: review Gemini paste vs repo; incremental adoption only.
- **2026-09-04** — Initial collaboration pack; WR station backlog documented.
