@echo off
title TVC-PMS Web Demo (HQ Portal preview)
cd /d "%~dp0"
echo.
echo  THE VESSEL CODE — Web HQ Demo
echo  ----------------------------------------
echo   URL: http://localhost:3000/?web=1
echo.
echo   Daemyung HQ : dm_user@thevesselcode.com / 0000
echo   Super Admin : admin@thevesselcode.com / 0000
echo   Local embed test: http://localhost:3000/?web=1^&embed=1
echo   Bluehost PMS tab : upload bluehost/pms/index.html -^> thevesselcode.com/pms/
echo.
start "" "http://localhost:3000/?web=1"
call npm start
