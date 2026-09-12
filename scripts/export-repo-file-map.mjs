#!/usr/bin/env node
/**
 * Repo folder/file map for Excel (UTF-8 BOM CSV).
 * Run: node scripts/export-repo-file-map.mjs
 * Output: docs/exports/TVC_File_Map.csv
 */
import { writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'docs', 'exports', 'TVC_File_Map.csv');

/** @type {{ path: string, category: string, role: string, attention: string }[]} */
const ENTRIES = [
  { path: '.github/workflows/', category: 'CI/CD', role: 'GitHub Actions — Vercel 배포, IMPA 수집, Electron 빌드 등 자동화', attention: '보통 무시' },
  { path: 'AGENTS.md', category: '문서', role: 'Cursor/Gemini용 개발 가이드 (어디를 수정할지, 테스트 방법)', attention: 'AI 협업 시 참고' },
  { path: 'README.md', category: '문서', role: '로컬 실행(npm start), 프로젝트 개요', attention: '가끔 확인' },
  { path: 'docs/', category: '문서', role: 'UI 맵, 워크플로, RBAC, 모바일 UX, Gemini 협업 메모', attention: '기능 설명·인수인계' },
  { path: 'docs/UI-MAP.md', category: '문서', role: '화면·모달·메뉴 구조 단일 진실 원천', attention: 'UI 변경 시 업데이트' },
  { path: 'docs/workflow-manual-v1.md', category: '문서', role: '리포트·승인·ZIP 동기화 업무 흐름', attention: '운영·교육' },
  { path: 'docs/exports/', category: '문서', role: 'Gemini/엑셀용 export 결과물 (CSV, txt)', attention: '생성물 보관' },

  { path: 'home/', category: '마케팅 웹', role: 'thevesselcode.com 홈 (/) — 회사 소개 랜딩', attention: '문구·CTA 수정' },
  { path: 'sm/', category: '마케팅 웹', role: 'TVC-SM 소개 페이지 (/sm)', attention: '문구·CTA 수정' },
  { path: 'services/', category: '마케팅 웹', role: '서비스 소개 (/services)', attention: '가끔' },
  { path: 'contact-us/', category: '마케팅 웹', role: '문의 폼 (/contact-us)', attention: '가끔' },
  { path: 'about-contact/', category: '마케팅 웹', role: '레거시 경로 — contact-us로 리다이렉트', attention: '거의 무시' },
  { path: 'toolkit.html', category: '마케팅 웹', role: 'Maritime Toolkit / IMPA (/toolkit)', attention: '가끔' },
  { path: 'js/marketing-shell.js', category: '마케팅 웹', role: '공통 상단 네비·푸터 (Home, Services, TVC-SM, Contact)', attention: '메뉴 링크' },
  { path: 'css/home.css', category: '마케팅 웹', role: '랜딩·SM 페이지 스타일', attention: '디자인' },
  { path: 'vercel.json', category: '배포', role: 'Vercel 라우팅: /, /sm, app 호스트, 리다이렉트', attention: 'URL 변경 시' },
  { path: 'public/', category: '배포·SEO', role: 'sitemap, robots.txt, 대용량 IMPA JSON (빌드 시 dist로 복사)', attention: 'SEO·스토어 URL' },
  { path: 'bluehost/', category: '배포', role: 'Bluehost 수동 업로드용 HTML 스냅샷 (iframe 등)', attention: 'Bluehost만' },

  { path: 'index.html', category: 'TVC-SM 앱', role: '★ 로그인 후 PMS+SPARE 앱 껍데기 (app.thevesselcode.com / 로컬 :3000)', attention: '핵심' },
  { path: 'js/app.js', category: 'TVC-SM 앱', role: '★ 메인 UI 오케스트레이션 (메뉴, 리포트, 모달)', attention: '핵심' },
  { path: 'js/auth.js', category: 'TVC-SM 앱', role: '로그인·세션·데모 계정 시드', attention: '계정/비밀번호' },
  { path: 'js/rbac.js', category: 'TVC-SM 앱', role: '권한·역할·부서 범위', attention: '핵심' },
  { path: 'js/space.js', category: 'TVC-SM 앱', role: 'Master/Deck/Engine/Captain 스테이션 모드', attention: '선박 UX' },
  { path: 'js/config.js', category: 'TVC-SM 앱', role: '환경·embed·웹 HQ 설정', attention: '가끔' },
  { path: 'js/pms.js', category: 'TVC-SM 앱', role: 'PMS 스케줄·런아워 헬퍼 (리포트 UI 아님)', attention: '주의: 폼은 app.js' },
  { path: 'js/core/db.js', category: 'TVC-SM 앱', role: 'IndexedDB 연결·업그레이드', attention: '데이터 구조' },
  { path: 'js/core/schema.js', category: 'TVC-SM 앱', role: 'IndexedDB 스키마·DB_VERSION', attention: '데이터 구조' },
  { path: 'js/core/legacySm.js', category: 'TVC-SM 앱', role: 'HQ→SM 레거시 필드 정규화', attention: '동기화' },
  { path: 'js/ui/spareMenu.js', category: 'TVC-SM 앱', role: 'SPARE 인벤토리·소비 UI', attention: '핵심' },
  { path: 'js/ui/defectReport.js', category: 'TVC-SM 앱', role: 'Defect Report UI', attention: '핵심' },
  { path: 'js/ui/workPermit.js', category: 'TVC-SM 앱', role: 'Work Permit UI', attention: '핵심' },
  { path: 'js/ui/supplierWorkspace.js', category: 'TVC-SM 앱', role: '공급사 포털 워크스페이스', attention: 'RFQ·견적' },
  { path: 'js/ui/rfqWorkspace.js', category: 'TVC-SM 앱', role: 'SM RFQ → 공급사 토스 UI', attention: 'RFQ' },
  { path: 'js/services/transaction.js', category: 'TVC-SM 앱', role: '리포트 확인·스톡 차감 규칙', attention: '핵심' },
  { path: 'js/services/inventoryService.js', category: 'TVC-SM 앱', role: '원자적 스톡 소비', attention: '핵심' },
  { path: 'js/services/sync.js', category: 'TVC-SM 앱', role: 'ZIP보내기/가져오기 동기화', attention: '선박↔본사' },
  { path: 'js/services/supplierRfqPipeline.js', category: 'TVC-SM 앱', role: 'RFQ·견적·PO 파이프라인', attention: 'RFQ' },
  { path: 'css/app.css', category: 'TVC-SM 앱', role: '앱 전체 스타일 (모바일 @768px)', attention: 'UI' },
  { path: 'service-worker.js', category: 'TVC-SM 앱', role: 'PWA·오프라인 캐시', attention: '배포 시' },
  { path: 'data/pms-unified.json', category: 'TVC-SM 앱', role: 'PMS 마스터 시드 (Excel import 결과)', attention: '초기 데이터' },

  { path: 'admin/', category: '운영·Admin', role: '회사/선박 registry JSON, 계약 템플릿', attention: '신규 고객 세팅' },
  { path: 'admin/registry.json', category: '운영·Admin', role: 'Admin Mode 회사·선박 목록', attention: '신규 고객' },
  { path: 'electron/', category: '데스크톱', role: 'Electron 앱 (선박 PC 설치본, 라이선스 게이트)', attention: '배포·라이선스' },
  { path: 'downloads/', category: '데스크톱', role: 'Vessel Mode 설치 exe (manifest)', attention: '다운로드 링크' },

  { path: 'api/', category: '클라우드 API', role: 'Vercel serverless (store SEO, sync, feedback 등)', attention: '웹 HQ·스토어' },
  { path: 'scripts/', category: '도구', role: '빌드·테스트·IMPA·sitemap·라이선스 유틸', attention: '명령만 실행' },
  { path: 'scripts/vercel-static-build.mjs', category: '도구', role: 'npm run build → dist/ 생성', attention: '배포 전' },
  { path: 'scripts/export-repo-file-map.mjs', category: '도구', role: '이 CSV 파일 지도 생성', attention: '엑셀용' },
  { path: 'e2e/', category: '테스트', role: 'Playwright E2E', attention: 'QA' },
  { path: 'TEST_REPORT.md', category: '테스트', role: 'E2E 골든 패스 기록', attention: 'QA' },

  { path: 'dist/', category: '빌드 결과', role: 'npm run build 출력 — Git에 올리지 않음, Vercel이 생성', attention: '직접 수정 금지' },
  { path: 'node_modules/', category: '의존성', role: 'npm 패키지 — 자동 설치', attention: '무시' },
  { path: 'release/', category: '릴리스', role: '버전별 handoff txt/json (내부 전달)', attention: '히스토리' },
  { path: 'src/', category: '소스(미러)', role: '일부 RBAC/DB TypeScript 미러 — 브라우저는 js/ 사용', attention: '보통 js/ 우선' },
  { path: 'database/schema.sql', category: '참고', role: 'Postgres 스키마 참고 (선박은 IndexedDB)', attention: '참고만' },
  { path: 'deploy/', category: '배포', role: 'Bluehost/Vercel 배포 스크립트·env 예시', attention: '배포 담당' },
];

function escapeCsv(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const header = ['대분류', '경로', '존재', '역할 설명', '대표님 체크'];
const rows = ENTRIES.map((e) => {
  const full = join(root, e.path.replace(/\/$/, ''));
  const exists = existsSync(full);
  let existsLabel = exists ? '있음' : '없음';
  if (exists) {
    try {
      existsLabel = statSync(full).isDirectory() ? '폴더' : '파일';
    } catch { /* keep */ }
  }
  return [e.category, e.path, existsLabel, e.role, e.attention].map(escapeCsv).join(',');
});

const bom = '\uFEFF';
writeFileSync(out, bom + header.map(escapeCsv).join(',') + '\n' + rows.join('\n') + '\n', 'utf8');
console.log('OK', out, `(${rows.length} rows)`);
