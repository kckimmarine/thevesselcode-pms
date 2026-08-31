# Data Scope Policy — Company HQ & TVC Admin

**Effective:** 2026-08-31  
**Related:** [`data-retention-policy.md`](data-retention-policy.md)

---

## 1. Requirements

| Account | Must hold data for |
|---------|-------------------|
| **Company HQ** (`account_type: HQ`, `company_id` set) | **All active vessels** registered under that company |
| **TVC Admin** (`account_type: ADMIN`) | **All active companies and vessels** in Admin registry |

“Have data” means: work history, defects, requisitions, PMS/SPARE master scope, sync history, and other operational stores — **not only registry metadata** (company.json / vessel.json).

---

## 2. Current behaviour (gap)

### 2.1 What works today

| Layer | Behaviour |
|-------|-----------|
| **Fleet / Ship List** | Company HQ sees vessels for its `company_id`. TVC Admin sees all registry-active vessels. |
| **IndexedDB on HQ PC** | Records from many vessels can coexist; each row has `vessel_id`. UI filters by **selected vessel**. |
| **Sync** | **Incremental ZIP** (changes only) — small transfers. Import **merges** by id (does not delete other vessels’ rows). |
| **Supabase** | Each online-sync ZIP kept (no auto-delete). |

### 2.2 Gaps vs requirements

| Requirement | Gap |
|-------------|-----|
| HQ has **all** company vessels’ data | Data exists on HQ **only after each vessel’s exports were imported** (or online sync received). No automatic “all vessels full copy”. |
| Admin has **all** companies’ data | **Admin Mode** = registry / Setup / License only — **no central PMS DB**. Admin HQ login uses same IndexedDB as superintendent; completeness = same import dependency. |
| Nothing deleted | Contract sync ZIPs: policy OK. **HQ/Admin PC** can lose data if disk fails unless backed up. |
| Restore missing ship data | Possible in theory (replay ZIPs); **no one-click restore** from Admin/HQ yet. |

---

## 3. Target architecture

```text
                    ┌─────────────────────────────────────┐
                    │  TVC Cloud (Supabase Postgres)       │
                    │  partition: company_id + vessel_id   │
                    │  • all record stores (upsert)        │
                    │  • sync_packages (ZIP archive)       │
                    └──────────────┬──────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │ ingest on push         │ query / restore          │
          ▼                        ▼                          ▼
   [Vessel PCs]              [Company HQ]              [TVC Admin]
   primary + export          all company vessels       all companies
   incremental ZIP           read + reply + restore    audit + restore
```

### 3.1 Company HQ scope

- **Read:** every `vessel_id` where `vessels.company_id = user.company_id` (and license allows).
- **Write:** HQ replies, comments, approvals — scoped to same company.
- **Ingest:** every `SHIP_TO_HQ` package (ZIP or online push) **merges into cloud DB** for that vessel (not only stored as ZIP).
- **Local HQ PC:** cache / offline mirror of cloud (optional); cloud is **authoritative** for HQ completeness.

### 3.2 TVC Admin scope

- **Read:** all companies and vessels in registry (active).
- **Write:** registry, deploy, license — not day-to-day PMS edits on customer data (unless support incident).
- **Ingest:** same cloud DB as HQ; Admin API role bypasses `company_id` filter.
- **Admin Mode UI:** vessel/company picker → view aggregated data, purge on **customer deletion request** only.

### 3.3 Transfer model (unchanged principle)

- **Incremental export** from ship (items 1…100 over time) — avoid one huge ZIP.
- **Cloud + HQ** accumulate full set 1…100 via merge.
- **No delete** until customer request ([`data-retention-policy.md`](data-retention-policy.md) §5).

---

## 4. Implementation phases (recommended)

| Phase | Deliverable |
|-------|-------------|
| **A** | Postgres tables mirroring sync payload stores + RLS by `company_id` |
| **B** | On `ship/push` (online): parse ZIP → upsert cloud DB + keep ZIP in Storage |
| **C** | HQ/Admin REST: `GET /api/sync/cloud/stats`, `GET /api/sync/cloud/records` (+ optional `SYNC_CLOUD_READ_KEY`) |
| **D** | Admin: read-all API + support console (vessel/company filter) |
| **E** | Ship **Restore**: cloud snapshot → `HQ_TO_SHIP` full or staged package |

Until Phase C–E ship, **operational requirement is met only if HQ imports every vessel export** into one HQ installation (or one HQ PC per company with disciplined imports).

**Phase A–B (implemented):** `deploy/supabase-sync-ingest.sql` + server ingest on online push.

| Table | Role |
|-------|------|
| `sync_records` | One row per IndexedDB record (`store_name` + `record_key`), JSONB `payload` |
| `sync_vessel_meta` | Vessel blobs (`run_hours`, `company_comments`) |
| `sync_package_ingest` | Per-ZIP ingest audit (upserted / skipped counts) |

Setup: `npm run setup-supabase-ingest` then `npm run verify-sync-ingest`. Ingest runs automatically in `api/sync/ship/push` and `api/sync/hq/push` after Storage upload.

**Phase C (implemented):** cloud read API + HQ Menu → Export/Import → cloud summary panel.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/sync/cloud/stats` | Record counts by store/vessel, meta keys, recent ingest log |
| `GET /api/sync/cloud/records` | Paginated `sync_records` (`store_name`, `limit`, `offset`, `meta_key`) |

Headers: `X-Tvc-Account-Type` (`HQ` \| `ADMIN`), `X-Tvc-Company-Id` (HQ required), optional `X-Tvc-Cloud-Read-Key` if `SYNC_CLOUD_READ_KEY` is set on Vercel.

Verify: `npm run verify-sync-cloud`

---

## 5. Access matrix (target)

| Data | Vessel PC | Company HQ | TVC Admin |
|------|-----------|------------|-----------|
| Own vessel operational data | Primary | Copy (via sync) | Copy (via cloud) |
| Other vessels same company | — | **All registered** | All |
| Other companies | — | — | **All registered** |
| Registry (contract) | — | Own company | **All** |
| Sync ZIP archive | — | Own company vessels | All |

---

## 6. Contract wording (suggested)

- Customer **primary** records remain on vessel PCs; TVC/HQ cloud holds **synchronized copies** for fleet oversight and recovery.
- TVC maintains cloud copies for **all contracted vessels** under each company account.
- TVC Admin may access **all contracted fleet data** for support, audit, and recovery per customer agreement.
- Deletion only per [`data-retention-policy.md`](data-retention-policy.md).
