# THE VESSEL CODE — Database & RBAC Architecture

> Based on `TVC_DESIGN_SPEC.txt` — Unified PMS + SPICS, Offline-First, RBAC

## Stack

| Layer | Path | Description |
|-------|------|-------------|
| Schema | `database/schema.sql` | SQLite DDL (WAL mode) |
| Models | `src/models/*.js` | Ship_Components, Maintenance_Jobs, Spare_Parts, Daily_Work_Reports |
| RBAC | `src/auth/rbac.js` | 선박용/회사용 권한 분리 |
| Workflow | `src/services/WorkflowService.js` | 결재 + 재고 차감 + 동기화 |
| Demo | `scripts/demo-rbac.js` | 전체 워크플로우 검증 |

**Runtime:** Node.js 22+ (`node:sqlite` built-in, native build 불필요)

## Entity Relationship

```
Users (SHIP | HQ)
  │
Ship_Components (tree: parent_id)
  └──< Maintenance_Jobs (job_code, period, unit, pic)
         └──< Daily_Work_Reports (work_type, status)
                └──< Daily_Work_Report_Parts ──> Spare_Parts
Company_Comments ──> Maintenance_Jobs / Reports
```

## RBAC — 선박용 vs 회사용

| Role | Account | 주요 권한 |
|------|---------|-----------|
| `SHIP_OFFICER` (사관) | SHIP | 일일 리포트 작성(PENDING), 가동시간 입력, Export |
| `SHIP_CHIEF` (선기장) | SHIP | 리포트 승인(APPROVED), **SPICS 재고 자동 차감**, 재고 수정 |
| `HQ_SUPERVISOR` (본사) | HQ | Import, 기술 코멘트, **Confirm(CONFIRMED + Lock)** |

### 결재 상태 전이

```
PENDING ──(선기장)──> APPROVED ──(본사)──> CONFIRMED (is_locked=1)
    │                      │
    └──── POSTPONED ───────┘
```

## Demo Accounts (password: `tvc1234`)

| Username | Role |
|----------|------|
| `officer@dm01` | SHIP_OFFICER |
| `chief@dm01` | SHIP_CHIEF |
| `hq@thevessel` | HQ_SUPERVISOR |

## Run

```bash
npm run demo
```

## API Usage (Node)

```javascript
const { User, RBAC, Action, WorkflowService } = require('./src');

const user = User.authenticate('chief@dm01', 'tvc1234');
RBAC.assert(user, Action.APPROVE_DAILY_REPORT);

WorkflowService.approveReport(user, reportId);
```

## Export JSON Format (Spec §4)

```json
{
  "export_meta": { "vessel_id": "TEST_V01", "export_date": "2026-07-01" },
  "daily_reports": [{ "job_code": "01-004", "status": "APPROVED", "used_parts": [] }],
  "company_comments": [{ "job_code": "01-004", "comment": "..." }]
}
```

## Offline Sync Fields (all core tables)

- `sync_status`: LOCAL → PENDING_SYNC → SYNCED
- `sync_version`: optimistic locking
- `is_deleted`: soft delete tombstone
