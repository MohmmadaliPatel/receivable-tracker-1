@echo off
cd /d "%~dp0"

if not exist ".env" (
  echo ERROR: .env not found. Run setup.bat first.
  pause
  exit /b 1
)

if not exist "server.js" (
  echo ERROR: server.js not found. This package must be the standalone client release.
  pause
  exit /b 1
)

echo ===============================
echo Starting Taxteck Email Auto
echo ===============================
echo Port: 3002  ^|  Press Ctrl+C to stop
echo.

set NODE_ENV=production
set PORT=3002

node server.js

echo.
echo Server stopped.
pause
