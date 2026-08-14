# Admin Mode — App Update (offline)

Admin Mode is for **THE VESSEL CODE** only. It packages **application Setup.exe** files for HQ / Vessel. It does **not** export or overwrite PMS Master, SPARE Master, or Work History.

## Run Admin Mode

```bat
npm run electron:admin
```

Login: `tvc` / `0000` (Department 선택 없음)

Or install `TVC-PMS-ADMIN_TVC-…-Setup.exe` (seat license required when packaged).

Home screen: contract **company / vessel list** (search + select) + **Add/edit registry** + **App Update** entry.  
Source of truth: `admin/registry.json` (editable in Admin UI or JSON under `admin/companies/…`).

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
