# Data Retention Policy — THE VESSEL CODE PMS

**Effective:** 2026-08-31  
**Applies to:** Contracted companies and vessels registered in Admin registry.

---

## 1. Principle

> **Contract vessel data is retained until the customer requests deletion in writing.**

TVC does **not** auto-delete contracted customer sync packages by age, TTL, or storage quota cleanup.

---

## 2. Where data lives

| Tier | Location | What | Retention owner |
|------|----------|------|-----------------|
| **A — Primary operations** | Customer PCs (Electron AppData / IndexedDB) | PMS, SPARE, Work History, Defect, Requisition, etc. | **Customer** (source of record on board / HQ PC) |
| **B — Online sync relay** | Supabase (`tvc-sync-packages` Storage + `sync_packages` table) | Master↔HQ **transfer ZIPs** and metadata | **TVC cloud** — retained until customer deletion request |
| **C — Product & registry** | GitHub + `admin/` | App source, company/vessel contract registry | TVC |

**Important:** Tier **A** is not automatically backed up to TVC cloud. Customers should keep periodic **Export ZIP** copies (or HQ central backup). Tier **B** retains every uploaded online-sync ZIP unless explicitly purged per §5.

---

## 3. Tier B — Online sync (Supabase)

### 3.1 No automatic deletion

- Upload path includes a timestamp; **older packages are never removed** by the sync API.
- Pull (download) **does not delete** Storage objects.
- After a successful pull, status may change to `IMPORTED` for queue semantics only; **the ZIP file remains**.
- Do **not** configure Supabase Storage lifecycle / TTL rules on `tvc-sync-packages` for contracted data.

### 3.2 Status values (`sync_packages.status`)

| Status | Meaning | File deleted? |
|--------|---------|---------------|
| `READY` | Available for pull | No |
| `IMPORTED` | Pulled at least once | No |
| `ARCHIVED` | Manual / operational label | No |

### 3.3 Billing note

Storage grows with each online sync upload. Supabase charges **monthly** based on **current stored GB** (plan included quota + overage). Permanent retention is compatible with this architecture; budget for **Pro plan + Storage** as the fleet grows.

---

## 4. Tier A — Vessel / HQ PCs

- TVC provides Export/Import ZIP and optional online sync; **TVC does not host a full copy** of Tier A unless agreed separately.
- Contract should state that **primary records remain on customer-installed PCs** and that TVC’s cloud retention (Tier B) covers **sync transfer packages only**.
- Recommend: HQ periodic Export archive; Master monthly export when on FBB-only links.

---

## 5. Customer deletion request

When a customer requests deletion (contract end + written request, or explicit GDPR / data erasure scope):

### 5.1 Tier B — TVC executes

1. Confirm `company_id` and/or `vessel_id` with customer.
2. Run purge (dry-run first):

   ```bash
   npm run purge-vessel-sync -- --vessel "TVC No1" --company TVC --dry-run
   npm run purge-vessel-sync -- --vessel "TVC No1" --company TVC --reason "Customer request 2026-…" --by "TVC Admin"
   ```

   Or production API (requires `ADMIN_DATA_PURGE_KEY` on Vercel):

   ```http
   POST /api/admin/purge-vessel-sync
   Authorization: Bearer <ADMIN_DATA_PURGE_KEY>
   Content-Type: application/json

   { "company_id": "TVC", "vessel_id": "TVC No1", "dry_run": true, "reason": "…", "requested_by": "…" }
   ```

3. Action removes:
   - All objects under `tvc-sync-packages/{company}/{vessel}/…`
   - All `sync_packages` rows for that vessel
   - Writes one row to `data_retention_purge_log` (audit)

4. Does **not** delete Tier A on customer PCs (customer or remote support).

### 5.2 Registry

- Set company/vessel **inactive** in Admin; do not delete registry JSON until legal/accounting sign-off.

---

## 6. Pilot / internal test data

- Non-contract pilot vessels may be purged without customer process.
- `TVC_DataPurge` in the app targets **legacy dev IDs only**, not contracted vessel sync Storage.

---

## 7. Related docs

- [`admin/README.md`](../admin/README.md)
- [`admin-registry-id-guide.md`](admin-registry-id-guide.md)
- [`deploy/SETUP-ONLINE-SYNC.ps1`](../deploy/SETUP-ONLINE-SYNC.ps1)
