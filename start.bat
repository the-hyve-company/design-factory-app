@echo off
REM Design Factory - start
REM Windows: double-click this file.
REM Installs dependencies on the first run, builds the optimized app, then
REM launches it and opens your browser at http://localhost:1420.
REM (Contributors who want the hot-reload dev server: npm run dev:web)

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies. This can take a minute...
  call npm install
)

echo Starting Design Factory. The first run builds the app, then the browser opens on its own.
echo Leave this window open while you work. Close it or press Ctrl+C to stop.
call npm start
pause
