# Electron Pilot packaging

## Dev run

```bash
npm install
npm run license:keys          # once
npm run electron:hq           # HQ_OFFICE
npm run electron:master       # VESSEL_MASTER
npm run electron:engine
npm run electron:deck
```

Browser/dev server (`npm start` / `START-TVC-PMS.bat`) does **not** enforce license.

## Build installers

```bash
npm run dist
```

Outputs in `dist/`:

| File | Target |
|---|---|
| `TVC-PMS-VESSEL_MASTER-2.0.0-Setup.exe` | INCHEON CHEMI Master |
| `TVC-PMS-VESSEL_ENGINE-2.0.0-Setup.exe` | INCHEON CHEMI Engine |
| `TVC-PMS-VESSEL_DECK-2.0.0-Setup.exe` | INCHEON CHEMI Deck |
| `TVC-PMS-HQ_OFFICE-2.0.0-Setup.exe` | Daemyung HQ |

Each installer embeds a signed `license.json` (company `DAEMYUNG`, vessel `INCHEON CHEMI` where applicable). First launch binds the license to that PC.

### One PC, all 4 SKUs

Yes — after rebuild with unique `appId` per SKU, you can install **Master + Engine + Deck + HQ on the same PC**.

| Item | Separation |
|---|---|
| Windows app / uninstall entry | unique `appId` + product name |
| Program Files folder / `.exe` | unique `executableName` |
| App data / IndexedDB / license bind | `%AppData%/tvc-pms-<SKU>/` |

Start Menu will show four shortcuts. Use the matching login mode for each (Master / Engine / Deck / HQ).

## License ops

- Public key: `electron/keys/public.pem` (shipped in app)
- Private key: `electron/keys/private.pem` (**do not distribute**)
- Re-issue: `npm run license:issue`

## Checklists

- [pilot-p0-checklist.md](pilot-p0-checklist.md)
- [pilot-p1-spare-checklist.md](pilot-p1-spare-checklist.md)
