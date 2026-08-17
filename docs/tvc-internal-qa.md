# TVC 내부 QA — 출시 후 테스트 · App Update 제작

**목적:** 실제 계약 선박과 **분리**해서 TVC가 버전 업·App Update ZIP·Sync를 검증한 뒤, 고객에게 배포.

---

## 권장 구조 (한 줄)

```text
[고객 registry]  DAEMYUNG, …     →  inactive 제외 · deploy = “고객에게 보낸 버전”
[TVC Lab registry] TVC_LAB        →  항상 active · deploy = “TVC가 검증한 버전”
[TVC PC]           Lab Setup+License →  App Update ZIP 만들고 · Import · 재테스트
```

**실제 선박 PC/데이터와 Lab PC를 절대 섞지 않습니다.**

---

## 1. Registry — `TVC_LAB` (내부 전용 선사)

출시 시 Pilot `DAEMYUNG`은 **inactive** (또는 archive).  
대신 Admin에 **내부 QA 전용** company를 **항상 유지**합니다.

| 필드 | 예 |
|------|-----|
| **Company ID** | `TVC_LAB` |
| **Name** | TVC 내부 QA |
| **Vessel ID** | `LAB_SHIP` (또는 `IMO9999999` — 가짜 IMO) |
| **status** | **active** (종료하지 않음) |

선박 1척이면 Engine / Master / Deck Sync 라운드트립 대부분 검증 가능.  
HQ **다중 선박** license 테스트가 필요하면 `LAB_SHIP_2` 추가.

> Lab vessel은 **실제 IMO·선박명을 쓰지 않음** — 고객 데이터와 혼동 방지.

---

## 2. TVC Lab PC 구성

| PC | 설치 SKU | 용도 |
|----|-----------|------|
| TVC 개발/QA PC 1대 | `HQ_OFFICE` + `VESSEL_MASTER` + `VESSEL_ENGINE` (필요 시 `DECK`) | Update · Sync · SPARE · PMS 전체 |
| (선택) PC 2대 | Master + Deck 분리 | 2인 Sync 시나리오 |

- Setup: **`npm run dist`** 범용 Setup · **Issue seat license** 시 Company=`TVC_LAB`, Vessel=`LAB_SHIP`
- Pilot 때 쓰던 **정호/동욱 가정 PC**를 Lab로 **재 license** 해도 됨 (company를 `TVC_LAB`로)

**Admin Mode** (`npm run electron:admin` 또는 Admin Setup)는 **배포 PC** — App Update ZIP **만드는** 쪽.

---

## 3. 일상 vs 출시 전 워크플로

### A. 기능 개발 (매일)

```bat
npm run electron:hq
npm run electron:engine
npm run electron:master
npm run electron:admin
```

- 코드 수정 · 버그 재현 · UI 확인  
- **App Update ZIP은 아직 만들지 않음**

### B. 버전 올릴 준비 (릴리스 전)

| # | TVC (Lab) | deploy registry |
|---|-----------|-----------------|
| 1 | `package.json` 버전 bump | — |
| 2 | `npm run dist` | — |
| 3 | Lab PC: Setup **재설치** 또는 **App Update Import**로 새 버전 반영 | Lab: `TVC_LAB`에 기록 OK |
| 4 | 체크리스트: PMS · SPARE · Sync · license 유지 · History 유지 | — |
| 5 | Admin → **Package App Update** → Setup 첨부 → ZIP export | **Company = TVC_LAB** · deploy 기록 |
| 6 | Lab PC에서 **같은 ZIP** Import → Install → **재검증** | — |
| 7 | 통과 후 **동일 ZIP**을 고객 HQ에 전달 | **Company = 실제 선사** · deploy 기록 (체크 ON) |

**핵심:** 고객에게 보내는 ZIP = **Lab에서 이미 한 번 통과한 ZIP** (바이너리 동일).

### C. deploy registry 체크박스

| 대상 | Update deploy in registry |
|------|---------------------------|
| Lab export (`TVC_LAB`) | ON — “TVC가 검증한 버전” 추적 |
| 고객 export (`DAEMYUNG` …) | ON — “고객에게 보낸 버전” 추적 |
| 실험용 export (기록 남기기 싫을 때) | **OFF** |

고객 Ship List의 **App (M/E/D)** 는 **고객 company** deploy만 보면 됩니다. Lab은 **Company = TVC_LAB** 로 필터.

---

## 4. Pilot / 데모 / 운영 구분

| 구분 | Company ID | 출시 후 |
|------|------------|---------|
| **Pilot (대명 등)** | `DAEMYUNG` | **inactive** · archive 참고용 |
| **TVC Lab** | `TVC_LAB` | **항상 active** |
| **실제 계약 선사** | `DAEMYUNG` (재등록) 등 | active · deploy = 운영 |

---

## 5. App Update ZIP 만들 때 팁

1. **한 버전 · ZIP 1종** — 범용 Setup이므로 Lab에서 검증한 ZIP을 **여러 선사 HQ에 동일 파일** 전달 가능.  
2. **SKU별 Setup** — HQ / Master / Engine / Deck 각각 첨부했는지 Admin export 화면에서 확인.  
3. **고객 PC에서 테스트 금지** — 미검증 ZIP을 선박에 먼저 넣지 않음.  
4. **footer 버전** · **license 유지** · **Master/History 무손** — Lab에서 3가지 매번 확인 (`docs/pilot-test-scenario-1page.md` 참고).

---

## 6. (선택) Git / 폴더

```text
admin/
  companies/TVC_LAB/     ← Lab registry (항상 유지)
  archive/pilot-2026/    ← inactive Pilot JSON 스냅샷 (선택)
  releases/1.0.1/        ← dist + App Update ZIP 아카이브 (선택)
```

---

## 7. 요약

| 질문 | 답 |
|------|-----|
| 출시 후에도 테스트? | **`TVC_LAB` + Lab PC** 로 분리 |
| Update ZIP은 어디서? | **`npm run dist`** → Admin **Package App Update** |
| 고객과 같은 파일? | Lab **통과 후 동일 ZIP** 배포 |
| Pilot `DAEMYUNG`? | inactive · 운영은 **새 registry** ([`admin-registry-id-guide.md`](admin-registry-id-guide.md)) |

---

## 관련

- [`admin-mode-sop.md`](admin-mode-sop.md) — 계약·배포  
- [`admin-registry-id-guide.md`](admin-registry-id-guide.md) — ID 규칙 · 출시 전환  
- [`pilot-test-scenario-1page.md`](pilot-test-scenario-1page.md) — Lab 재테스트 체크리스트
