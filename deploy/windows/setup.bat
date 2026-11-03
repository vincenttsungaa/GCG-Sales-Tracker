@echo off
rem One-time setup of the LIVE copy of CardStakk on this Windows PC (run from the live folder, e.g. C:\CardStakk):
rem   deploy\windows\setup.bat
rem Makes the Python environment, installs everything and builds the website. Your development folder isn't touched.
cd /d "%~dp0..\.."

cd backend
if not exist venv\Scripts\python.exe (
  py -3.14 -m venv venv 2>nul || python -m venv venv
)
venv\Scripts\python -m pip install -r requirements.txt || goto :fail
if not exist .env copy .env.example .env >nul
cd ..

cd frontend
call npm ci || goto :fail
call npm run build || goto :fail
cd ..

echo.
echo Setup done. Next: fill in backend\.env (live settings, see deploy\windows\WINDOWS.md), then run deploy\windows\start.bat
exit /b 0
:fail
echo.
echo Something went wrong above. Nothing is running yet.
exit /b 1
