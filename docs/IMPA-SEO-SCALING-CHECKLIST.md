# IMPA 카탈로그 단계적 확장 체크리스트 (→ ~50,000 URL)

Programmatic SEO용 `/store/:code` 페이지를 **한 번에 5만 URL로 올리지 않고**, 품질·크롤·색인을 보면서 단계적으로 늘리기 위한 운영 체크리스트입니다.

**관련 코드**

| 역할 | 경로 / 명령 |
|------|-------------|
| 카탈로그 병합 | `scripts/merge-impa-chapters.mjs` |
| SEO 인덱스 (서버리스 `/store`) | `scripts/generate-impa-seo-index.mjs` → `api/_data/impa-seo-index.json` |
| 사이트맵 (10,000 URL/파일) | `scripts/generate-sitemap.mjs` |
| 스토어 HTML / JSON-LD | `api/_lib/impaSeo.js` |
| 검증 | `npm run test:seo-sitemap`, `npm run test:store-seo` |
| 일괄 생성 | `npm run generate:impa-seo` (= index + sitemap) |

**GSC 용어**

- **사이트맵 «발견»**: 구글이 URL **목록**을 읽은 것 (검색 노출 ≠ 색인 완료).
- **색인**: `site:thevesselcode.com/store/812101` 등으로 확인.

---

## 1. 단계별 목표 (권장)

| 단계 | SEO 인덱스 코드 수 (약) | 비고 |
|------|-------------------------|------|
| **현재** | ~5,600 | 기준선 · GSC 사이트맵 성공 확인됨 |
| **Phase A** | ~15,000 | 1차 확장 · 크롤/색인 추이 1~2주 관찰 |
| **Phase B** | ~30,000 | GSC 색인 생성 페이지·오류율 안정 후 |
| **Phase C** | ~50,000 | 최종 목표 · `sitemap-store-1` ~ `5` 예상 |

각 Phase마다 **한 번의 배포 = 한 번의 사이트맵 증가**로 진행합니다. Phase 사이 **최소 1~2주** 간격을 두고 GSC를 봅니다.

---

## 2. 품질 게이트 (SEO 인덱스에 넣을 코드)

`generate-impa-seo-index.mjs`는 `impa-full.json`의 항목을 compact map으로 옮깁니다. **아래를 만족하는 행만** chapters/카탈로그에 포함하고, 불확실한 대량 raw dump는 Phase를 나눠 넣습니다.

| # | 조건 | 이유 |
|---|------|------|
| 1 | **IMPA 코드** 4~6자리 숫자, 정규화 후 유일 | 중복·잘못된 코드는 thin/duplicate URL |
| 2 | **`name` (설명)** 비어 있지 않음 | title / H1 / Product `name` |
| 3 | **`specs` 또는 unit/category** 중 최소 1개 이상 유의미 | 메타 description·표 스펙 |
| 4 | **플레이트** `plate_id` 또는 `PL-{chapter}-{segment}.webp` 실파일 존재 (가능하면) | `og:image` · Image Search; 없으면 Phase 후반으로 미루거나 fallback 명시 |
| 5 | **스팸·자동 생성 문구** 없음 (동일 description 대량 복제 등) | 대량 색인 저품질 신호 |

**선별 워크플로 (로컬)**

```bash
npm run generate:impa-seo   # merge는 test 스크립트가 호출함
node -e "const i=require('./api/_data/impa-seo-index.json'); console.log('count', i.count);"
```

Phase마다 **이전 count 대비 증가분**과 **샘플 20코드**를 스프레드시트에 기록해 두면 롤백·감사에 유리합니다.

---

## 3. 배포 전 체크리스트 (매 Phase 공통)

### 3.1 데이터

- [ ] 신규 IMPA 소스를 `public/data/chapters/*.json` 또는 정책에 맞는 경로에 반영
- [ ] `node scripts/merge-impa-chapters.mjs` 성공
- [ ] `public/data/impa-full.json` 항목 수가 **이번 Phase 목표**와 일치 (또는 그 이하)
- [ ] 품질 게이트 샘플 검수 (무작위 50코드 + 신규 청크 전체 스팟 체크)

### 3.2 SEO 아티팩트

- [ ] `npm run generate:impa-seo` (또는 `generate-impa-seo-index` + `generate-sitemap` 각각)
- [ ] `api/_data/impa-seo-index.json` **`count`** 확인
- [ ] `public/sitemap.xml` 인덱스에 **`sitemap-store-N.xml`** 개수 확인 (10,000 URL당 +1 파일)
- [ ] `public/robots.txt`에 **새 `sitemap-store-*.xml`** `Allow` + `Sitemap` 줄 자동 반영 확인 (`generate-sitemap.mjs`)

### 3.3 빌드·테스트

- [ ] `npm run test:seo-sitemap`
- [ ] `npm run test:store-seo`
- [ ] `npm run build` (0 error)
- [ ] 스테이징 또는 로컬에서 샘플 URL 3~5개:
  - `/store/812101` (기존)
  - 신규 청크에서 **무작위 2코드**
  - 플레이트 없는 경계 케이스 1코드 (있다면)

### 3.4 스토어 페이지 수동 확인 (샘플)

- [ ] `<title>` · canonical · `og:image`
- [ ] JSON-LD **Product 1건** + `offers` (GSC 리치 결과 **실시간 테스트**)
- [ ] 404 없음 (`/store/999999`는 404 유지)

### 3.5 Git / 배포

- [ ] `impa-seo-index` + sitemap + (필요 시) `impa-full` 커밋
- [ ] PR → `master` 머지 → Vercel 프로덕션 배포 완료 대기 (~1–2분)

---

## 4. 배포 후 GSC 체크리스트

### 4.1 사이트맵

- [ ] **Sitemaps** → `/sitemap.xml` · `/sitemap-store-*.xml` **성공**, «발견된 페이지» 수가 Phase 목표에 근접
- [ ] 새 `sitemap-store-2.xml` 등이 생긴 Phase면 GSC에 **파일 URL 직접 제출** (선택, 인덱스에 이미 있으면 생략 가능)

### 4.2 URL 검사 (대표 샘플)

- [ ] **실시간 테스트** → 제품 스니펫 / 판매자 목록 **유효** (심각 오류 0)
- [ ] **GOOGLE 색인** → «색인 생성 요청» (신규 대표 URL 5~10개, 전체 5만 푸시 불필요)

### 4.3 모니터링 (Phase 후 1~2주)

- [ ] **색인 생성 → 페이지** — `/store/` URL 증가 추세
- [ ] **색인 생성 → Sitemaps** — «색인생성됨» vs «발견됨» 비율
- [ ] **경험 → Google 검색 결과** — 노출·클릭 (홈은 별도; 스토어 URL은 코드 검색으로 유입)
- [ ] **개선사항 → 제품 스니펫** — invalid 항목 급증 없음

**검색 노출 확인**

```text
site:thevesselcode.com/store/
site:thevesselcode.com/store/812101
```

---

## 5. 인프라·한도 참고

| 항목 | 참고 |
|------|------|
| 사이트맵 청크 | `URLS_PER_SITEMAP = 10_000` (`scripts/generate-sitemap.mjs`) |
| 50k URL | `sitemap-store-1` … `sitemap-store-5` + `sitemap-core.xml` |
| Indexing API | `npm run push:indexing` — **일일 한도** 있음; 전량 5만 건 일괄 푸시 비권장 |
| `STORE_SEO_ORIGIN` | 프로덕션 canonical은 `https://www.thevesselcode.com` (Vercel env) |

---

## 6. 롤백

1. Git에서 **이전 Phase 커밋**의 `impa-seo-index.json` + `sitemap-*.xml` 복원  
2. `npm run generate:impa-seo` 재실행 후 `count` 확인  
3. `npm run build` → 배포  
4. GSC 사이트맵 재읽기 (발견 수 감소는 며칠 지연 가능)  
5. 이미 색인된 URL은 **즉시 사라지지 않음** — `noindex`는 사용하지 않는 전제 (카탈로그 유지)

---

## 7. 하지 말 것

- [ ] **품질 게이트 없이** 하룻밤에 5만 코드 SEO 인덱스에 일괄 반영  
- [ ] JSON-LD에 **가짜 `review` / `aggregateRating`**  
- [ ] 동일 description·스펙 **대량 복제** 페이지  
- [ ] 사이트맵만 늘리고 **내부 링크**(홈·툴킷 Popular IMPA 등) 갱신 없음  
- [ ] GSC «발견»을 **검색 1페이지**와 동일시

---

## 8. Phase 완료 기록 (템플릿)

각 Phase 종료 시 아래를 PR 설명 또는 내부 로그에 남깁니다.

```markdown
### IMPA SEO Phase __ (YYYY-MM-DD)
- SEO index count: ______ (이전: ______)
- Sitemap files: sitemap-store-1 … store-__
- Deploy: commit ______ / PR #__
- GSC discovered: ______
- Sample indexed (manual): store/______, store/______
- Issues: none / …
- Next phase earliest date: ______
```

---

## 9. 홈·브랜드 검색과의 관계

- **5만 `/store/` URL**은 주로 **IMPA 코드·부품명 긴 꼬리** 유입용입니다.  
- **관련 검색어 1페이지 홈**은 도메인 권위·백링크·서비스 콘텐츠·체류 시간이 필요하며, 사이트맵 확장과 **별도 트랙**으로 `Services`, `SM`, `toolkit`, `contact-us`를 유지·강화합니다.

---

*마지막 정리: 2026-09-12 · THE VESSEL CODE programmatic SEO 운영*
