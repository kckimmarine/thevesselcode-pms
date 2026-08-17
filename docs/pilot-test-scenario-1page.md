# TVC-PMS Pilot — 1페이지 테스트 시나리오

**선박:** INCHEON CHEMI · **회사:** DAEMYUNG · **비밀번호:** `0000` · **버전:** v1.0.0 (로그인 화면 footer)

---

## 1. 누가 무엇을 설치하나

| 테스터 | Setup (PC당 2개) | 역할 |
|--------|------------------|------|
| **정호** | `TVC-PMS-HQ_OFFICE-1.0.0-Setup.exe` + `TVC-PMS-VESSEL_ENGINE-1.0.0-Setup.exe` | 본사 + 기관실 |
| **동욱** | `TVC-PMS-VESSEL_MASTER-1.0.0-Setup.exe` + `TVC-PMS-VESSEL_DECK-1.0.0-Setup.exe` | Master Hub + 갑판 |

한 PC에 SKU 2개 **동시 설치 가능** (바탕화면 아이콘 2개). **SKU당 창 1개만** 열 것.

---

## 2. 설치 & Seat License (Setup당 1회)

1. Setup.exe 실행 → 설치 (경로 기본값 OK)
2. 첫 실행 → **Seat Activation** → **Export machine request…** → JSON 저장
3. TVC에게 전송 (SKU 이름 + JSON 파일)
4. TVC가 보낸 `license.json` → **Import seat license…**
5. 로그인 화면 + license 배지 확인

| SKU | 로그인 ID | Department |
|-----|-----------|------------|
| HQ | `hq` | 선택 없음 |
| Engine | `engineer` 또는 `ce` | Engine |
| Master | `captain` | Master |
| Deck | `officer` 또는 `co` | Deck |

---

## 3. 테스트 시나리오 (최소 1회씩)

### A. PMS Work Report (부서별)

| # | SKU | 계정 | 작업 | 기대 결과 |
|---|-----|------|------|-----------|
| A1 | Deck | `officer` | Actual Plan → Report 제출 | PENDING 생성 |
| A2 | Deck | `co` 또는 `captain` | Report 승인 | APPROVED |
| A3 | Engine | `engineer` | Report 제출 | PENDING |
| A4 | Engine | `ce` | Report 승인 | APPROVED |

### B. Sync 라운드트립 (ZIP — 카톡/메일/USB)

```text
동욱 Deck  ──Export──►  동욱 Master (Import)
정호 Engine ──Export──►  동욱 Master (Import)
동욱 Master ──Export to HQ──►  정호 HQ (Import)
정호 HQ     ──HQ feedback──►  동욱 Master (Import)
```

| # | 작업 | 기대 결과 |
|---|------|-----------|
| B1 | Deck Export → Master Import | Work History 반영 |
| B2 | Engine Export → Master Import | Work History 반영 |
| B3 | Master → HQ Export → Import | HQ에서 History 확인 |
| B4 | HQ feedback → Master Import | Original Plan 반영 |
| B5 | **잘못된 선박/부서 ZIP Import** | **차단** + 오류 메시지 |

**경로:** Menu → **Data Export & Import**

### C. SPARE — Requisition (Engine)

| # | 작업 | 기대 결과 |
|---|------|-----------|
| C1 | SPARE → **New Requisition** → 부품 체크 → Save | 청구서 생성 |
| C2 | **Requisition List** → Select Requisition → 행 클릭 | Requisition No. + 부품 목록 표시 (JS 오류 없음) |
| C3 | Print / Preview / Excel | 문서 출력 |
| C4 | Export station ZIP → Master Import | HQ까지 Sync 가능 |

### D. SPARE — HQ (선택)

| # | 작업 | 기대 결과 |
|---|------|-----------|
| D1 | HQ → Ship List **INCHEON CHEMI** 선택 | 선박 필터 적용 |
| D2 | Requisition History / Quotation Export | Excel 다운로드 |
| D3 | SPARE Master Import (Engine 수정본) | Import 완료 + relink 안내 |

---

## 4. 버그 리포트 (TVC에게)

```text
[Pilot bug]
Tester: 정호 / 동욱
SKU: HQ_OFFICE | VESSEL_ENGINE | VESSEL_MASTER | VESSEL_DECK
Version: v1.0.0
Steps: 1… 2… 3…
Expected: …
Actual: … (스크린샷 필수)
ZIP/file: (해당 시)
```

---

## 5. App Update 받을 때 (TVC가 ZIP 보내면)

1. 해당 SKU 앱 실행
2. Menu → Data Export & Import → Import → **App Update**
3. Install update → 재실행
4. 확인: footer **새 version** · license **유지** · History **유지** · 버그 **재현 안 됨**

---

## 주의 3가지

- Setup만 다른 PC에 복사 → **새 seat** 필요 (PC마다 machine request)
- **App Update** = 프로그램만 / **Sync ZIP** = 업무 데이터 (혼동 금지)
- SKU당 **창 1개** — 중복 실행 시 IndexedDB 오류

**상세:** `docs/pilot-home-test.md` · `docs/PILOT_CHECKLIST.md` · `docs/pilot-p1-spare-checklist.md`
