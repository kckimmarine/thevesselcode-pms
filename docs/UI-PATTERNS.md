# TVC-PMS UI Patterns

Reusable UI conventions in this codebase. Follow these when adding or refactoring screens.

---

## 1. Global namespaces

| Global | File | Responsibility |
|--------|------|----------------|
| `TVC_App` | `js/app.js` | Shell, PMS tab, Work Report, History, menu |
| `TVC_SpareMenu` | `js/ui/spareMenu.js` | SPARE tab, consumption, WR Page 2 spare |
| `TVC_DefectReport` | `js/ui/defectReport.js` | Defect modal |
| `TVC_WorkPermitReport` | `js/ui/workPermit.js` | Work permit modal |
| `TVC_Dialog` | `js/ui/dialog.js` | Confirm / alert overlays |
| `TVC_RBAC` | `js/rbac.js` | Permissions, status normalization |
| `TVC_Transaction` | `js/services/transaction.js` | Report CRUD, confirm, schedules |
| `TVC_WorkReport` | `js/core/schema.js` | Report record shape, `fromLegacy` |

State lives in `TVC_App`’s internal `state` object; spare modules use `getState()` helpers.

---

## 2. Modal pattern

1. **Shell** in `index.html`: `#fooModal` > `.modal-box` > `#fooBody` + `.modal-x`
2. **Show:** `showModal('fooModal')` or module-specific `openFoo()`
3. **Render:** set `innerHTML` on body host, then `TVC_PWA.initDateInputFormat(host)`
4. **Close:** `closeModal('fooModal')` + reset module flags on `state`

Report modals use **1000×920px** box class `.wr-modal.spare-req-work-modal` on desktop.

---

## 3. Work Report form fields (`data-wf`)

Maintenance / postpone forms bind inputs with `data-wf="fieldKey"`:

```html
<input data-wf="workDate" value="2026-09-04">
<textarea data-wf="outline"></textarea>
<input type="checkbox" data-wf="shoreSupport">
```

Capture:

```javascript
captureWorkReportForm();  // → state._wrForm
const v = wf('outline');  // read helper
```

Default keys: `defaultWrForm()` in `js/app.js`.  
Schema-only (not all rendered yet): `troubleDefect`, `troubleParts`, `troubleOutline`, `presumedCause`, `countermeasures`, `meStop`, `delayHours`.

---

## 4. `.wr-maint-*` layout system

| Class | Use |
|-------|-----|
| `.wr-maint-form` | Vertical stack of cards |
| `.wr-maint-card` | White card, `padding: 12px 14px` |
| `.wr-maint-body` | Main fields inside card |
| `.wr-maint-grid` + `-2/3/4` | Responsive field grid |
| `.wr-maint-field` | Label + control |
| `.wr-maint-span-all` | Full-width grid row |
| `.wr-maint-textarea` | Multi-line text |
| `.wr-maint-chk` | Checkbox row |
| `.wr-actions` | Modal footer button bar |

Tone backgrounds: `.wr-page.tone-repair`, `.tone-postpone`, `.tone-defect`.

---

## 5. Spare list (virtual scroll)

Used in SPARE tab, Consumption editor, Work Report Page 2:

- Head: `#wrSpareListHead` / `#spareListHead` (synced column widths)
- Body: `#wrSpareListScroll` with `TVC_VirtualList`
- Row context: `data-spare-id` on `<tr>`
- Qty input class: `.spare-consume-qty-input`
- Checkbox column for select-all patterns

Page 2 init: `TVC_SpareMenu.initWrSparePage2(ro)` — sets `modState(st).wrSpareOpen = true`.

Persist before save: `TVC_SpareMenu.persistWrSpareUsedParts()`.

---

## 6. Job row picker (PMS group → JOB CODE)

Shared between Work Report, Consumption, Defect:

- `.spare-consume-pick-trigger` opens portal menu
- `.spare-consume-pick-menu-portal` appended to `document.body`
- Cleanup: `cleanupOrphanPickMenus()` on modal close

Functions: `toggleWrJobRowPick`, `pickWrJobForRow`, `renderWrJobRowsBlock`.

---

## 7. Attachments

`TVC_Attachments.renderListItemHtml` + `renderWrAttachmentBlock('ship'|'company')`  
Stored in `state._wrForm.shipAttachments` / `companyAttachments` as `{ id, name, dataUrl, ... }`.

---

## 8. Stock / consumption integration

```
saveWorkReport()
  → usedParts from state._wrUsedParts
  → TVC_SpareMenu.syncConsumeLogFromWorkReport({ report, job, usedParts, user })
      → persistConsumeLogFromDraft
      → applyConsumeLogStock (recordConsumption or applyConsumptionDiff)
      → TVC_Inventory.currentStock(spare) updated in IndexedDB
```

Idempotency: `stock_applied_at` on report and consume log; `prevLog` diff on edit.

**Do not** decrement stock with ad-hoc `localStorage` writes.

---

## 9. Inline `onclick` handlers

The app uses explicit `onclick="TVC_App.foo()"` / `TVC_SpareMenu.bar()` in generated HTML — not a component framework. New UI should match this style unless migrating a whole module.

---

## 10. Search + clear button

```html
<div class="search-field-wrap">
  <input class="search-input" id="wrSpareSearch" oninput="...">
  <button class="search-clear-btn" onclick="TVC_App.clearSearchField('wrSpareSearch')">×</button>
</div>
```

Call `TVC_App.ensureSearchClearUi()` after dynamic render if needed.

---

## 11. Print / preview

Work Report: `TVC_App.printWorkReport()` / `previewWorkReport()`  
Uses `TVC_SpareMenu.renderWrPrintShell` + separate print window HTML.

Print layouts reuse `.wr-maint-*` with `forPrint: true` (readonly, no pickers).

---

## 12. Testing hooks

- E2E: `e2e/helpers/app.js` — login, open tabs, click by role/text
- Screenshots: `e2e/artifacts/screenshots/`
- Mobile audit: `e2e/mobile-ui.spec.js` @ 390×844

When adding a `data-testid`, prefer stable ids on primary actions (`planReportBtn` already exists).
