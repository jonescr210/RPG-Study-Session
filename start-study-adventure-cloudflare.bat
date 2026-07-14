@echo off
setlocal
cd /d "%~dp0"

set "PIPER_MODEL=%~dp0tts\voices\voice-name.onnx"
set "PIPER_CONFIG=%~dp0tts\voices\voice-name.onnx.json"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-study-adventure-cloudflare.ps1"
if errorlevel 1 pause
