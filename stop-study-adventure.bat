@echo off
setlocal
set "PORT=4174"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo Stopping Study Adventure server on port %PORT%...
  taskkill /PID %%P /F >nul 2>nul
)

for /f "tokens=2 delims==" %%P in ('wmic process where "name='cloudflared.exe' and commandline like '%%localhost:%PORT%%%'" get ProcessId /value 2^>nul ^| findstr /R "^ProcessId="') do (
  echo Stopping Study Adventure Cloudflare tunnel...
  taskkill /PID %%P /F >nul 2>nul
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter 'name = ''cloudflared.exe''' | Where-Object { $_.CommandLine -match '127\.0\.0\.1:%PORT%|localhost:%PORT%' } | ForEach-Object { Write-Host 'Stopping Study Adventure Cloudflare tunnel...'; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo Study Adventure server stopped.
timeout /t 2 /nobreak >nul
