# Admin Mode — App Update (offline)

Admin Mode is for **THE VESSEL CODE** only. It packages **application Setup.exe** files for HQ / Vessel. It does **not** export or overwrite PMS Master, SPARE Master, or Work History.

## Run Admin Mode

```bat
npm run electron:admin
```

Login: `tvc` / `0000` (Department 선택 없음)

Or install `TVC-PMS-ADMIN_TVC-…-Setup.exe` (seat license required when packaged).

## Flow (정호 HQ · 동욱 Vessel)

1. TVC: improve app → bump `package.json` version → `npm run dist`
2. Admin Mode → **Package App Update** → attach Setup.exe per SKU → Export ZIP
3. Send ZIP by email / Kakao
4. HQ / Vessel: **Data Export & Import → Import → App Update → Install update**
5. Finish NSIS wizard → reopen app (AppData / Master / History kept)

## Desktop workspace (recommended)

Do **not** copy the full git repo per vessel. Use one source + releases:

```text
Desktop\TVC-Admin Mode\
  README.txt
  source-link.txt          → path to thevesselcode-offline-pms
  releases\
    2.0.1\
      *.Setup.exe
      tvc_app_update_….zip
  companies\
    DAEMYUNG\
      vessels\             → notes / IMO only (optional)
```

## Safety

| Package | Touches Master / History? |
|---------|---------------------------|
| App Update ZIP | No |
| Monthly / Defect / … Sync | Yes (operational) |
| PMS/SPARE Master Excel | Yes (master only) |
