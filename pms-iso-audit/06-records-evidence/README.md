# 06 — 기록·증빙 (Records & Evidence)

심사 시 제시할 **기록 사본**을 보관합니다.

## 폴더

| 경로 | 용도 | Git |
|------|------|-----|
| `incoming/` | PDF·스캔·계약서·export ZIP 등 **민감 파일** | ❌ 제외 (`.gitignore`) |
| `indexed/` | 목록만 관리하는 메타데이터 (선택) | ✅ 가능 |

## incoming 사용법

```bash
# 예: 선박에서 export한 Work Report ZIP
cp ~/Downloads/INCHEON_CHEMI_export.zip pms-iso-audit/06-records-evidence/incoming/
```

`incoming/INDEX.md`에 파일명·날짜·설명만 기록하고, 실제 파일은 커밋하지 않습니다.

## TVC-PMS 증빙 매핑

| 앱 기능 | 증빙 유형 | ISO 관점 |
|---------|-----------|----------|
| Work Report Save/Confirm | export ZIP | 운영 기록 (8.5) |
| Defect Report | export ZIP | 부적합·개선 추적 |
| RBAC / 역할 | `verify-rbac` 결과 | 접근 통제 (7.1) |
| Sync import/export | xfer 로그 | 데이터 무결성 |
