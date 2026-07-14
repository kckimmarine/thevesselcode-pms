@echo off
chcp 65001 >nul
cd /d "%~dp0"
title TVC-PMS — THE VESSEL CODE

echo.
echo  ⚓ THE VESSEL CODE — TVC-PMS
echo  ─────────────────────────────
echo  브라우저: http://localhost:3000
echo.
echo  ※ index.html 더블클릭(file://)과는 데이터가 다릅니다.
echo     이 배치 파일로 실행해야 재고 Import가 정상 동작합니다.
echo.
echo  (이 창을 닫으면 서버가 종료됩니다)
echo.

REM 서버 기동 후 Chrome 앱 모드로 브라우저 열기 (2초 대기)
start /min cmd /c "ping -n 3 127.0.0.1>nul && start chrome --app=http://localhost:3000 --window-size=1200,800"

npx --yes serve . -p 3000

pause
