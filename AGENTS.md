# AGENTS.md — TVC-PMS AI Development Guide

This file helps **Cursor Cloud Agents**, **Cursor IDE**, and **Gemini** work on the same codebase without duplicating discovery or breaking ship-side constraints.

## Product summary

**THE VESSEL CODE (TVC-PMS)** is an offline-first PMS + SPICS web app for vessel stations and HQ. Data sync is **ZIP export/import only** — no live cloud API in normal ship operation.

| Layer | Path |
|-------|------|
| Shell | `index.html` |
| Styles | `css/app.css` |
| Main UI controller | `js/app.js` (`TVC_App`) |
| Reports (Defect / Permit) | `js/ui/defectReport.js`, `js/ui/workPermit.js` |
| Spare inventory UI | `js/ui/spareMenu.js` (`TVC_SpareMenu`) |
| Transactions & stock | `js/services/transaction.js`, `js/services/inventoryService.js` |
| IndexedDB | `js/core/db.js`, `js/core/schema.js` |
| RBAC / Auth | `js/rbac.js`, `js/auth.js` |
| Station modes | `js/space.js` (`TVC_Space`) |

**UI map:** [`docs/UI-MAP.md`](docs/UI-MAP.md)  
**UI patterns:** [`docs/UI-PATTERNS.md`](docs/UI-PATTERNS.md)  
**Mobile UX:** [`docs/MOBILE-UX.md`](docs/MOBILE-UX.md)  
**Gemini handoff:** [`docs/GEMINI-COLLAB.md`](docs/GEMINI-COLLAB.md)  
**Workflow (status/export):** [`docs/workflow-manual-v1.md`](docs/workflow-manual-v1.md)

---

## Run & test

```bash
npm start                    # http://localhost:3000 (preferred)
npm run test:e2e             # Playwright — serves repo on :4173
npm run test:e2e:install     # first-time browser install
npm run verify-all           # RBAC + sync checks
```

**Do not** open `index.html` via `file://` — it uses a separate browser storage profile.

### Demo login (password `0000`)

| User | Dept | Role | Typical use |
|------|------|------|-------------|
| `officer` | Deck | Officer | PMS report input |
| `engineer` | Engine | Engineer | PMS + SPARE consumption |
| `ce` | Engine | Chief Engineer | Confirm + SPARE admin |
| `captain` | Deck | Captain | Confirm + export |
| `hq` | — | HQ | Approve imported reports |

Demo vessel: **INCHEON CHEMI**

---

## Where to change what (common mistake)

| Task | Change here | Do **not** assume |
|------|-------------|-------------------|
| Work Report form / modal | `js/app.js` | `js/pms.js` (scheduling only) |
| Work Report spare Page 2 | `js/ui/spareMenu.js` | `js/pms.js` |
| Defect Report UI | `js/ui/defectReport.js` | `js/app.js` (orchestration only) |
| Work Permit UI | `js/ui/workPermit.js` | — |
| Stock deduct / confirm | `js/services/transaction.js`, `js/ui/spareMenu.js` | Deduct on wrong lifecycle step |
| Mobile layout | `css/app.css` `@media (max-width: 768px)` | Avoid changing `>768px` unless requested |

---

## Hard constraints (ship / offline)

1. **Offline safe** — IndexedDB + `localStorage` only. No external fetch for core flows.
2. **Desktop regression** — When a task says “no desktop regression”, limit layout changes to `@media (max-width: 768px)` unless the user explicitly allows desktop changes.
3. **Atomic stock** — Spare consumption must use `TVC_InventoryService` / consume log diff (`stock_applied_at`). Never double-deduct.
4. **Department scope** — Deck users cannot report Engine jobs (`DEPT_FORBIDDEN`).
5. **Sensitive files** — Do not commit `.env`, `deploy/.env.local`, or `package-lock.json` unless asked.

---

## Report lifecycle (simplified)

```
Author (officer/engineer) → Save → REPORTED
Chief (ce/captain)        → Confirm → CONFIRMED (+ schedule / stock rules apply)
HQ (hq)                   → Approve → APPROVED (locked)
Ship ↔ HQ                 → ZIP export/import (sync_status)
```

Stock paths (today):

- **Work Report Save** → `saveWorkReport` → `TVC_SpareMenu.syncConsumeLogFromWorkReport` → `applyConsumeLogStock` (IndexedDB).
- **Confirm** → `TVC_Transaction.confirmReport` deducts only if `!report.stock_applied_at`.

See [`docs/workflow-manual-v1.md`](docs/workflow-manual-v1.md) for Draft / Submitted labels.

---

## E2E reference

[`TEST_REPORT.md`](TEST_REPORT.md) documents a passing Deck→Engine tour:

Login → Menu → PMS → Make Report → Save → SPARE → Consumption → tab switch @ 390×844.

Use it as the **golden path** when validating UI changes.

---

## Cursor ↔ Gemini collaboration

1. **Single source of truth** — Update `docs/UI-MAP.md` when adding modals or renaming flows.
2. **Handoff block** — Paste the template from [`docs/GEMINI-COLLAB.md`](docs/GEMINI-COLLAB.md) into every cross-tool task.
3. **One owner per file** — Avoid both agents editing `js/app.js` and `js/ui/spareMenu.js` in parallel without merging context.
4. **Evidence** — UI tasks need screenshot or `npm run test:e2e` result in PR / summary.

---

## Files often left untouched

- `index.html` — modal shells; change only when adding a new modal id.
- `js/auth.js` — login/session; change only for auth tasks.
- `js/pms.js` — run-hour scheduling helpers, not report forms.
