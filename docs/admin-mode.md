# Admin Mode — App Update (offline)

Admin Mode is for **THE VESSEL CODE** only. It packages **application Setup.exe** files for HQ / Vessel. It does **not** export or overwrite PMS Master, SPARE Master, or Work History.

**Operational SOP (계약 → Registry → Setup → License → Master):** [`docs/admin-mode-sop.md`](admin-mode-sop.md)  
**Company / Vessel ID 규칙 · Pilot → 출시:** [`docs/admin-registry-id-guide.md`](admin-registry-id-guide.md)

**Contract print · deploy version tracking:** registry `deploy` block · **Print contract draft** / **Print contract registry** in Admin menu.

## Run Admin Mode

```bat
npm run electron:admin
```

Login: `tvc` / `0000` (Department 선택 없음)

Or install `TVC-PMS-ADMIN_TVC-…-Setup.exe` — **Admin Mode does not require a seat license** (TVC internal use only).

Home screen: contract **company / vessel list** (search + select) + **Contract SOP checklist** + registry / Setup / license / App Update.  
Operational checklist: [`docs/admin-mode-sop.md`](admin-mode-sop.md) · 1-page: [`docs/admin-mode-sop-1page.md`](admin-mode-sop-1page.md)
Source of truth: `admin/registry.json` (editable in Admin UI or JSON under `admin/companies/…`).

## Issue seat license (no CLI)

1. Crew installs **universal** Setup → **Export machine request…** → sends JSON to TVC.
2. Admin → **Issue seat license** → load request → select **company** (+ **vessel** for vessel SKUs) → save `license.json`.
3. Crew **Import seat license…**

## Export Setup handoff (universal HQ + Vessel)

1. Dev PC: `npm run dist` (builds universal Setup.exe × 4 under `dist/`).
2. Admin → **Export Setup handoff** → company select → confirms `dist/` folder → **Export Setup ZIP**.
3. ZIP contains `setups/*.exe` + manifest + README. Same Setup works for any vessel — **seat license** binds company/vessel.

**Signing key:** Dev uses `electron/keys/private.pem`. Packaged Admin: **Select signing key** once.

## Deploy to many companies (e.g. 20 HQ · 100 vessels)

1. Improve once in this repo (`electron:hq` / `engine` / `deck` / `master`).
2. Bump version → `npm run dist`.
3. Admin → Package App Update ZIP (attach Setup.exe for HQ + vessel SKUs).
4. Email **one ZIP per company HQ** (20 emails if 20 companies).  
   Company HQ forwards / installs to their vessels (or you send vessel SKUs inside the same ZIP).
5. Each PC: Import → App Update → Install (Master/History untouched).

Same app binary line; seat license still binds company/vessel/PC.

## Flow (정호 HQ · 동욱 Vessel)

1. TVC: improve app → bump `package.json` version → `npm run dist`
2. Admin Mode → **Package App Update** → attach Setup.exe per SKU → Export ZIP
3. Send ZIP by email / Kakao
4. HQ / Vessel: **Data Export & Import → Import → App Update → Install update**
5. Finish NSIS wizard → reopen app (AppData / Master / History kept)

## Workspace (inside this repo)

Do **not** copy the full git repo per vessel. Use the single repo root:

```text
thevesselcode-pms\
  admin\
    README.md
    companies\
      DAEMYUNG\
        company.json
        vessels\<VESSEL_ID>\vessel.json
    releases\<version>\     → Setup / App Update ZIP archive (optional)
```

Former desktop folder `TVC-Admin Mode` is absorbed into `admin\`.

## Safety

| Package | Touches Master / History? |
|---------|---------------------------|
| App Update ZIP | No |
| Monthly / Defect / … Sync | Yes (operational) |
| PMS/SPARE Master Excel | Yes (master only) |
