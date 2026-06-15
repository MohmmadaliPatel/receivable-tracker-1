@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ===============================
echo Taxteck Email Auto - Initial Setup
echo ===============================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Download Node.js 20 or newer from https://nodejs.org/
  pause
  exit /b 1
)

echo Node version:
node -v
echo.

if not exist ".env" (
  if exist "env.ubuntu-server.example" (
    echo Creating .env from env.ubuntu-server.example ...
    copy /Y env.ubuntu-server.example .env >nul
  ) else (
    echo ERROR: env.ubuntu-server.example not found.
    pause
    exit /b 1
  )
  echo.
  echo IMPORTANT: Edit .env and set production values before continuing:
  echo   EMAIL_ACTION_JWT_SECRET  - 32+ random characters
  echo   CRON_API_SECRET          - 32+ random characters
  echo   NEXT_PUBLIC_APP_BASE_URL - must match BUILD_INFO.txt
  echo   DATABASE_URL             - SQLite path, e.g. file:./dev.db
  echo.
  echo Open .env in Notepad now? [Y/N]
  set /p OPEN_ENV=
  if /I "!OPEN_ENV!"=="Y" notepad .env
  echo.
  echo Press any key after saving .env to continue, or Ctrl+C to cancel.
  pause >nul
) else (
  echo .env already exists — skipping template copy.
)

echo.
echo Installing production dependencies ...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo ERROR: npm install failed.
  pause
  exit /b 1
)

echo.
echo Applying database migrations ...
call npm run db:migrate
if errorlevel 1 (
  echo ERROR: database migration failed.
  pause
  exit /b 1
)

echo.
echo Creating first administrator account (one-time seed) ...
set FORCE_SEED=1
call npm run db:seed
if errorlevel 1 (
  echo ERROR: database seed failed.
  pause
  exit /b 1
)

echo.
echo ===============================
echo Setup complete!
echo ===============================
echo.
echo 1. Save the admin password printed above.
echo 2. Run start.bat to launch the server.
echo 3. Open http://localhost:3002 and change the password immediately.
echo.
pause
