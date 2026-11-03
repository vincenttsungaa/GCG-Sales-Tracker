@echo off
rem Back up the CardStakk database into backend\backups (the newest 30 are kept).
rem Run by hand, or every day by Task Scheduler (see deploy\windows\WINDOWS.md).
cd /d "%~dp0..\..\backend"
venv\Scripts\python backup_db.py
