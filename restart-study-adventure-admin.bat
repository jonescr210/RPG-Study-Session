@echo off
setlocal
cd /d "%~dp0"

set "PORT=4174"
set "TEACHER_URL=http://localhost:%PORT%/index.html"
set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "logs" mkdir "logs"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

net session >nul 2>nul
if not "%errorlevel%"=="0" (
  echo Requesting administrator permission to restart Study Adventure...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

if "%NODE_EXE%"=="node" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found.
    echo Install Node.js LTS from https://nodejs.org/ and run this file again.
    pause
    exit /b 1
  )
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo Stopping existing Study Adventure server on port %PORT%...
  taskkill /PID %%P /F >nul 2>nul
)

timeout /t 1 /nobreak >nul

echo Starting Study Adventure server on port %PORT%...
start "Study Adventure Server" /min cmd /c "cd /d ""%~dp0"" && set PORT=%PORT% && ""%NODE_EXE%"" server.js > logs\server-out.log 2> logs\server-err.log"

timeout /t 2 /nobreak >nul
echo Opening teacher page...
start "" "%TEACHER_URL%"
exit /b 0
