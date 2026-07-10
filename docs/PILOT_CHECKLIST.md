# TVC-PMS 시범 운영 체크리스트 (대명해운)

선박 1척 + 본사(HQ) 환경에서 Export/Import 라운드트립과 일상 업무를 검증합니다.

## 사전 준비

- [ ] `START-TVC-PMS.bat` 또는 `npm start` 로 **localhost:3000** 접속 (file:// 금지)
- [ ] 선박 PC·HQ PC 각각 동일 버전(v2.0.0) 배포
- [ ] 선박 `VESSEL_ID` = `TEST_V01` (**No1 Test Vessel**, 시범 기준선) 확인
- [ ] HQ Fleet에서 동일 선박 선택

## 1. Deck (갑판)

| # | 계정 | 작업 | 기대 결과 |
|---|------|------|-----------|
| 1 | `officer` / 0000 / Deck | Actual Plan에서 Report 제출 | PENDING 리포트 생성 |
| 2 | `captain` / 0000 / Deck | Report 승인 | APPROVED, Export 메뉴 표시 |
| 3 | `captain` | DECK Export ZIP | `TEST_V01_DECK_PMS_EXPORT_*.zip` 다운로드 |
| 4 | HQ `hq` | 동일 선박·DECK Import | 성공, Work History 반영 |
| 5 | HQ | DECK Export (HQ_TO_SHIP) | 피드백 ZIP 생성 |
| 6 | `captain` | HQ ZIP Import | 성공, Original Plan 잠금 해제(해당 시) |

## 2. Engine (기관)

| # | 계정 | 작업 | 기대 결과 |
|---|------|------|-----------|
| 1 | `engineer` / 0000 / Engine | Report 제출 | PENDING |
| 2 | `ce` / 0000 / Engine | Report 승인 | APPROVED |
| 3 | `ce` | SPARE Import XLS | ~1,346건 적재 |
| 4 | `ce` | SPARE Append / Modify / Delete | 권한 정상 (체크박스 다중 선택) |
| 5 | `ce` | ENGINE Export ZIP | `*_ENGINE_PMS_EXPORT_*.zip` |
| 6 | HQ | ENGINE Import → Export → Ship Import | 라운드트립 성공 |

## 3. 안전 검증 (Phase 0)

| # | 시나리오 | 기대 결과 |
|---|----------|-----------|
| 1 | 다른 선박 ZIP을 `TEST_V01` PC에 Import | **차단** — 선박 ID 불일치 메시지 |
| 2 | DECK ZIP을 ENGINE Import로 시도 | **차단** — 부서 불일치 |
| 3 | HQ에서 선박 A 선택 후 선박 B ZIP Import | **차단** |
| 4 | `officer`가 ENGINE job에 Report 제출 시도 | **차단** — DEPT_FORBIDDEN |
| 5 | vessel_id 없는/UNKNOWN ZIP | **차단** |

## 4. 자동 검증 (개발 PC)

```bash
npm run verify-all
```

## 5. 이슈 기록

| 일자 | 선박/부서 | 증상 | ZIP 파일명 | 조치 |
|------|-----------|------|------------|------|
| | | | | |

## 6. Go-live 전 확인

- [ ] 선박·HQ 모두 **vendor/** 로컬 라이브러리 로드 (인터넷 없이 SPARE/Sync 동작)
- [ ] 마지막 Export 일시·Sync History 화면 확인
- [ ] 백업: Export ZIP을 USB/공유 폴더에 보관
