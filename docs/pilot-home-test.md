# Pilot Home Test — 정호 · 동욱 (설치 → Sync → App Update 반복)

THE VESSEL CODE pilot: **real Setup install**, **seat license**, **offline Export/Import** between two homes, **bug report → App Update → re-test**.

Pilot vessel: **INCHEON CHEMI** · Company: **DAEMYUNG** · Password: **`0000`**

---

## Roles & SKUs

| Tester | PC에 설치할 Setup (2개씩) | 주 역할 |
|--------|---------------------------|---------|
| **정호** | `HQ_OFFICE` + `VESSEL_ENGINE` | 본사(HQ) + 선박 기관실(Engine) |
| **동욱** | `VESSEL_MASTER` + `VESSEL_DECK` | 선박 Master Hub + 갑판(Deck) |

한 PC에 SKU 2개 **동시 설치 가능** (Start Menu / 바탕화면 아이콘 2개).  
**각 Setup마다 seat license 1개** (PC·SKU별 Machine request → TVC 발급).

| SKU | 로그인 |
|-----|--------|
| HQ | `hq` / `0000` — Department **선택 없음** |
| Engine | `engineer` 또는 `ce` / `0000` — Department **Engine** |
| Master | `captain` / `0000` — Department **Master** |
| Deck | `officer` 또는 `co` / `0000` — Department **Deck** |

---

## Goal 1 — 토요일: Setup 전달 & 설치 테스트

### TVC (금~토 아침)

```bat
cd /d C:\Users\zzang\Desktop\thevesselcode-pms
npm run dist
```

`dist\` 에서 후배별로 복사:

**정호 USB/폴더**

- `TVC-PMS-HQ_OFFICE-<version>-Setup.exe`
- `TVC-PMS-VESSEL_ENGINE-<version>-Setup.exe`

**동욱 USB/폴더**

- `TVC-PMS-VESSEL_MASTER-<version>-Setup.exe`
- `TVC-PMS-VESSEL_DECK-<version>-Setup.exe`

Setup **만** 전달. `license.json` / `private.pem` **금지**.

### 각 후배 (설치당 1회)

1. Setup.exe 실행 → 설치 (경로 기본값 OK)
2. 첫 실행 → **Seat Activation** 화면
3. **Export machine request…** → JSON 저장
4. TVC에게 카톡/메일 전송 (SKU 이름 + 파일)
5. TVC가 보낸 `license.json` → **Import seat license…**
6. 로그인 화면 + license 배지 확인 → 위 표대로 로그인

### TVC (seat 발급, Setup당 1회)

```bat
node scripts/issue-license.mjs --request "path\to\machine-request.json" --out "path\to\license-seat.json" --months 3
```

후배에게 **해당 PC·해당 SKU용** `license-seat.json`만 전달.

---

## Goal 2~3 — 집에서: 데이터 작성 & 정호 ↔ 동욱 Sync

모든 Sync는 **카톡 / 메일 / USB** 로 ZIP만 주고받음 (인터넷 API 없음).

### 데이터 흐름 (INCHEON CHEMI 1척 가정)

```text
[동욱 Deck]  ──station ZIP──►  [동욱 Master]
[정호 Engine] ──station ZIP──►  [동욱 Master]
[동욱 Master] ──company/monthly ZIP──►  [정호 HQ]
[정호 HQ]     ──HQ feedback ZIP──►  [동욱 Master]
```

### 동욱 — Deck (같은 PC)

1. Actual Plan → Work Report 작성·승인 (officer → co/captain 역할은 Deck 내에서)
2. Menu → **Data Export & Import** → Export → **Monthly** (또는 station merge용 Export)
3. ZIP 파일명에 `INCHEON CHEMI` / `DECK` 포함 확인

### 동욱 — Master

1. Menu → Import → **Engine/Deck station ZIP** (Deck는 로컬 파일, Engine은 정호에게 받은 ZIP)
2. Work History / 승인 큐 확인
3. Export → **Company / Monthly to HQ** ZIP → **정호에게 전송**

### 정호 — Engine

1. Work Report 작성·승인 (`engineer` → `ce`)
2. Export → **ENGINE** station/monthly ZIP → **동욱 Master에게 전송**

### 정호 — HQ

1. Ship List에서 **INCHEON CHEMI** 선택
2. Import → 동욱 Master가 보낸 ZIP
3. Work History·승인·Defect/Postpone 등 HQ 화면 확인
4. Export → **HQ feedback** ZIP → **동욱 Master에게 전송**

### 동욱 — Master (HQ 회신)

1. Import → 정호 HQ feedback ZIP
2. Original Plan / History 반영 확인

### 최소 1회 라운드트립 체크리스트

- [ ] Deck Export → Master Import (동욱 PC 내)
- [ ] Engine Export (정호) → Master Import (동욱)
- [ ] Master → HQ Export (동욱→정호)
- [ ] HQ → Master feedback (정호→동욱)
- [ ] 잘못된 선박/부서 ZIP Import 시 **차단** 메시지 확인

---

## Goal 4 — 버그·오류 TVC 공유

후배는 아래 형식으로 **TVC(본인)에게** 전달:

```text
[Pilot bug]
Tester: 정호 / 동욱
SKU: HQ_OFFICE | VESSEL_ENGINE | VESSEL_MASTER | VESSEL_DECK
Version: v1.0.0 (로그인 화면 footer)
Steps: 1… 2… 3…
Expected: …
Actual: … (스크린샷 첨부)
ZIP/file: (해당 시 파일명)
```

TVC는 이슈 수정 → `package.json` version bump → `npm run dist`.

---

## Goal 5~6 — App Update 배포 & PC별 설치 확인

Operational data(Master/History)는 **건드리지 않음**. 앱 바이너리만 갱신.

### TVC

1. 버그 수정 후 version bump (예: `1.0.0` → `1.0.1`)
2. `npm run dist`
3. `npm run electron:admin` → login `tvc` / `0000`
4. **Package App Update** → 필요한 Setup.exe 첨부:
   - ZIP 1개에 HQ + Engine + Master + Deck Setup **모두 넣어도 됨**
5. App Update ZIP → 정호·동욱 **각 1통** (카톡/메일)

### 정호 · 동욱 (각 PC, 설치된 SKU마다 1회)

1. 해당 SKU 앱 실행
2. Menu → **Data Export & Import** → **Import** → **App Update**
3. TVC가 보낸 App Update ZIP 선택 → **Install update**
4. NSIS 마법사 완료 → 앱 재실행
5. 확인:
   - [ ] 로그인 footer **새 version**
   - [ ] seat license **그대로** (재 Import 불필요)
   - [ ] 기존 Work History / Master **유지**
   - [ ] 수정된 버그 **재현 안 됨**

---

## Goal 7 — 2~6 반복

| Round | 내용 |
|-------|------|
| **R1** | 설치 + seat + 1회 full Sync |
| **R2** | 버그 수정 App Update → Sync 일부 재검증 |
| **R3+** | 필요 시 동일 사이클 |

매 라운드 **동일 version** 유지 필수 (정호·동욱·TVC Admin 빌드 모두).

---

## TVC Quick commands

```bat
REM Full installers (토요일 handoff)
npm run dist

REM Single SKU rebuild (필요 시)
node scripts/build-one-sku.mjs VESSEL_ENGINE nsis

REM Seat (후배 machine request 1개당)
node scripts/issue-license.mjs --request machine-request.json --out license-seat.json --months 3

REM App Update ZIP
npm run electron:admin
```

---

## 주의

| 항목 | 설명 |
|------|------|
| Setup 재배포 | 다른 PC에 Setup만 복사 → **새 seat** 필요 |
| seat + Setup 키트 | 다른 PC에서 **동작 안 함** (Machine ID 바인딩) |
| TVC 창 중복 실행 | IndexedDB `Internal error` — **SKU당 1창** |
| `npm run electron:*` | 개발용; **토요일 handoff는 Setup.exe만** |
| App Update vs Sync | App Update = 프로그램만 / Sync ZIP = 업무 데이터 |

---

## Related docs

- `docs/seat-license.md` — seat 정책
- `docs/admin-mode.md` — App Update packaging
- `docs/PILOT_CHECKLIST.md` — Deck/Engine/HQ 상세 시나리오
- `docs/pilot-p0-checklist.md` — P0 검증 항목
