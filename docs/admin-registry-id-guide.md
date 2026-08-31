# Admin Registry — Company / Vessel ID 규칙 & 출시 전환

**대상:** THE VESSEL CODE (TVC) · **현재:** Pilot / 테스트 / 데모  
**목적:** 정식 출시 시 registry ID를 **운영 기준**으로 새로 잡기

Pilot registry 예: `DAEMYUNG` · `INCHEON CHEMI` → **출시 때도 ID를 새로 정해 등록 가능** (기존 Pilot 항목은 inactive 또는 archive).

---

## 1. Company ID 규칙

| 항목 | 규칙 |
|------|------|
| **역할** | 선사(HQ) 단위 **고유 키** · seat license · Setup handoff · `admin/companies/<ID>/` 폴더명 |
| **형식** | **영문 대문자 · 숫자 · `_` (밑줄)** 권장 |
| **길이** | **2 ~ 24자** (짧고 고유하게) |
| **금지 문자** | `\ / : * ? " < > \|` 및 공백 |
| **등록 후** | **변경 불가** (Edit 시 readonly) |
| **중복** | Admin에서 **전역 유일** |

### 추천 패턴

| 패턴 | 예 | 비고 |
|------|-----|------|
| 선사 약어 | `DAEMYUNG`, `SMKL`, `HMM` | 가장 흔함 |
| 약어 + 구분 | `DM_2026`, `ACME_PMS` | 동명·재계약 구분 |
| 그룹사 코드 | `KSS_LINE` | 내부 ERP 코드와 맞출 때 |

### 피할 것

- 소문자만 (`daemyung`) — 헷갈림
- 너무 긴 문장형 ID
- Pilot·운영 **같은 ID 재사용** (license·deploy 이력 혼선) — 출시는 **새 ID** 권장

### Name 필드와 구분

| 필드 | 예 | 용도 |
|------|-----|------|
| **Company ID** | `DAEMYUNG` | 시스템·license·폴더 |
| **Name (KR)** | 대명상선 | 계약서·화면 표시 |
| **Name (EN)** | Daemyung | 계약서·영문 |

---

## 2. Vessel ID 규칙

| 항목 | 규칙 |
|------|------|
| **역할** | **선사 내** 선박 고유 키 · Vessel seat license · `vessels/<ID>/vessel.json` |
| **범위** | Company ID **안에서만** 유일 (다른 선사와 같아도 됨) |
| **금지 문자** | Company ID와 동일 |
| **등록 후** | **변경 불가** |

### 추천 패턴 (택 1 — 선사마다 통일)

| 방식 | Vessel ID 예 | 장점 |
|------|----------------|------|
| **A. 선박명** (Pilot 방식) | `INCHEON CHEMI` | 현장과 동일 · 읽기 쉬움 |
| **B. IMO 번호** | `IMO9297711` | IMO 변경 없음 · 안정적 |
| **C. 선사 코드 + 일련** | `DM01`, `DM02` | 짧음 · HQ 내부 코드와 연동 |

**출시 권장:** **B (IMO)** 또는 **A (선박명)** 중 하나로 선사 전체 통일.  
`code` 필드(01, 02…)는 HQ 목록·계약서 **표시용**으로 유지.

### Name vs Vessel ID

- **Vessel ID** = 시스템 키 (license에 `vesselId`로 저장)
- **Name** = 화면·계약서 선박명 (바꿔도 ID는 그대로)

---

## 3. Pilot → 정식 출시 전환

현재 `DAEMYUNG` / 4척은 **파일럿·데모**입니다. 출시 시 **운영 registry를 새로 등록**합니다.

```text
[Pilot]  DAEMYUNG, INCHEON CHEMI …  →  inactive 또는 admin/archive/ 보관
[운영]   (새 Company ID) + (새 Vessel ID)  →  active · Setup · License · Master
```

### 출시 체크리스트 (TVC)

| # | 작업 |
|---|------|
| 1 | **Company / Vessel ID 규칙** 확정 (이 문서 + 선사별 표) |
| 2 | Pilot 항목 **Set inactive** (또는 registry JSON을 `admin/archive/pilot-2026/` 등으로 복사 보관) |
| 3 | Admin → **Add company** — **새 Company ID** + 정식 계약 정보 |
| 4 | **Add vessel** — 선박별 **Vessel ID** · IMO · Delivery |
| 5 | `npm run dist` → **Export Setup handoff** → **Issue seat license** (PC·SKU별) |
| 6 | **PMS & SPARE MASTER.xlsx** 정식본 전달 |
| 7 | Pilot PC license·AppData는 **운영과 분리** (재설치 + 새 license 또는 Pilot PC만 계속 테스트용) |

### 대명상선 출시 예시 (2가지 선택)

**선택 1 — ID 유지 (단순)**  
Pilot과 **같은** `DAEMYUNG` / 선박명을 쓰되, Pilot 데이터·license는 폐기하고 **registry·license·Master만 정식으로 다시 발행**.

**선택 2 — ID 새로 (권장)**  
Pilot `DAEMYUNG` → **inactive**  
운영 `DAEMYUNG` 또는 `DM_PROD` 등 **새 등록** → deploy·license 이력 깨끗.

| | Pilot (현재) | 운영 (예: 선택 2) |
|--|--------------|-------------------|
| Company ID | `DAEMYUNG` | `DAEMYUNG` (재등록) 또는 `DM_PROD` |
| Vessel ID | `INCHEON CHEMI` | `IMO9297711` 또는 동일 선박명 |
| Seat license | Pilot 발급분 | **전 PC 재발급** |
| Master Excel | 테스트용 | **계약 반영 정식본** |

---

## 4. 신규 계약 선사 (출시 후)

1. Admin → **Add company** → **새 Company ID** (위 규칙)
2. **Add vessel** (해당 선사 소속)
3. SOP: [`admin-mode-sop.md`](admin-mode-sop.md) — Setup → License → Master

선사마다 ID 표를 TVC 내부 시트(Excel)에 한 줄씩 적어 두면 100+ 선박 scale 시 편합니다.

---

## 5. TVC 내부 ID 대장 (템플릿)

| Company ID | Name (KR) | Code | HQ login ID | HQ password | Vessel ID | Code | IMO | 비고 |
|------------|-----------|------|-------------|-------------|-----------|------|-----|------|
| TVC | The Vessel Code | 1 | tvc | tvc1234 | TVC No1 | 1 | 9999999 | Pilot · 신규 등록 시 참조 |

---

## 6. 관련 문서

- Data retention (계약 선박): [`data-retention-policy.md`](data-retention-policy.md)
- Data scope (선사 HQ / TVC Admin): [`data-scope-policy.md`](data-scope-policy.md)
- 운영 SOP: [`admin-mode-sop.md`](admin-mode-sop.md)
- Registry 구조: [`../admin/README.md`](../admin/README.md)
- Seat license: [`seat-license.md`](seat-license.md)

**Admin UI:** Company 드롭다운 = **No Select · All · Company ID** 목록.
