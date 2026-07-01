@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
set "ROOT=%CD%"

REM ============================================================================
REM  Taxteck Email Auto — build client delivery package and push to GitHub
REM
REM  Requires: Node.js 20+, Git for Windows (bash.exe for build + rsync)
REM
REM  Optional environment variables (set before running):
REM    NEXT_PUBLIC_APP_BASE_URL  Public URL baked into build (default below)
REM    CLIENT_DELIVERY_DIR       Git clone/worktree for client-delivery branch
REM    SKIP_MAIN_PUSH=1          Do not offer to commit/push source on main
REM    SKIP_SMOKE_TEST=1         Skip fresh-install migrate/seed smoke test
REM    COMMIT_MSG                Custom client-delivery commit message
REM
REM  Usage:
REM    scripts\publish-client-release.bat
REM
REM  Custom client worktree path (example):
REM    set CLIENT_DELIVERY_DIR=E:\HSDR Job\receivable-tracker-1-cl-worktree
REM    scripts\publish-client-release.bat
REM ============================================================================

if not defined NEXT_PUBLIC_APP_BASE_URL set "NEXT_PUBLIC_APP_BASE_URL=https://confirm.example.com"
if not defined CLIENT_DELIVERY_DIR set "CLIENT_DELIVERY_DIR=%ROOT%\..\email-auto-client-delivery"
set "STAGING=%ROOT%\client-release-staging"
set "CLIENT_REMOTE=https://github.com/MohmmadaliPatel/receivable-tracker-1-cl.git"
set "ORIGIN_REMOTE=https://github.com/MohmmadaliPatel/receivable-tracker-1.git"
set "BASH="

echo.
echo ============================================================
echo  Publish client delivery package
echo ============================================================
echo  Source repo:     %ROOT%
echo  Client worktree: %CLIENT_DELIVERY_DIR%
echo  Build URL:       %NEXT_PUBLIC_APP_BASE_URL%
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install Node.js 20+ from https://nodejs.org/
  exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: Git not found. Install Git for Windows from https://git-scm.com/
  exit /b 1
)

if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH (
  echo ERROR: Git Bash not found. npm run client:prepare requires bash.exe.
  exit /b 1
)

echo Node:
node -v
echo.

for /f "delims=" %%H in ('git rev-parse --short HEAD') do set "MAIN_SHA=%%H"

if not "%SKIP_MAIN_PUSH%"=="1" (
  git status --porcelain | findstr /R "." >nul 2>&1
  if not errorlevel 1 (
    echo Uncommitted source changes detected on main.
    set /p PUSH_MAIN=Commit and push to origin/main before client build? [Y/N]: 
    if /I "!PUSH_MAIN!"=="Y" (
      set /p MAIN_MSG=Commit message for main: 
      if "!MAIN_MSG!"=="" set "MAIN_MSG=Update source before client delivery build."
      git add -A
      git commit -m "!MAIN_MSG!"
      if errorlevel 1 (
        echo ERROR: git commit failed on main.
        exit /b 1
      )
      git push origin main
      if errorlevel 1 (
        echo ERROR: git push origin main failed.
        exit /b 1
      )
      for /f "delims=" %%H in ('git rev-parse --short HEAD') do set "MAIN_SHA=%%H"
      echo Main branch pushed at !MAIN_SHA!
      echo.
    )
  )
)

echo ==^> Building client release package...
set "NEXT_PUBLIC_APP_BASE_URL=%NEXT_PUBLIC_APP_BASE_URL%"
call npm run client:prepare
if errorlevel 1 (
  echo ERROR: client:prepare failed.
  exit /b 1
)

if not exist "%STAGING%\server.js" (
  echo ERROR: Build staging folder missing server.js
  exit /b 1
)

if exist "%STAGING%\node_modules" rmdir /s /q "%STAGING%\node_modules"
if exist "%STAGING%\dev.db" del /f /q "%STAGING%\dev.db"
if exist "%STAGING%\.env" del /f /q "%STAGING%\.env"

echo ==^> Updating package-lock.json in staging...
pushd "%STAGING%"
call npm install --omit=dev --no-audit --no-fund --package-lock-only
if errorlevel 1 (
  echo ERROR: npm install --package-lock-only failed.
  popd
  exit /b 1
)
popd

if not "%SKIP_SMOKE_TEST%"=="1" (
  echo ==^> Smoke test: fresh install, migrate, seed...
  pushd "%STAGING%"
  (
    echo NODE_ENV=production
    echo DATABASE_URL="file:./dev.db"
    echo EMAIL_ACTION_JWT_SECRET=smoke-test-secret-at-least-32-chars-long
    echo NEXT_PUBLIC_APP_BASE_URL=%NEXT_PUBLIC_APP_BASE_URL%
    echo CRON_API_SECRET=smoke-test-cron-secret-long-enough
    echo DEMO_MODE=false
  ) > .env
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 goto smoke_fail
  call npm run db:migrate
  if errorlevel 1 goto smoke_fail
  set FORCE_SEED=1
  call npm run db:seed
  if errorlevel 1 goto smoke_fail
  if exist node_modules rmdir /s /q node_modules
  if exist dev.db del /f /q dev.db
  if exist .env del /f /q .env
  popd
  echo Smoke test passed.
  echo.
  goto smoke_done
)

:smoke_done

git -C "%CLIENT_DELIVERY_DIR%" rev-parse --is-inside-work-tree >nul 2>&1
if not errorlevel 1 goto worktree_ok

echo Client delivery git worktree not found at:
echo   %CLIENT_DELIVERY_DIR%
echo.
set /p CLONE_CLIENT=Clone client-delivery worktree there? [Y/N]: 
if /I not "!CLONE_CLIENT!"=="Y" (
  echo Set CLIENT_DELIVERY_DIR to your client-delivery git clone and re-run.
  exit /b 1
)
if exist "%CLIENT_DELIVERY_DIR%" (
  echo ERROR: %CLIENT_DELIVERY_DIR% already exists and is not a git worktree.
  exit /b 1
)
git clone -b client-delivery "%ORIGIN_REMOTE%" "%CLIENT_DELIVERY_DIR%"
if errorlevel 1 (
  git clone "%CLIENT_REMOTE%" "%CLIENT_DELIVERY_DIR%"
  if errorlevel 1 (
    echo ERROR: Could not clone client worktree.
    exit /b 1
  )
  pushd "%CLIENT_DELIVERY_DIR%"
  git fetch origin client-delivery 2>nul
  git checkout client-delivery 2>nul
  if errorlevel 1 git checkout -b client-delivery
  popd
)

:worktree_ok
echo Using client worktree: %CLIENT_DELIVERY_DIR%
echo.

echo ==^> Syncing staging to client worktree...
for /f "delims=" %%P in ('"%BASH%" -lc "cygpath -u '%STAGING%'"') do set "STAGING_UNIX=%%P"
for /f "delims=" %%P in ('"%BASH%" -lc "cygpath -u '%CLIENT_DELIVERY_DIR%'"') do set "WT_UNIX=%%P"
"%BASH%" -lc "rsync -a --delete --exclude='.git' --exclude='node_modules' '!STAGING_UNIX!/' '!WT_UNIX!/'"
if errorlevel 1 (
  echo ERROR: rsync failed. Ensure Git for Windows includes rsync, or sync manually.
  exit /b 1
)

pushd "%CLIENT_DELIVERY_DIR%"
git remote get-url client >nul 2>&1
if errorlevel 1 git remote add client "%CLIENT_REMOTE%"
git remote get-url origin >nul 2>&1
if errorlevel 1 git remote add origin "%ORIGIN_REMOTE%"

set "BUILD_LINE="
if exist BUILD_INFO.txt for /f "delims=" %%B in ('findstr /B "Built:" BUILD_INFO.txt') do set "BUILD_LINE=%%B"

git status --porcelain | findstr /R "." >nul 2>&1
if errorlevel 1 (
  echo No changes in client worktree — skipping commit.
  goto push_client
)

if defined COMMIT_MSG (
  set "CLIENT_MSG=!COMMIT_MSG!"
) else (
  set "CLIENT_MSG=Client delivery package: production standalone rebuild synced from main (!MAIN_SHA!)."
  if defined BUILD_LINE set "CLIENT_MSG=!CLIENT_MSG! !BUILD_LINE!"
)

git add -A
git commit -m "!CLIENT_MSG!"
if errorlevel 1 (
  echo ERROR: git commit failed in client worktree.
  popd
  exit /b 1
)

:push_client
echo ==^> Pushing client-delivery to origin...
git push origin client-delivery
if errorlevel 1 (
  echo ERROR: push to origin/client-delivery failed.
  popd
  exit /b 1
)

echo ==^> Pushing to client repo (main)...
git push client client-delivery:main
if errorlevel 1 (
  echo ERROR: push to client repo failed.
  popd
  exit /b 1
)

for /f "delims=" %%C in ('git log -1 --oneline') do set "CLIENT_COMMIT=%%C"
popd

echo.
echo ============================================================
echo  Done!
echo ============================================================
echo  Main SHA:      !MAIN_SHA!
echo  Client commit: !CLIENT_COMMIT!
echo  Client repo:   %CLIENT_REMOTE% (branch: main)
echo  Origin branch: client-delivery
echo ============================================================
echo.
pause
exit /b 0

:smoke_fail
echo ERROR: Smoke test failed (migrate/seed).
popd
exit /b 1
