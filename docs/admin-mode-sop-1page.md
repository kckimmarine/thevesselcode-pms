# Admin Mode — 계약·배포 1페이지 체크리스트

**TVC** · Admin login `tvc` / `0000` · 상세: `docs/admin-mode-sop.md`

---

## 흐름

```text
[계약] → Registry → Setup ZIP → 설치+License → Master Excel → 운영
```

---

## A. 신규 선사 + 선박

| # | TVC | 메뉴 / 작업 |
|---|-----|-------------|
| 1 | 선사·선박 registry | **Add / edit company** · **Add / edit vessel** |
| 2 | Setup ZIP | `npm run dist` → **Export Setup handoff** |
| 3 | 전달 | HQ: HQ Setup · 선박: Master / Engine / Deck Setup |
| 4 | License | 고객 machine request → **Issue seat license** (HQ=Company, Vessel=Company+Vessel) |
| 5 | Master | **PMS & SPARE MASTER.xlsx** 작성·전달 → 고객 Import |

**PC당 license:** HQ 1 + 선박 PC당 3 (Master / Engine / Deck)

---

## B. 기존 선사 — 선박 추가

| # | TVC |
|---|-----|
| 1 | **Add / edit vessel** (신규 등록) |
| 2 | **HQ license 재발급** (active 선박 목록 갱신) |
| 3 | 신규 PC: Vessel Setup 3종 + license 3종 |
| 4 | 신규 선박 Master Excel → Import |

Setup ZIP **재생성 불필요** (범용 Setup 동일)

---

## C. 계약 종료

| # | TVC |
|---|-----|
| 1 | **Set inactive** (vessel / company) — 완전 삭제 ❌ |
| 2 | HQ license 재발급 (inactive 제외, 권장) |

---

## D. App Update (유지보수)

`npm run dist` → **Package App Update** → HQ에 ZIP → 고객 Import → Install  
(Master / History **무손**)

---

## Seat license 요약

| SKU | Admin 선택 |
|-----|------------|
| HQ_OFFICE | Company |
| VESSEL_* | Company + Vessel |

---

## Admin 밖 (TVC 별도)

- PMS & SPARE MASTER.xlsx 선박별 작성
- Master Import는 HQ / Vessel 앱에서 수행
