# Mobile UX — Known Issues & Rules

Reference for **≤768px** and **390px** (iPhone-class) layouts.  
Source: [`TEST_REPORT.md`](../TEST_REPORT.md) E2E run + code review.

---

## Breakpoints (css/app.css)

| Width | Behavior |
|-------|----------|
| `>768px` | **Desktop layout** — do not regress unless task explicitly allows |
| `≤768px` | Modal full width, tab drawer, stacked sections |
| `≤480px` | Tighter legend / dept buttons |

Report modals at `≤768px` still use `width: 1000px` min-width in some rules — causes horizontal squeeze. Treat **390px** as the hard audit width.

---

## P0 / P1 issues (product, not test harness)

### 1. Mobile drawer blocks header actions

- `#mobileNavBackdrop` covers **End** (logout).
- Hamburger (`#mobileNavBtn`) sits under open `#tabBar` drawer — cannot close via hamburger.
- **Workaround in E2E:** `TVC_App.handleLogout()`.

**Intended fix direction:** Header `z-index` above drawer; End/logout always clickable; hamburger toggles close.

### 2. PMS split view on narrow screens

- `.tree-panel` + `.plan-main` stay side-by-side → job sheet off-screen.
- **Intended fix:** Stack tree accordion above job list; sticky **Make Report**.

### 3. Header text overflow

- Ship name + IMO + Delivery + User + dept + End on one row → `IM… · Vessel Mode`.

**Intended fix:** Two-row header or identity popover on mobile.

### 4. Deck SPARE empty state

- Deck `officer` may see **0 / 1335** with no parts listed while Engine sees inventory.
- Clarify dept filter vs loading state vs permission messaging.

---

## Work Report modal @ mobile

- Box: `#workReportModal .modal-box.wr-modal` — tall (`min(92vh, 920px)`).
- Page 2 spare list is heavy for 390px — **inline spare on Page 1** is the planned mitigation (see collaboration backlog).
- Footer `.wr-actions` wraps buttons — keep **max 2 primary actions** on new flows.

---

## CSS change policy

| OK on mobile only | Avoid on desktop (`>768px`) |
|-------------------|-----------------------------|
| New `@media (max-width: 768px)` rules | Changing `.wr-modal` width |
| `.wr-station-compact` utility classes | Grid column count on default `.wr-maint-grid-4` |
| Hide secondary fields with `.wr-mobile-hidden` | Removing fields from desktop form |

Pattern:

```css
@media (max-width: 768px) {
  .wr-station-compact-only { display: block; }
  .wr-desktop-detail { display: none; }
}
@media (min-width: 769px) {
  .wr-station-compact-only { display: none; }
}
```

---

## E2E screenshots (baseline)

| File | Scene |
|------|-------|
| `e2e/artifacts/screenshots/mobile-390-menu.png` | Menu @ 390px |
| `e2e/artifacts/screenshots/mobile-390-pms.png` | PMS split issue |
| `e2e/artifacts/screenshots/mobile-390-nav-open.png` | Drawer open |
| `e2e/artifacts/screenshots/logout-stuck-on-app.png` | End blocked |

Compare before/after when changing mobile CSS.

---

## Manual test checklist (390×844)

1. Login `engineer` / `0000` / Engine  
2. Open hamburger → switch tabs → close drawer  
3. PMS → select job → Make Report → scroll Page 1 → Save  
4. SPARE → Consumption → qty 1 → Save  
5. Tap **End** — must logout without JS fallback  

Repeat with `officer` / Deck for dept-specific cases.
