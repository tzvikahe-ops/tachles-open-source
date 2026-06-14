@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-wizard\Start-SetupWizard.ps1"

if errorlevel 1 (
  pause
)
