@echo off
rem Put the latest code from GitHub live on this PC. From the live folder:  deploy\windows\update.bat
cd /d "%~dp0..\.."
git pull --ff-only || goto :fail
backend\venv\Scripts\python -m pip install -r backend\requirements.txt || goto :fail
cd frontend
call npm ci || goto :fail
call npm run build || goto :fail
cd ..
rem restart: close the running window, open a new one
taskkill /fi "WINDOWTITLE eq CardStakk live*" /t /f >nul 2>&1
start "CardStakk live" /min cmd /c deploy\windows\start.bat
echo CardStakk restarted with the latest code.
exit /b 0
:fail
echo.
echo Update stopped because of the error above. The site keeps running the previous version.
exit /b 1
