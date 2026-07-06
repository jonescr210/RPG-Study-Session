@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-study-adventure-cloudflare.ps1"
if errorlevel 1 pause
