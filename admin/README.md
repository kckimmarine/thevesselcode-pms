# TVC Admin workspace (inside product repo)

THE VESSEL CODE oversees all contracted companies and vessels from this tree.
Do **not** clone `thevesselcode-pms` per vessel.

```text
admin/
  companies/
    <COMPANY_ID>/
      company.json          # company registry
      vessels/
        <VESSEL_ID>/
          vessel.json       # vessel registry (id, IMO, delivery…)
  releases/
    <version>/              # Setup.exe + App Update ZIP (optional local archive)
```

## Roles

| Who | Where data lives |
|-----|------------------|
| TVC (here) | Contract registry under `admin/companies/…` + built releases |
| Company HQ Mode | That company's vessels only (app AppData / Fleet) |
| Vessel Mode | That vessel only (app AppData) |

## Daily

1. Edit product source at repo root (`js/`, `electron/`, …).
2. `npm run electron:admin` → login `tvc` / `0000` for App Update packaging.
3. `npm run dist` → copy Setup / update ZIP into `admin/releases/<version>/` if you want a local archive.
4. Add/edit companies and vessels in Admin UI (**Add / edit company / vessel**), or edit JSON under `admin/companies/…` if you prefer.

**Pilot reference** (`admin/registry-reference.json`): TVC — Company Code `1`, HQ ID `tvc`, Password `tvc1234`; TVC No1 — Code `1`, IMO `9999999`.

**Data retention:** [`docs/data-retention-policy.md`](../docs/data-retention-policy.md) — online sync ZIPs kept until customer deletion request; purge via `npm run purge-vessel-sync`.

See also: `docs/admin-mode-sop.md`, `docs/admin-registry-id-guide.md`, `docs/tvc-internal-qa.md` (출시 후 Lab·App Update), `docs/admin-mode.md`, `docs/seat-license.md`.
