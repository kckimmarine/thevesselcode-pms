# Admin Mode — 계약·배포 운영 SOP

**대상:** THE VESSEL CODE (TVC) · **앱:** Admin Mode (`npm run electron:admin` 또는 Admin Setup)  
**로그인:** `tvc` / `0000`

---

## 상용화 핵심 (Commercial)

| # | TVC가 제공 | Admin 메뉴 |
|---|-----------|-------------|
| 1 | **범용 Setup** (HQ + Vessel) | **Export Setup handoff** |
| 2 | **Seat license** (PC·SKU별) | **Issue seat license** |
| 3 | **PMS & SPARE MASTER.xlsx** (선박별) | Admin 밖 — TVC 작성 → HQ/Vessel **Import** |
| 4 | **App Update** (프로그램만) | **Package App Update** |

**TVC Lab:** registry `TVC_LAB` / `LAB_SHIP` — 출시 후 App Update·Sync 내부 QA. [`tvc-internal-qa.md`](tvc-internal-qa.md)

Admin UI: **Commercial — TVC delivers** · **Commercial core & TVC Lab guide**

---

## 전체 흐름

```text
[계약] → [Registry] → [Setup ZIP] → [설치 + License] → [Master Excel] → [운영]
              ↑                                    ↑
        신규 / 추가 / inactive              App Update (이후)
```

| 단계 | TVC (Admin) | 고객 (HQ / Vessel) |
|------|-------------|-------------------|
| Registry | 선사·선박 등록 | — |
| Setup | 범용 Setup ZIP 전달 | Setup.exe 설치 |
| License | machine request → license.json | Import seat license |
| Master | PMS & SPARE MASTER.xlsx 준비·전달 | 앱에서 Excel Import |
| 유지보수 | App Update ZIP | Import → Install update |

---

## Admin actions 메뉴

| 메뉴 | 용도 |
|------|------|
| **Print contract draft** | 선사·선박 registry → 계약서 초안 프린트 |
| **Print contract registry** | 계약 선사·선박 목록 + 버전 프린트 |
| **Add / edit company / vessel** | 선사·선박 등록·수정·inactive · 계약/연락처 필드 |
| **Export Setup handoff** | HQ + Vessel Setup 4종 ZIP (회사 선택) · **deploy 버전 자동 기록** |
| **Issue seat license** | machine request → license.json · **deploy 버전 기록** |
| **Package App Update** | Setup.exe → 업데이트 ZIP · **deploy 버전 자동 기록** |

### Deploy 버전 (Ship List · Selected contract)

- **Setup sent** — Export Setup handoff 시 기록
- **App (M/E/D)** — App Update / License 발급 시 SKU별 기록
- **HQ app version** — HQ App Update / HQ license 시 기록

체크박스 **Update deploy version in registry after export** (Setup / App Update 모달, 기본 ON)

**Registry 원본:** `admin/registry.json` · `admin/companies/<COMPANY>/…`

---

## A. 신규 선사 + 선박 (처음 계약)

### 사전 (코드·버전 변경 시 1회)

- [ ] `npm run dist` → `dist\`에 범용 Setup 4종 생성  
  `HQ_OFFICE` · `VESSEL_MASTER` · `VESSEL_ENGINE` · `VESSEL_DECK`
- [ ] Admin 실행 → signing key (`private.pem`) 1회 선택 (packaged Admin)

### 계약마다 — TVC 체크리스트

| # | 할 일 | Admin / TVC |
|---|--------|-------------|
| 1 | 선사 미팅·PMS 계약 | (업무) |
| 2 | **신규 선사** 등록 | Home → Company 선택 → **Add / edit company** |
| 3 | **선박** 등록 (IMO, Delivery 등) | **Add / edit vessel** |
| 4 | Setup ZIP 생성 | **Export Setup handoff** → Company 선택 → `dist/` 확인 → Export |
| 5 | ZIP 전달 | **선사 HQ** — HQ Setup 1개 · **선박** — Master / Engine / Deck Setup |
| 6 | (고객) 설치 | 각 PC: Setup.exe → **Export machine request…** → TVC 전송 |
| 7 | Seat license 발급 | **Issue seat license** → request 로드 → Company (+ Vessel SKU는 Vessel) → 저장 |
| 8 | license 전달 | PC·SKU마다 `license.json` 1개 (HQ 1 + 선박 PC당 3) |
| 9 | Master Excel | Admin 밖: **PMS & SPARE MASTER.xlsx** 선박 맞춤 작성 → HQ·선박에 전달 |
| 10 | (고객) Master Import | HQ: Fleet에서 선박 선택 후 Import · Vessel: 해당 SKU에서 Import |

### Seat license — SKU별 선택

| 설치 SKU | Admin에서 선택 | license 범위 |
|----------|----------------|--------------|
| **HQ_OFFICE** | **Company** | 해당 회사 **active 선박 전체** |
| **VESSEL_MASTER / ENGINE / DECK** | **Company + Vessel** | 해당 선박 1척 |

### Setup ZIP 내용 (범용)

- `setups/TVC-PMS-HQ_OFFICE-…-Setup.exe`
- `setups/TVC-PMS-VESSEL_MASTER-…-Setup.exe`
- `setups/TVC-PMS-VESSEL_ENGINE-…-Setup.exe`
- `setups/TVC-PMS-VESSEL_DECK-…-Setup.exe`
- manifest + README

**같은 ZIP을 다른 선사·선박에도 재사용 가능** — company/vessel은 **seat license**로 구분.

---

## B. 기존 선사에 선박 추가

Setup ZIP을 **다시 만들 필요 없음** (범용 Setup 동일).

| # | 할 일 | Admin / TVC |
|---|--------|-------------|
| 1 | 신규 선박 registry | **Add / edit vessel** |
| 2 | HQ license **재발급** | **Issue seat license** (HQ) — active 선박 목록에 신규 포함 |
| 3 | 신규 선박 PC Setup | 기존 Vessel Setup 3종 설치 (ZIP 재전달 또는 개별 exe) |
| 4 | Vessel license 3종 | machine request × 3 → **Vessel 선택** 후 발급 |
| 5 | Master Excel | 신규 선박용 **PMS & SPARE MASTER.xlsx** → HQ·선박 Import |
| 6 | HQ Fleet 확인 | HQ 앱 Ship List에 신규 선박 표시 (registry + HQ license 반영) |

**주의:** HQ PC는 **allowed vessels**가 바뀌므로 **HQ seat license 재발급** 필요.  
기존 Vessel PC license는 그대로 — 신규 선박 PC만 새 license.

---

## C. 계약 종료 (선사·선박)

| # | 할 일 | Admin / TVC |
|---|--------|-------------|
| 1 | 선박 inactive | **Add / edit vessel** → **Set inactive** |
| 2 | 선사 inactive (전체 종료) | **Add / edit company** → **Set inactive** |
| 3 | HQ license 재발급 | inactive 선박 제외한 목록으로 **HQ license 재발급** (권장) |
| 4 | 고객 안내 | AppData·로컬 데이터 반납/폐기 안내 (앱 자동 삭제 없음) |

**삭제 vs inactive**

| | 완전 삭제 | Set inactive |
|--|-----------|--------------|
| Admin UI | ❌ | ✅ |
| registry 파일 | 수동 JSON 정리 시만 | inactive로 유지 |
| active 목록 | — | 목록에서 숨김 |
| license 발급 | — | 대상에서 제외 |

---

## D. App Update (계약 후 유지보수)

버그 수정·기능 개선 후 — **Setup 재설치 없이** ZIP만 전달.

| # | TVC | 고객 |
|---|-----|------|
| 1 | `npm run dist` (버전 bump 시) | — |
| 2 | **Package App Update** → SKU별 Setup 첨부 → ZIP | — |
| 3 | 회사 HQ에 ZIP 전달 | Menu → Data Export & Import → Import → **App Update** → Install |
| 4 | — | footer 새 version · license 유지 · History 유지 확인 |

**App Update는 Master / Work History를 덮어쓰지 않음.**

---

## Admin에 없는 것 (별도 작업)

| 항목 | 어디서 |
|------|--------|
| PMS & SPARE MASTER.xlsx 작성 | TVC — Excel / 템플릿 (선박별) |
| Master Import | HQ / Vessel 앱 — Menu |
| Sync ZIP (업무 데이터) | HQ / Vessel — Export & Import |
| machine request → company/vessel 자동 매칭 | ❌ — Admin에서 **수동 선택** |

---

## TVC 고정 루틴 (요약)

```text
[코드 변경 시]
  npm run dist

[신규·추가 계약]
  Registry 등록 → Export Setup handoff → Master Excel 준비

[고객 설치 후]
  Issue seat license (PC·SKU마다)

[선박 추가]
  vessel 등록 → HQ license 재발급 → 신규 PC license 3종

[계약 종료]
  Set inactive → HQ license 재발급 (선택)

[유지보수]
  Package App Update
```

---

## 참고

- 상세 기술: `docs/admin-mode.md` · `docs/seat-license.md`
- **Company / Vessel ID · Pilot → 출시:** `docs/admin-registry-id-guide.md`
- **출시 후 TVC Lab · App Update QA:** `docs/tvc-internal-qa.md`
- Pilot 테스트: `docs/pilot-test-scenario-1page.md` · `docs/pilot-home-test.md`
- Registry 구조: `admin/README.md`
