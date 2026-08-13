# Seat license (1 PC / vessel install)

Packaged TVC-PMS setups do **not** include a runnable `license.json`. After install, the app opens the activation gate until HQ issues a **seat license** bound to that PC’s machine ID.

## Flow (INCHEON CHEMI / vessel PC)

1. Install the correct SKU Setup on the **designated ship PC only** (do not redistribute Setup).
2. On first launch, activation screen shows **Machine ID**.
3. Crew: **Export machine request…** (or copy Machine ID) → send to HQ by email / Kakao.
4. Shore (private key on HQ build PC only):

```bash
npm run license:keys   # once, keep private.pem offline
node scripts/issue-license.mjs --request path\to\machine-request.json --out license.json --months 12
# or:
node scripts/issue-license.mjs --sku VESSEL_ENGINE --machine <32-char-id> --out license.json --months 12
```

5. Ship: **Import seat license…** → select `license.json` → app reloads.

## Rules

| Item | Behavior |
|------|----------|
| Setup.exe on another PC | Installs, but needs a **new** seat license for that PC |
| Copy AppData / bound license | Blocked (`LICENSE_MACHINE`) |
| Unbound license in package | Not shipped; packaged apps reject unbound |
| Local `npm run electron:*` | Still uses unbound seed + auto-bind for dev |

## SKU stamp

Installers embed `resources/sku.json` (identity only). Seat `license.json` must match that SKU.

## Tester handoff

- Same build version for HQ + vessel PCs.
- Vessel Mode: one designated PC; seat license issued once for that machine.
- Do not share Setup + seat license as a portable kit for other PCs.
