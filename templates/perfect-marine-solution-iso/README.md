# PERFECT MARINE SOLUTION — ISO 심사 (온라인 모드)

**PERFECT MARINE SOLUTION (PMS)** ISO 인증·심사 문서를 **웹에서 관리**하는 전용 저장소입니다.

| | |
|---|---|
| **이 repo** | 회사 ISO 심사 (온라인 포털 + Supabase) |
| **thevesselcode-pms** | THE VESSEL CODE 선박 PMS **소프트웨어** (별도 repo) |

## 온라인 모드 기능

- **문서 대장** — Doc ID, Rev, 승인 상태
- **심사 체크리스트** — 항목별 완료·메모
- **시정조치 (CAR)** — 추적
- **증빙 업로드** — Supabase Storage (`iso-evidence` 버킷)

## 빠른 시작

```bash
npm install
npm run setup:supabase   # Supabase SQL·버킷 안내
# portal/js/config.js 에 URL·anon key 입력
npm start                # http://localhost:3010
```

## 배포 (Vercel)

1. GitHub에 이 repo push (Private 권장)
2. Vercel → Import → **Root Directory: `portal`**
3. (선택) Environment variables로 Supabase 키 주입 후 `config.js` 빌드 스크립트 연동

## 로컬 Markdown 백업 (선택)

`content/` 폴더에 절차서·매뉴얼 Markdown을 보관할 수 있습니다. **주 관리는 온라인 포털**입니다.

## TVC-PMS 연계

선박 Work Report export ZIP → 포털 **증빙** 탭에서 업로드 (심사 증빙).

## 보안

- TVC-PMS **프로덕션 Supabase와 분리**된 프로젝트 사용
- `iso-evidence` 버킷은 Private + RLS
- Collaborator는 품질·경영 담당자만
