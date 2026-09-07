# PERFECT MARINE SOLUTION — ISO 심사 서류

회사 **PERFECT MARINE SOLUTION (PMS)** 의 ISO 인증·심사 관련 문서를 **TVC-PMS 앱 코드와 분리**하여 관리하는 폴더입니다.

> **이 폴더는 Bluehost 배포·마케팅 사이트(`deploy/`, `bluehost/`)와 무관합니다.**

## 빠른 시작

| 작업 | 위치 |
|------|------|
| 심사 전 체크 | [`AUDIT-CHECKLIST.md`](AUDIT-CHECKLIST.md) |
| 문서 목록·버전 관리 | [`DOCUMENT-REGISTER.md`](DOCUMENT-REGISTER.md) |
| 회사·인증 범위 설정 | [`config.json`](config.json) |
| 실제 PDF/스캔 업로드 | `06-records-evidence/incoming/` (git 제외) |
| 양식·템플릿 | `05-forms-templates/templates/` |

## 폴더 구조

```
pms-iso-audit/
├── README.md                    ← 이 파일
├── config.json                  ← 회사명, 인증 표준, 심사 일정
├── DOCUMENT-REGISTER.md         ← 관리 문서 대장
├── AUDIT-CHECKLIST.md           ← 심사 준비 체크리스트
├── 01-scope-context/            ← 범위·조직·이해관계자
├── 02-management-system/        ← 품질/환경/안전 매뉴얼
├── 03-procedures/               ← 절차서 (SOP)
├── 04-work-instructions/        ← 작업지침서
├── 05-forms-templates/          ← 양식·템플릿
├── 06-records-evidence/         ← 기록·증빙 (incoming은 로컬만)
├── 07-internal-audit/           ← 내부심사
├── 08-corrective-actions/       ← 시정·예방조치 (CAR)
└── 09-certification/            ← 인증서·외부심사 보고서
```

## TVC-PMS와의 관계

| 구분 | 경로 | 용도 |
|------|------|------|
| **회사 ISO 심사** | `pms-iso-audit/` | PMS 조직의 인증·심사 문서 |
| **선박 PMS 앱** | `js/`, `index.html` 등 | THE VESSEL CODE 소프트웨어 |
| **웹 배포** | `deploy/`, `bluehost/` | 마케팅·embed 사이트 |

선박에서 생성되는 Work Report·Defect Report 등 **운영 기록**은 앱에서 export한 ZIP을 `06-records-evidence/`에 **증빙 사본**으로 보관할 수 있습니다. (원본은 선박·HQ 동기화 정책을 따름)

## AI·협업 시

- ISO 문서 작업은 **이 폴더만** 수정합니다. `js/app.js` 등 앱 코드는 심사 서류 요청과 무관하면 건드리지 않습니다.
- 민감 정보(계약서, 개인정보, 미공개 수치)는 `incoming/`에 두고 **커밋하지 않습니다**.
- 문서 추가·개정 시 `DOCUMENT-REGISTER.md` 버전과 개정일을 함께 갱신합니다.
