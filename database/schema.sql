-- =============================================================================
-- THE VESSEL CODE (TVC-PMS) — Unified PMS + SPICS Schema
-- Spec: TVC_DESIGN_SPEC — Offline-First, RBAC, Ship↔HQ Sync
-- Target: SQLite (WAL mode)
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ---------------------------------------------------------------------------
-- Users — 선박용(SHIP) / 회사용(HQ) 계정 분리
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Users (
    id              TEXT PRIMARY KEY NOT NULL,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL,

    account_type    TEXT NOT NULL CHECK (account_type IN ('SHIP', 'HQ')),
    role            TEXT NOT NULL CHECK (role IN (
                        'SHIP_OFFICER',     -- 사관: 일일 리포트 작성
                        'SHIP_CHIEF',       -- 선기장: 승인 + 재고 차감
                        'HQ_SUPERVISOR'     -- 본사 공무감독: Confirm + 락
                    )),

    vessel_id       TEXT,               -- SHIP 계정만 필수
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),

    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (
        (account_type = 'SHIP' AND vessel_id IS NOT NULL)
        OR (account_type = 'HQ' AND role = 'HQ_SUPERVISOR')
    ),
    CHECK (
        (account_type = 'SHIP' AND role IN ('SHIP_OFFICER', 'SHIP_CHIEF'))
        OR (account_type = 'HQ' AND role = 'HQ_SUPERVISOR')
    )
);

CREATE INDEX IF NOT EXISTS idx_users_account_type ON Users (account_type, role);

-- ---------------------------------------------------------------------------
-- Ship_Components — 장비 트리 (parent_id 자기참조)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Ship_Components (
    id                  TEXT PRIMARY KEY NOT NULL,
    parent_id           TEXT REFERENCES Ship_Components(id) ON UPDATE CASCADE ON DELETE RESTRICT,

    machinery_name      TEXT NOT NULL,
    component_name      TEXT NOT NULL,
    component_code      TEXT,
    node_type           TEXT NOT NULL DEFAULT 'COMPONENT'
                            CHECK (node_type IN ('MACHINERY', 'COMPONENT', 'SUB_COMPONENT')),

    total_running_hours INTEGER NOT NULL DEFAULT 0 CHECK (total_running_hours >= 0),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    remarks             TEXT,

    sync_status         TEXT NOT NULL DEFAULT 'LOCAL'
                            CHECK (sync_status IN ('LOCAL', 'PENDING_SYNC', 'SYNCED', 'CONFLICT')),
    sync_version        INTEGER NOT NULL DEFAULT 1,
    is_deleted          INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),

    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at      TEXT,

    UNIQUE (machinery_name, component_name, component_code)
);

CREATE INDEX IF NOT EXISTS idx_ship_components_parent ON Ship_Components (parent_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_ship_components_machinery ON Ship_Components (machinery_name) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_ship_components_sync ON Ship_Components (sync_status, updated_at) WHERE is_deleted = 0;

-- ---------------------------------------------------------------------------
-- Spare_Parts — SPICS 재고
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Spare_Parts (
    id                  TEXT PRIMARY KEY NOT NULL,
    part_no             TEXT NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    qty_on_hand         INTEGER NOT NULL DEFAULT 0,
    min_qty             INTEGER NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
    unit                TEXT NOT NULL DEFAULT 'EA',
    storage_location    TEXT,

    sync_status         TEXT NOT NULL DEFAULT 'LOCAL'
                            CHECK (sync_status IN ('LOCAL', 'PENDING_SYNC', 'SYNCED', 'CONFLICT')),
    sync_version        INTEGER NOT NULL DEFAULT 1,
    is_deleted          INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),

    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at      TEXT,

    UNIQUE (part_no)
);

CREATE INDEX IF NOT EXISTS idx_spare_parts_sync ON Spare_Parts (sync_status, updated_at) WHERE is_deleted = 0;

-- ---------------------------------------------------------------------------
-- Maintenance_Jobs — 예방 정비 마스터 (JOB CODE, PERIOD, UNIT, P.I.C)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Maintenance_Jobs (
    id                  TEXT PRIMARY KEY NOT NULL,
    ship_component_id   TEXT NOT NULL
                            REFERENCES Ship_Components(id) ON UPDATE CASCADE ON DELETE RESTRICT,

    job_code            TEXT NOT NULL,
    description         TEXT NOT NULL,
    period              REAL NOT NULL CHECK (period > 0),
    unit                TEXT NOT NULL CHECK (unit IN ('H', 'M', 'D', 'C', 'W', 'Y')),
    pic                 TEXT NOT NULL,

    last_done_hours     INTEGER,
    last_done_at        TEXT,
    next_due_hours      INTEGER,
    next_due_at         TEXT,

    plan_status         TEXT NOT NULL DEFAULT 'PLANNED'
                            CHECK (plan_status IN ('PLANNED', 'DUE_SOON', 'OVERDUE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),

    spare_part_id       TEXT REFERENCES Spare_Parts(id) ON UPDATE CASCADE ON DELETE SET NULL,
    spare_use_qty       INTEGER NOT NULL DEFAULT 0 CHECK (spare_use_qty >= 0),

    is_locked           INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),

    sync_status         TEXT NOT NULL DEFAULT 'LOCAL'
                            CHECK (sync_status IN ('LOCAL', 'PENDING_SYNC', 'SYNCED', 'CONFLICT')),
    sync_version        INTEGER NOT NULL DEFAULT 1,
    is_deleted          INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),

    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at      TEXT,

    UNIQUE (ship_component_id, job_code)
);

CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_component ON Maintenance_Jobs (ship_component_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_job_code ON Maintenance_Jobs (job_code) WHERE is_deleted = 0;

-- ---------------------------------------------------------------------------
-- Daily_Work_Reports — 일일 정비/트러블 실적 (결재 워크플로우 핵심)
-- status: PENDING → APPROVED → CONFIRMED | POSTPONED
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Daily_Work_Reports (
    id                  TEXT PRIMARY KEY NOT NULL,
    maintenance_job_id  TEXT REFERENCES Maintenance_Jobs(id) ON UPDATE CASCADE ON DELETE SET NULL,
    job_code            TEXT NOT NULL,

    work_type           TEXT NOT NULL CHECK (work_type IN ('MAINTENANCE', 'TROUBLE', 'POSTPONE')),
    status              TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'APPROVED', 'CONFIRMED', 'POSTPONED')),

    report_date         TEXT NOT NULL,
    description         TEXT NOT NULL,
    trouble_detail      TEXT,
    postpone_reason     TEXT,

    reported_by         TEXT NOT NULL REFERENCES Users(id),
    approved_by         TEXT REFERENCES Users(id),
    confirmed_by        TEXT REFERENCES Users(id),

    approved_at         TEXT,
    confirmed_at        TEXT,
    is_locked           INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),

    company_comment     TEXT,

    sync_status         TEXT NOT NULL DEFAULT 'LOCAL'
                            CHECK (sync_status IN ('LOCAL', 'PENDING_SYNC', 'SYNCED', 'CONFLICT')),
    sync_version        INTEGER NOT NULL DEFAULT 1,
    is_deleted          INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),

    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_status ON Daily_Work_Reports (status, report_date) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_daily_reports_job_code ON Daily_Work_Reports (job_code) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_daily_reports_sync ON Daily_Work_Reports (sync_status, updated_at) WHERE is_deleted = 0;

-- ---------------------------------------------------------------------------
-- Daily_Work_Report_Parts — 정비 시 사용 부품 (APPROVED 시 재고 차감)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Daily_Work_Report_Parts (
    id              TEXT PRIMARY KEY NOT NULL,
    report_id       TEXT NOT NULL REFERENCES Daily_Work_Reports(id) ON UPDATE CASCADE ON DELETE CASCADE,
    spare_part_id   TEXT NOT NULL REFERENCES Spare_Parts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    qty_used        INTEGER NOT NULL CHECK (qty_used > 0),
    deducted        INTEGER NOT NULL DEFAULT 0 CHECK (deducted IN (0, 1)),

    UNIQUE (report_id, spare_part_id)
);

-- ---------------------------------------------------------------------------
-- Company_Comments — 본사 기술 코멘트 (Export/Import JSON company_comments)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Company_Comments (
    id              TEXT PRIMARY KEY NOT NULL,
    job_code        TEXT NOT NULL,
    report_id       TEXT REFERENCES Daily_Work_Reports(id) ON UPDATE CASCADE ON DELETE SET NULL,
    comment         TEXT NOT NULL,
    author_id       TEXT NOT NULL REFERENCES Users(id),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),

    sync_status     TEXT NOT NULL DEFAULT 'LOCAL'
                        CHECK (sync_status IN ('LOCAL', 'PENDING_SYNC', 'SYNCED', 'CONFLICT'))
);

-- ---------------------------------------------------------------------------
-- Sync_Export_Log — 월간 Export/Import 이력
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS Sync_Export_Log (
    id              TEXT PRIMARY KEY NOT NULL,
    vessel_id       TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('SHIP_TO_HQ', 'HQ_TO_SHIP')),
    export_date     TEXT NOT NULL,
    payload_hash    TEXT,
    record_count    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_pms_schedule AS
SELECT
    mj.id, mj.job_code, sc.machinery_name, sc.component_name,
    mj.description, mj.period, mj.unit, mj.pic,
    mj.last_done_hours, sc.total_running_hours AS current_running_hours,
    mj.next_due_hours, mj.plan_status, mj.is_locked, mj.sync_status,
    CASE WHEN mj.unit = 'H' AND mj.next_due_hours IS NOT NULL
         THEN mj.next_due_hours - sc.total_running_hours ELSE NULL END AS hours_remaining,
    sp.part_no, sp.name AS spare_part_name, sp.qty_on_hand, mj.spare_use_qty
FROM Maintenance_Jobs mj
INNER JOIN Ship_Components sc ON sc.id = mj.ship_component_id AND sc.is_deleted = 0
LEFT JOIN Spare_Parts sp ON sp.id = mj.spare_part_id AND sp.is_deleted = 0
WHERE mj.is_deleted = 0;

CREATE VIEW IF NOT EXISTS v_daily_work_pending AS
SELECT
    dwr.*,
    u.display_name AS reporter_name,
    mj.description AS job_description
FROM Daily_Work_Reports dwr
INNER JOIN Users u ON u.id = dwr.reported_by
LEFT JOIN Maintenance_Jobs mj ON mj.id = dwr.maintenance_job_id
WHERE dwr.is_deleted = 0 AND dwr.is_locked = 0;
