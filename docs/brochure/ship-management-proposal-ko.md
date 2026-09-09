# HK Shipping Inc — 선박관리 서비스 프로포절

> **대상:** 선주사(Shipowner)  
> **버전:** Draft v1.0 · 2026-09  
> **문의:** [연락처 입력]

---

## 한 줄 요약

**BSM급 종합 선박관리 역량** + **대명상선식 부산 기반 집중 운영** + **The Vessel Code(TVC) 오프라인 디지털 플랫폼**  
→ 전 세계 지사 없이도, 선주에게 **비용 효율적·투명한·안전한** 선박관리를 제공합니다.

---

## 1. HK Shipping Inc 소개

HK Shipping Inc는 선주의 자산을 보호하고, 선원의 안전을 최우선으로 하는 **통합 선박관리(Integrated Ship Management)** 회사입니다.

| 항목 | 내용 |
|------|------|
| **미션** | 선주 자산 보호 · 해양환경 보호 · 선원 생명·안전 최우선 |
| **운영 모델** | 부산 단일 허브 + 유럽·동남아 협력망 (글로벌 지사 없음) |
| **디지털** | **The Vessel Code (TVC-PMS)** — 선박·본사 오프라인 동기화 |
| **선종** | Chemical Tanker, Oil Tanker, General Cargo 등 |

### 경쟁 포지셔닝

| | BSM (Bernhard Schulte) | 대명상선 (DM Maritime) | **HK Shipping Inc** |
|---|------------------------|------------------------|---------------------|
| **관리 범위** | Ship / Crew / Performance / Digital / Newbuilding | 선박·선원·기술·ISM 종합 | **동급 종합 관리** |
| **글로벌 지사** | 10개 Ship Management Centres | 없음 (부산 집중) | **없음 (부산 집중)** |
| **디지털 플랫폼** | LiveFleet (클라우드) | — | **TVC (오프라인 우선)** |
| **강점** | 700+척, 140년+ | 케미컬·한국선원 전문 | **비용·유연성·TVC 투명성** |

> BSM은 [bs-shipmanagement.com](https://www.bs-shipmanagement.com/) 기준 700+척, 10개 관리센터, LiveFleet 클라우드 플랫폼을 운영합니다.  
> 대명상선은 [dmmaritime.co.kr](https://dmmaritime.co.kr/) 기준 부산 중구에 위치하며, Oil & Chemical Tanker 전문 관리를 수행합니다.

---

## 2. The Vessel Code — 디지털 관리의 핵심

**The Vessel Code (TVC-PMS)** 는 HK Shipping Inc 선박관리의 **디지털 운영 기반**입니다.  
선박과 본사가 **인터넷에 의존하지 않고** PMS·SPARE·결함·작업허가 데이터를 안전하게 주고받습니다.

### TVC가 담당하는 영역

| 모듈 | 기능 | 선주 가치 |
|------|------|-----------|
| **PMS** | Deck/Engine 정비계획, Work Report, Overdue 관리 | 정비 이력 추적·PSC 대비 |
| **SPARE (SPICS)** | 부품 재고, 소모 기록, 자동 차감 | 이중 차감 방지, 비용 통제 |
| **Defect Report** | 결함 등록 → 확인 → HQ 승인 | 결함 이력 단일화 |
| **Work Permit** | 작업허가 워크플로 | 안전관리 문서화 |
| **Sync (ZIP)** | 선박↔HQ 부서별 Export/Import | 오프라인 선박 환경 대응 |

### 워크플로 (요약)

```
작성자(갑판/기관) → Save (Reported)
    ↓
확인자(기관장/선장) → Confirm (+ 스케줄·재고 규칙 적용)
    ↓
HQ → Approve (잠금)
    ↓
선박 ↔ HQ → ZIP Export/Import (sync_status)
```

### TVC vs 클라우드형 플랫폼 (BSM LiveFleet 등)

| | 클라우드 (LiveFleet 등) | **TVC (오프라인 우선)** |
|---|-------------------------|-------------------------|
| 연결 | 상시 인터넷 필요 | **선박 PC 로컬 동작** |
| 데이터 | 서버 중심 | **IndexedDB + ZIP 동기화** |
| 선박 환경 | 위성·항만망 의존 | **항해 중·저속망에서도 업무 가능** |
| 본사 통제 | 실시간 대시보드 | **Export 시점 투명한 델타 동기화** |

> 시범 선박: **INCHEON CHEMI** (Chemical Tanker) — TVC-PMS v2 운영 중

---

## 3. 업무 영역 (Business Scope)

HK Shipping Inc는 BSM·대명상선과 동일하게 **선박관리 전 영역**을 포괄합니다.  
글로벌 지사 대신 **부산 허브 + 전문 협력망**으로 서비스를 제공합니다.

### 3.1 Technical Ship Management (기술관리)

- ISM / ISPS / MLC Code 준수 및 내부심사
- PMS 운영 (**TVC-PMS** 기반)
- 도크·수리 계획 및 감독 (연간 약 [N]척)
- 증서·도면·Class/P&I 대응
- Port State Control (PSC) / Vetting 대비
- 신조감리·개조·Retrofit 지원

### 3.2 Crew Management (선원관리)

- 한국·동남아·유럽 선원 채용·배승·교육
- STCW 기준 면허·교육증 검증
- 승선 전 Assessment · 승선 후 Performance Review
- MLC 2006 · 선원 복지
- Oil & Chemical Tanker 전문 승무경력 우대 체계

### 3.3 Commercial & Operations (운항·상업)

- 항해계획·연료·성능 모니터링
- 항만·에이전트·화주 커뮤니케이션
- 용선(Chartering) 지원 (협력: Høyergruppen 등)
- Insurance · Claims 대응

### 3.4 Procurement & Supplies (조달·보급)

- Spare parts · Stores · Lub oil 조달
- 선용품·Tax-free goods
- 긴급 수리·육상 지원 (VessTech Group 협력)
- **TVC SPARE** 재고 실시간(선박) / 동기화(본사)

### 3.5 QHSE & Sustainability

- Zero Harm · Zero Pollution 목표
- 환경규제 (EU ETS, CII, BWMS 등) 대응
- ISO 14001 · Safety Culture
- 결함·사고·Near-miss TVC 기록

### 3.6 Digital & Reporting

- **TVC-PMS** 일상 운영
- 월간·분기 Management Report
- KPI: Fleet Availability, Overdue Rate, PSC Deficiency, Off-hire

---

## 4. 조직도 (Organization)

```
                    ┌─────────────────────────┐
                    │   Managing Director     │
                    │   (대표이사)              │
                    └───────────┬─────────────┘
                                │
        ┌───────────┬───────────┼───────────┬───────────┐
        │           │           │           │           │
   ┌────▼────┐ ┌────▼────┐ ┌────▼────┐ ┌────▼────┐ ┌────▼────┐
   │ Technical│ │  Crew   │ │Commercial│ │Procure- │ │  QHSE   │
   │Management│ │Management│ │& Ops   │ │ ment    │ │& Env    │
   │ (기술관리) │ │ (선원관리)│ │(운항·상업)│ │ (조달)   │ │(품질·환경)│
   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │           │           │
   ┌────▼────┐ ┌────▼────┐      │      ┌────▼────┐      │
   │Superin- │ │ Crewing │      │      │ Stores  │      │
   │tendents │ │ & Train │      │      │ & Spare │      │
   │ (감독관) │ │ (교육)   │      │      │         │      │
   └────┬────┘ └─────────┘      │      └─────────┘      │
        │                         │                       │
   ┌────▼─────────────────────────▼───────────────────────▼──┐
   │              Digital Systems — The Vessel Code              │
   │         PMS · SPARE · Defect · Work Permit · Sync           │
   └────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Busan HQ (부산 본사)   │
                    │  중앙대로 [주소 입력]     │
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
        ┌─────▼─────┐    ┌──────▼──────┐   ┌──────▼──────┐
        │ Norway    │    │  Poland     │   │  Latvia     │
        │ (Kopervik)│    │  (Gdansk)   │   │  (Liepaja)  │
        │ 협력·소유선 │    │  ISM·기술   │   │  Crewing    │
        └───────────┘    └─────────────┘   └─────────────┘
```

### 핵심 인력 (예시 — 실제 명단으로 교체)

| 역할 | 담당 |
|------|------|
| Managing Director | 그룹 전략·선주 관계 |
| Technical Director | ISM·PMS·도크 |
| Crew Manager | 선원 채용·교육 |
| Superintendent (×N) | 선박별 기술 감독 |
| TVC System Admin | 디지털 플랫폼·Sync |
| QHSE Manager | 안전·환경·심사 |

---

## 5. 선박관리 이력 (Track Record)

### 5.1 그룹 연혁

| 연도 | 사건 |
|------|------|
| 1994 | Kopervik Ship Management 설립 (Norway) |
| 1999 | HK Shipping Group 협력 시작 |
| 2005 | 2세대 경영 (11척 인수) |
| 2013 | Technical·ISM 부서 폴란드(Gdańsk) 이전 — 비용·인력 최적화 |
| 2017 | HK Shipping Group AS 통합 |
| 2020 | 대명상선(DM Maritime) 설립 — 부산 케미컬 전문 |
| 2024– | **The Vessel Code** 시범 운영 (INCHEON CHEMI) |
| 2026 | FRI WAVE 인수 등 선대 확대 |

### 5.2 관리 선박 (참고: Kopervik + 대명상선)

#### General Cargo (Kopervik Ship Management — 21척+)

| # | 선박명 | DWT | 비고 |
|---|--------|-----|------|
| 1 | Brufjell | 4,891 | |
| 2 | Astrid Erika | 4,868 | |
| 3 | Fri Wave | 4,922 | 2026 인수 |
| 4 | Fri Bergen | 5,622 | |
| 5 | Fri Gdansk | 4,933 | |
| … | (총 21척 General Cargo) | ~87,000 DWT 합계 | 423+ 항만 운항 |

#### Chemical / Product Tanker (대명상선 관리)

| # | 선박명 | G/T | 선종 | 국적 |
|---|--------|-----|------|------|
| 1 | INCHEON CHEMI | 5,510 | Chemical | 🇰🇷 |
| 2 | GOLD STAR SHINE | 5,376 | Chemical | 🇰🇷 |
| 3 | VALIANT | 8,270 | Chemical | 🇵🇦 |
| 4 | STIO LOBELIA | 5,720 | Chemical | 🇰🇷 |
| 5 | STIO AZALEA | 5,546 | Chemical | 🇰🇷 |
| 6 | QUARTERBACK J | 6,976 | Chemical | 🇰🇷 |
| 7 | KS SUNGLORY | 1,571 | General | 🇰🇷 |
| 8 | KS SUNRISE | 1,572 | General | 🇰🇷 |

### 5.3 운영 성과 (KPI 예시)

| 지표 | 목표 | 비고 |
|------|------|------|
| Fleet Availability | 99%+ | BSM 벤치마크 |
| PSC Zero Detention | 연간 목표 | |
| PMS Overdue Rate | < 5% | TVC 자동 추적 |
| Crew Retention | [입력]% | |
| Off-hire Days | 최소화 | |

---

## 6. 선주에게 제공하는 가치

### 6.1 비용 효율

- **글로벌 지사 없음** → 관리 간접비 절감
- 폴란드·라트비아·부산 허브 **최적 인력 배치**
- TVC 오프라인 → 위성 통신·클라우드 구독 비용 절감

### 6.2 투명성

- TVC ZIP Sync → 선박·본사 데이터 **일치 검증**
- Work Report / Defect / SPARE **단일 이력**
- 선주 요청 시 Export 파일·Management Report 제공

### 6.3 안전·규정 준수

- ISM · ISPS · STCW · MLC 전 영역
- Oil & Chemical Tanker **전문 승무·정비** 경험
- PSC · SIRE · CDI Vetting 대비

### 6.4 유연성

- 3rd Party Ship Management (타 선주 선박)
- 신조감리·인수·매각 지원
- 선종·국적·승선원 구성 **맞춤형** 제안

---

## 7. 서비스 프로세스 (선주 온보딩)

```
1. Initial Meeting     선주 요구·선박 현황 파악
        ↓
2. Proposal & KPI      관리 범위·요율·KPI 합의
        ↓
3. Takeover Plan       ISM 인수·선원·증서·TVC 설치
        ↓
4. Go-Live             관리 개시 + TVC Sync 가동
        ↓
5. Monthly Review      KPI·비용·PSC 리뷰
        ↓
6. Continuous Improve  PMS·선원·디지털 개선
```

---

## 8. 연락처

| | |
|---|---|
| **회사명** | HK Shipping Inc / [법인명 입력] |
| **주소** | 부산광역시 중구 중앙대로 [번호] |
| **Tel** | +82-51-XXX-XXXX |
| **Email** | [이메일 입력] |
| **Web** | [홈페이지 입력] |
| **TVC** | The Vessel Code — PMS · SPARE · Offline Sync |

---

## 부록 A — 약어

| 약어 | 의미 |
|------|------|
| PMS | Planned Maintenance System |
| SPICS | Spare Parts Inventory Control System |
| ISM | International Safety Management |
| ISPS | International Ship and Port Facility Security |
| PSC | Port State Control |
| DWT | Deadweight Tonnage |

## 부록 B — 참고 링크

- BSM: https://www.bs-shipmanagement.com/
- 대명상선: https://dmmaritime.co.kr/
- HK Shipping Group: https://hk-shipping.group/
- TVC-PMS: 본 저장소 `README.md`, `docs/workflow-manual-v1.md`

---

*본 문서는 선주사 프로포절용 초안입니다. 법인명·연락처·실제 KPI·인력 명단은 최종 발행 전 확인·갱신이 필요합니다.*
