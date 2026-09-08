@echo off
set PATH=C:\Users\HP\scoop\apps\nodejs\24.4.1;%PATH%
set NODE_OPTIONS=--experimental-sqlite
cd /d C:\Users\HP\Desktop\AgentGuard

echo Starting AgentGuard dev environment...
echo.

echo [1/2] Starting sidecar (port 9559)...
start "AgentGuard Sidecar" /min cmd /c "set NODE_OPTIONS=--experimental-sqlite && cd /d C:\Users\HP\Desktop\AgentGuard\packages\sidecar && call npx tsx src/server.ts"

timeout /t 5 /nobreak >nul

echo [2/2] Starting dashboard (port 5173)...
start "AgentGuard Dashboard" /min cmd /c "cd /d C:\Users\HP\Desktop\AgentGuard\packages\dashboard && call npx vite"

timeout /t 3 /nobreak >nul

echo.
echo Both servers are starting:
echo   Sidecar  : http://localhost:9559
echo   Dashboard: http://localhost:5173
echo.
echo Open http://localhost:5173 in your browser.
echo.
echo To stop: close the "AgentGuard Sidecar" and "AgentGuard Dashboard" windows.
echo.
pause
