# THE VESSEL CODE (TVC-PMS) v2

Unified **PMS + SPICS** system rebuilt from `PMS-ENGINE.xlsx` + `PMS-DECK.xlsx`.  
Offline-first — 선박·본사 간 데이터 교환은 **부서별 ZIP Export/Import** 로만 수행합니다.

## Quick Start

**`START-TVC-PMS.bat`** 더블클릭 → 브라우저가 `http://localhost:3000` 으로 자동 열립니다.

```bash
npm start            # 또는 터미널에서 직접 실행
```

### ⚠️ index.html 더블클릭 금지

| 열기 방법 | 주소 | 데이터 |
|-----------|------|--------|
| `START-TVC-PMS.bat` / `npm start` | `http://localhost:3000` | ✅ PMS + SPARE Import 정상 |
| `index.html` 더블클릭 | `file:///C:/...` | ❌ **별도 저장소** · 비어 보임 · Import 차단 |

`localhost`와 `file://`은 브라우저가 **완전히 다른 앱**으로 취급합니다.

## Demo Login

Password **`0000`** (모든 데모 계정 공통)

| Username | Department | Role | Export/Import |
|----------|------------|------|---------------|
| `officer` | Deck | Deck Officer | ❌ |
| `captain` | Deck | Captain | ✅ |
| `engineer` | Engine | Engineer | ❌ |
| `ce` | Engine | Chief Engineer | ✅ |
| `hq` | — | HQ Supervisor | ✅ (선박·부서 선택 후) |

데모 선박 ID: **`INCHEON CHEMI`** (표시 이름 · Sync ID 동일)

## SPARE 재고 Import (ENGINE)

1. `npm start` → http://localhost:3000
2. `ce` / `0000` / **Engine** 로그인
3. **SPARE** 탭 → **Import XLS (ENGINE)** 클릭
4. 약 **1,346건** 부품 적재 (`data/spare-inventory.xls`)

Chief engineer(`ce`)만 SPARE Append/Modify/Delete 및 재고 Import 가능.

## Sync (ZIP Export / Import)

- **부서 분리**: DECK / ENGINE 각각 별도 ZIP
- **파일명**: `<VESSEL_ID>_<DEPT>_PMS_EXPORT_YYYYMMDD.zip`  
  예) `INCHEON CHEMI_ENGINE_PMS_EXPORT_20260703.zip`
- **선박 ID 검증 (Phase 0)**: Import 시 ZIP의 `export_meta.vessel_id` 가  
  - 선박 PC: IndexedDB `VESSEL_ID` 또는 로그인 계정의 `vessel_id`  
  - HQ: Fleet에서 선택한 선박  
  와 일치하지 않으면 **Import 중단** (타 선박 데이터 오염 방지)
- **부서 검증**: ZIP 부서 ≠ 선택 부서 → Import 중단

### Workflow

```
Officer → Report (PENDING)
Chief/Captain → Approve (APPROVED) + Spare auto deduct
HQ → Confirm (CONFIRMED) + lock
Ship ↔ HQ → ZIP Export / Import (delta, sync_status !== SYNCED)
```

## Verify Scripts

```bash
npm run verify-rbac          # RBAC & 부서 필터링
npm run verify-sync-vessel   # Import vessel_id 검증 로직
npm run verify-all           # 위 두 스크립트 일괄 실행
npm run import-xlsx          # Excel → data/pms-unified.json 재생성
```

## Pilot (대명해운)

시범 운영 체크리스트: [`docs/PILOT_CHECKLIST.md`](docs/PILOT_CHECKLIST.md)

## Architecture

| Layer | Path |
|-------|------|
| UI | `index.html`, `css/app.css`, `js/app.js` |
| IndexedDB | `js/core/db.js`, `js/core/schema.js` |
| PMS+SPICS Transaction | `js/services/transaction.js` |
| ZIP Sync (delta) | `js/services/sync.js` + JSZip (`vendor/`) |
| RBAC | `js/rbac.js`, `js/auth.js` |
| Excel seed | `scripts/import-pms-xlsx.py` → `data/pms-unified.json` |
| Spare inventory | `data/spare-inventory.xls` |

## Vendor Libraries (offline)

`index.html` 은 CDN 대신 **`vendor/`** 로컬 스크립트를 사용합니다.

```bash
npm install                  # jszip, exceljs, xlsx 포함
npm run vendor-sync          # node_modules → vendor/ 복사
```

## Excel Mapping

| Excel | DB Field |
|-------|----------|
| JOB CODE | `job_code` |
| PERIOD | `period` |
| UNIT | `unit` (H/M/D/W/C) |
| NEXT DATE (OVERDUE) | `next_date`, `is_overdue` |
| LASTDONE / LAST DONE | `last_done` |
| GROUP / SORT / ITEM | `ship_components` tree |

**834 jobs** (701 ENGINE + 133 DECK), **1218 component nodes**

## Dashboard

- Equipment **Tree View** (left)
- **Overdue filter** default tab + KPI cards
- JOB CODE column sorting
