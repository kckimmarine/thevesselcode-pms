@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TVC-PMS — THE VESSEL CODE

echo.
echo  ⚓ THE VESSEL CODE — TVC-PMS (개발용 로컬 서버)
echo  ─────────────────────────────
echo  브라우저: http://localhost:3000
echo.
echo  ※ Pilot/현장 배포는 Electron 설치본(npm run dist)을 사용하세요.
echo  ※ index.html 더블클릭(file://)과는 데이터가 다릅니다.
echo.
echo  (이 창을 닫으면 서버가 종료됩니다)
echo.

REM 서버 기동 후 Chrome/Edge 앱 모드 — 화면 작업영역의 약 78%% × 88%%, 가운데 정렬
start /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-tvc-window.ps1"

npx --yes serve . -p 3000

pause
