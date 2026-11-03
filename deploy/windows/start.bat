@echo off
rem Runs the live site on this PC: http://127.0.0.1:8002 (Cloudflare Tunnel sends cardstakkgcgsalestracker.com here).
rem Port 8002, so your development backend can keep using 8001. Leave this window open (minimise it).
title CardStakk live
cd /d "%~dp0..\..\backend"
:run
venv\Scripts\python -m uvicorn server:app --host 127.0.0.1 --port 8002 --workers 1
echo CardStakk stopped. Starting it again in 5 seconds (close this window to stop it for good)...
timeout /t 5 /nobreak >nul
goto run
