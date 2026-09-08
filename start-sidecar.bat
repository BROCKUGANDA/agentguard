@echo off
set PATH=C:\Users\HP\scoop\apps\nodejs\24.4.1;%PATH%
set NODE_OPTIONS=--experimental-sqlite
cd /d C:\Users\HP\Desktop\AgentGuard\packages\sidecar
call npx tsx src/server.ts
