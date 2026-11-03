@echo off
REM Daily NPD escalation run. Point Windows Task Scheduler at this file.
cd /d "%~dp0"
python npd_automailer.py >> automailer_run.log 2>&1
