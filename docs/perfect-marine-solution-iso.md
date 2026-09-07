# PERFECT MARINE SOLUTION — ISO 심사 (온라인 모드)

**PERFECT MARINE SOLUTION** ISO 심사는 `thevesselcode-pms`와 **별도 GitHub 저장소**에서 **온라인 포털**로 관리합니다.

| 저장소 | 주제 | 관리 방식 |
|--------|------|-----------|
| `kckimmarine/thevesselcode-pms` | TVC-PMS **소프트웨어** | 이 Cursor 프로젝트 |
| `kckimmarine/perfect-marine-solution-iso` | PMS **ISO 심사** | **별도 repo + 웹 포털** |

## 1. 새 저장소 생성 (1회)

```bash
cd thevesselcode-pms
./scripts/bootstrap-perfect-marine-iso-repo.sh ../perfect-marine-solution-iso
cd ../perfect-marine-solution-iso
npm install
npm run setup:supabase
```

## 2. Supabase (전용 프로젝트)

**쉬운 방법 (추천):** bootstrap 후 [`docs/쉬운-설정.md`](templates/perfect-marine-solution-iso/docs/쉬운-설정.md) — SQL Editor + Authentication만 사용. **DATABASE_URL 불필요.**

자동 설정: `npm run setup:apply` — [`docs/SUPABASE-SETUP.md`](templates/perfect-marine-solution-iso/docs/SUPABASE-SETUP.md)

## 4. 온라인 배포 (Vercel)

1. `perfect-marine-solution-iso` repo를 Vercel에 Import
2. **Root Directory = `portal`**
3. 팀원은 브라우저에서 로그인 → 문서·체크리스트·CAR·증빙 관리

## 5. Cursor에서 분리 (별도 터미널·채팅)

**가이드:** [`templates/perfect-marine-solution-iso/docs/CURSOR-별도-프로젝트.md`](../templates/perfect-marine-solution-iso/docs/CURSOR-별도-프로젝트.md)

1. GitHub에 `kckimmarine/perfect-marine-solution-iso` 생성 (Private)
2. bootstrap 후 push, 또는 clone
3. Cursor **File → Open Folder** → `perfect-marine-solution-iso` (**이 repo 아님**)
4. 새 채팅 **「Pms iso 심사 서류」** → 터미널 `npm start` (:3010)

- ISO 작업: **perfect-marine-solution-iso** 전용 Cursor 창
- 앱 작업: `thevesselcode-pms` (이 repo, :3000)

`pms-iso-online/`은 앱 repo 안 **빠른 테스트용** 복사본입니다. 장기 운영은 별도 repo를 사용하세요.

## 템플릿 위치 (이 repo)

소스: [`templates/perfect-marine-solution-iso/`](../templates/perfect-marine-solution-iso/)

bootstrap 스크립트가 위 템플릿을 새 repo로 복사합니다.

## TVC-PMS 연계

선박 Work Report export ZIP → ISO 포털 **증빙** 탭 업로드 (심사 증빙).
