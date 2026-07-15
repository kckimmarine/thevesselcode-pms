# Defect (Trouble) Report Case

TVC-PMS **Defect Case**는 첨부 서식 *Defect (Trouble) report.docx* 를 기준으로 한 1급 엔티티입니다.  
Work Report(Trouble)와 분리되어 **Phase 1·2 긴급** 회사 보고 흐름을 지원합니다.

---

## 1. DB 스키마 (`defect_cases` · IndexedDB v8)

| 필드 | 타입 | Phase | 설명 |
|------|------|-------|------|
| `id` | string | — | PK (`DEF-{timestamp}`) |
| `case_no` | string | 1 | Ref No — `DEF-{VESSEL}-{YYYY}-{seq}` |
| `vessel_id` | string | — | 선박 ID |
| `department` | string | — | `DECK` / `ENGINE` |
| `maintenance_job_id` | string | — | 연결 Job (선택) |
| `job_code` | string | — | PMS Job Code |
| `work_report_id` | string? | — | 연결 Work Report (선택) |
| `status` | enum | — | 아래 상태 참조 |
| `urgency` | string | — | `IMMEDIATE` |
| `sync_status` | enum | — | `LOCAL` / `PENDING_SYNC` / `SYNCED` |
| `hq_synced` | boolean | — | HQ Import 여부 |
| `phase1_locked` | boolean | 1 | 제출 후 선박 편집 잠금 |
| `phase2_locked` | boolean | 2 | HQ 회신 후 잠금 |
| `to_company` | string | 1 | To (회사) |
| `ship_name` | string | 1 | Ship Name |
| `report_date` | date | 1 | Date |
| `pms_group_no` | string | 1 | PMS GROUP NO |
| `pms_job_code` | string | 1 | PMS JOB CODE |
| `last_maintenance_date` | date | 1 | Last maintenance date |
| `rh_since_last_maintenance` | number/string | 1 | RH since last maintenance |
| `expect_date_place` | string | 1 | Expect date & place |
| `machinery_name` | string | 1 | Machinery name |
| `manufacturer` | string | 1 | Manufacturer |
| `type_model_serial` | string | 1 | Type / Model / Serial No. |
| `chief_engineer` | string | 1 | C/E |
| `master` | string | 1 | Master |
| `outline_maintenance_request` | text | 1 | Outline of Maintenance Request |
| `estimated_cause` | text | 1 | Estimated cause of Trouble |
| `possible_effect` | text | 1 | Possible effect to other system |
| `action_taken` | text | 1 | Action taken / Corrective Action |
| `company_initial_reply` | text | 2 | Initial Reply from Company |
| `permit_to_work` | text | 2 | Permit to Work (Unplanned Maintenance) |
| `reply_by` | string | 2 | Reply by |
| `reply_date` | date | 2 | Reply Date |
| `report_to_class` | boolean | 2 | Class 보고 |
| `report_to_flag` | boolean | 2 | Flag 보고 |
| `report_to_external_stakeholder` | boolean | 2 | External Stakeholder |
| `report_to_psc` | boolean | 2 | PSC |
| `report_na` | boolean | 2 | N/A |
| `ship_verified_after_clear` | text | 3 | 완료 후 선박 확인 (후속) |
| `ship_verified_by` | string | 3 | Verified by |
| `ship_verified_date` | date | 3 | Date |
| `preventive_measures` | text | 4 | 예방조치 (MTT) |
| `dp_closed_satisfactory` | bool? | 4 | Satisfactory / Unsatisfactory |
| `dp_closed_reply` | text | 4 | D.P. 종결 회신 |
| `dp_closed_by` | string | 4 | Reply by |
| `dp_closed_date` | date | 4 | Date |
| `submitted_at` | ISO | 1 | 회사 제출 시각 |
| `created_at` / `updated_at` | ISO | — | 감사·동기화 |

### 상태 (`status`)

```
DRAFT → SUBMITTED_TO_COMPANY → COMPANY_REVIEWED → WORK_IN_PROGRESS → AWAITING_COMPLETION → CLOSED
```

**긴급 MVP:** `DRAFT` · `SUBMITTED_TO_COMPANY` · `COMPANY_REVIEWED`

### 인덱스

- `by_status`, `by_sync`, `by_vessel`, `by_case_no`, `by_department`

---

## 2. 서식 필드 매핑표 (docx ↔ PMS)

| 서식 (영문) | DB 필드 | Phase | 선박 | HQ |
|-------------|---------|-------|------|-----|
| To | `to_company` | 1 | ✏️ | 👁 |
| Ref No | `case_no` | 1 | 자동 | 👁 |
| Ship Name | `ship_name` | 1 | ✏️ | 👁 |
| Date | `report_date` | 1 | ✏️ | 👁 |
| PMS GROUP NO | `pms_group_no` | 1 | Job 연동 | 👁 |
| PMS JOB CODE | `pms_job_code` | 1 | Job 연동 | 👁 |
| Last maintenance date | `last_maintenance_date` | 1 | ✏️ | 👁 |
| Running hours after last maint. | `rh_since_last_maintenance` | 1 | ✏️ | 👁 |
| Expect date & place | `expect_date_place` | 1 | ✏️ | 👁 |
| Machinery name | `machinery_name` | 1 | ✏️ | 👁 |
| Manufacturer | `manufacturer` | 1 | ✏️ | 👁 |
| Type & model & Serial No. | `type_model_serial` | 1 | ✏️ | 👁 |
| Outline of Maintenance Request | `outline_maintenance_request` | 1 | ✏️ | 👁 |
| Estimated cause of Trouble | `estimated_cause` | 1 | ✏️ | 👁 |
| Possible effect… | `possible_effect` | 1 | ✏️ | 👁 |
| Action taken / Corrective Action | `action_taken` | 1 | ✏️ | 👁 |
| C/E | `chief_engineer` | 1 | ✏️ | 👁 |
| Master | `master` | 1 | ✏️ | 👁 |
| Initial Reply from Company | `company_initial_reply` | 2 | 👁 | ✏️ |
| Permit to Work for Unplanned Maintenance | `permit_to_work` | 2 | 👁 | ✏️ |
| Reply by / Date | `reply_by` / `reply_date` | 2 | 👁 | ✏️ |
| Require report to: Class / Flag / … | `report_to_*` | 2 | 👁 | ✏️ |
| Verified by Ship (After cleared) | `ship_verified_*` | 3 | 후속 | 후속 |
| Preventive measures | `preventive_measures` | 4 | 후속 | 후속 |
| Closed out reply D.P. | `dp_closed_*` | 4 | 후속 | 후속 |

### 기존 Work Report Trouble 탭과의 관계

| Work Report 필드 | Defect Case | 비고 |
|------------------|-------------|------|
| `troubleOutline` | `outline_maintenance_request` | 의미 정렬 |
| `presumedCause` | `estimated_cause` | 동일 |
| `countermeasures` | `action_taken` | 동일 |
| File No, Voy, Delay Hours | — | Defect 서식 외 — Case 화면에서 미사용 |

---

## 3. HQ Phase 2 화면 (와이어)

```
┌─────────────────────────────────────────────────────────────┐
│ DEFECT (TROUBLE) REPORT — DEF-TEST_V01-2026-0001            │
├─────────────────────────────────────────────────────────────┤
│ Phase 1 — Ship Report [URGENT]          (readonly on HQ)    │
│  To / Ref / Ship / Date / PMS Group·Code / Machinery…       │
│  Outline / Cause / Effect / Action / C·E / Master           │
├─────────────────────────────────────────────────────────────┤
│ Phase 2 — Company Initial Reply [URGENT]   (HQ editable)    │
│  Initial Reply from Company    [textarea]                   │
│  Permit to Work                [textarea]                   │
│  Reply by [input]   Reply Date [date]                       │
│  Require to report to:                                      │
│    ☐ Class  ☐ Flag  ☐ External Stakeholder  ☐ PSC  ☐ N/A  │
├─────────────────────────────────────────────────────────────┤
│ [Print/PDF]  [Save HQ Reply]  [Save & Export Reply]  Close  │
└─────────────────────────────────────────────────────────────┘
```

**HQ Menu:** `Defect Report Inbox` → Inbox 테이블 → **Review** → Phase 2 입력

**Inbox 목록 컬럼:** Ref No | Date | Machinery | Status | Open / Review

---

## 4. Urgent Export + PDF 생성 흐름

### 4.1 선박 — 결함 식별 직후 (Phase 1)

```
Defect 식별
  → Menu: Report Defect (Trouble) 또는 Inbox: ＋ New
  → Phase 1 작성 → Submit to Company
  → Urgent Export (ZIP)
       ├── defect_case.json   (export_meta.direction = DEFECT_URGENT_TO_HQ)
       ├── DEFECT_{case_no}.html  (인쇄 → Save as PDF)
       └── README.txt
  → 이메일 첨부 (HTML/PDF + ZIP) → 회사
```

### 4.2 HQ — 초기 검토 (Phase 2)

```
Import Urgent Defect (ZIP)
  → defect_cases merge (hq_synced=true)
  → Inbox: Awaiting HQ → Review
  → Phase 2 입력 → Save HQ Reply
  → Save & Export Reply (ZIP)
       ├── defect_case_reply.json  (DEFECT_REPLY_HQ_TO_SHIP)
       └── DEFECT_REPLY_{case_no}.html
  → 선박 Import Defect Package (Captain Hub / Ship)
```

### 4.3 `export_meta` 스펙

**Urgent (Ship → HQ):**

```json
{
  "export_meta": {
    "direction": "DEFECT_URGENT_TO_HQ",
    "package_type": "DEFECT_CASE",
    "urgency": "IMMEDIATE",
    "vessel_id": "TEST_V01",
    "case_no": "DEF-TEST_V01-2026-0001",
    "schema_version": 1
  },
  "defect_cases": [ { ... } ]
}
```

**Reply (HQ → Ship):**

```json
{
  "export_meta": {
    "direction": "DEFECT_REPLY_HQ_TO_SHIP",
    "package_type": "DEFECT_CASE_REPLY",
    "vessel_id": "TEST_V01",
    "case_no": "DEF-TEST_V01-2026-0001"
  },
  "defect_cases": [ { ... phase2 filled ... } ]
}
```

### 4.4 PDF

전용 PDF 라이브러리 없음. `DEFECT_*.html` → 브라우저 **Print → Save as PDF** (Work Report와 동일 패턴).

---

## 5. 구현 파일

| 파일 | 역할 |
|------|------|
| `js/core/schema.js` | `defect_cases` store, `TVC_DefectCase` |
| `js/services/defectCase.js` | CRUD, submit, HQ Phase 2 |
| `js/services/defectSync.js` | Urgent ZIP, HTML, import |
| `js/ui/defectReport.js` | Inbox + Modal UI |
| `js/services/sync.js` | 배치 sync에 `defect_cases` 포함 |
| `js/app.js` | 메뉴·핸들러 연동 |
| `js/rbac.js` | `SUBMIT_DEFECT_REPORT`, `REPLY_DEFECT_REPORT` |

---

## 6. 테스트 체크리스트

1. **선박 (Engineer):** New Defect → Phase 1 저장 → Submit → Urgent Export ZIP 생성
2. **HQ:** Import Urgent Defect → Inbox에 표시 → Phase 2 (Permit, Class/PSC) → Save & Export Reply
3. **선박 (C/E):** Import Reply ZIP → Case `COMPANY_REVIEWED` 확인
4. **Print:** HTML 4-Phase 서식 출력 확인
5. **배치 sync:** 월간 `Data Export` ZIP에 `defect_cases` 델타 포함 확인

---

## 7. Phase 3·4 UI (완료 확인 · D.P. 종결)

### Phase 3 — 선박 (Verified by Ship)

| 서식 | DB 필드 | 동작 |
|------|---------|------|
| Verification after cleared | `ship_verified_after_clear` | Report Completion |
| Verified by (C/E or Master) | `ship_verified_by` | 자동/수동 |
| Date | `ship_verified_date` | 자동 |

**상태:** `COMPANY_REVIEWED` / `WORK_IN_PROGRESS` → `AWAITING_COMPLETION`  
**버튼:** ▶ Start Work → Report Completion → Report & Export  
**패키지:** `DEFECT_COMPLETION_TO_HQ` (`defect_case_completion.json`)

### Phase 4 — HQ (Closed out D.P.)

| 서식 | DB 필드 | 동작 |
|------|---------|------|
| Preventive measures (MTT) | `preventive_measures` | Close Case |
| Satisfactory / Unsatisfactory | `dp_closed_satisfactory` | 라디오 |
| Reply by / Date | `dp_closed_by` / `dp_closed_date` | 자동/수동 |

**상태:** `AWAITING_COMPLETION` → `CLOSED`  
**버튼:** Close Case (D.P.) → Close & Export  
**패키지:** `DEFECT_CLOSE_HQ_TO_SHIP` (`defect_case_close.json`)

### 전체 흐름

```
Phase1 Submit → Urgent Export → HQ Phase2 → Reply Export
  → Ship Start Work → Phase3 Complete → Completion Export
  → HQ Phase4 Close → Close Export → Ship Import
```
