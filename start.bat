@echo off
rem DotShell launcher: runs start.ps1 regardless of the PowerShell execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause
