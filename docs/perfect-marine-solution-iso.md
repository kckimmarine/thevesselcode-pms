# PERFECT MARINE SOLUTION — ISO 심사 (별도 저장소)

**PERFECT MARINE SOLUTION** 회사의 ISO 인증·심사 서류는 **이 저장소(`thevesselcode-pms`)와 분리**하여 관리합니다.

| 저장소 | 주제 | Cursor 채팅 |
|--------|------|-------------|
| `kckimmarine/thevesselcode-pms` | THE VESSEL CODE 선박 PMS **소프트웨어** | 앱·배포·E2E |
| `kckimmarine/perfect-marine-solution-iso` *(신규)* | PMS 회사 **ISO 심사 문서** | 「Pms iso 심사 서류」 |

## 새 저장소 만들기 (1회)

GitHub에서 **New repository** → 이름 예: `perfect-marine-solution-iso` (Private 권장)

로컬에서 초기 구조 복사:

```bash
# thevesselcode-pms PR/브랜치에 있던 ISO 템플릿을 새 repo로
git clone https://github.com/kckimmarine/thevesselcode-pms.git _tmp-tvc
cd _tmp-tvc
git checkout cursor/pms-iso-audit-folder-1cae   # 또는 merge 후 master
cp -a pms-iso-audit/. ../perfect-marine-solution-iso/
cd ../perfect-marine-solution-iso
# 루트에 파일이 있도록: mv pms-iso-audit/* . && rmdir pms-iso-audit  (이미 루트 구조면 생략)
git init && git add -A && git commit -m "Initial ISO audit document structure"
git remote add origin git@github.com:kckimmarine/perfect-marine-solution-iso.git
git push -u origin master
```

또는 Cursor에서 **File → Open Folder**로 새 repo만 열고, ISO 관련 채팅은 그 프로젝트에서만 진행합니다.

## TVC-PMS와 연결

- 심사 **증빙**으로 선박 Work Report export ZIP을 ISO repo의 `06-records-evidence/incoming/`에 보관 (git 제외, `INDEX.md`만 커밋).
- 앱 **사용자 매뉴얼**은 이 repo의 `docs/workflow-manual-v1.md`를 참조.

## 왜 분리하나

- 접근 권한: 개발자 vs 품질·경영 (다른 Collaborator)
- 릴리스 주기: 앱 버전과 문서 Rev 무관
- Cursor/Agent: 채팅·컨텍스트가 소프트웨어와 섞이지 않음
