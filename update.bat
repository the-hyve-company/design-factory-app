@echo off
REM Design Factory - update
REM Windows: double-click this file.
REM Pulls the latest version from GitHub and refreshes dependencies.

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git is required to update. Install it from https://git-scm.com and run this again.
  pause
  exit /b 1
)

echo Updating Design Factory to the latest version...

REM First-time bootstrap: if this folder came from the v0.1.0 tarball
REM scaffolder there is no .git\ here. Initialize it as a real clone of
REM main so `git fetch + reset` works the same as for everyone else.
REM Generated work in projects\ is gitignored — left untouched.
if not exist ".git\" (
  echo No git history detected. Linking to the official repo for future updates...
  call git init
  call git remote add origin https://github.com/the-hyve-company/design-factory-app.git
)

REM Hard-sync to the official latest instead of `git pull`. A plain pull fails
REM when local history diverges (e.g. after a maintainer rewrite); reset always
REM lands cleanly. Generated work in projects\ is gitignored, so it is untouched.
call git fetch origin
call git reset --hard origin/main
call npm install
echo Done. Open start to launch the app.
pause
