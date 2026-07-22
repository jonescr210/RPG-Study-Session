$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not $env:ELEVENLABS_API_KEY) {
  $env:ELEVENLABS_API_KEY = [Environment]::GetEnvironmentVariable("ELEVENLABS_API_KEY", "User")
}

$port = if ($env:PORT) { [int]$env:PORT } else { 4174 }
$localUrl = "http://localhost:$port/index.html"
$serviceUrl = "http://127.0.0.1:$port"
$healthUrl = "http://127.0.0.1:$port/index.html"
$logDir = Join-Path $root "logs"
$serverOut = Join-Path $logDir "server-out.log"
$serverErr = Join-Path $logDir "server-err.log"
$tunnelOut = Join-Path $logDir "cloudflared-tunnel.log"
$tunnelErr = Join-Path $logDir "cloudflared-tunnel.err.log"

function Resolve-Cloudflared {
  $command = Get-Command "cloudflared" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }

  return $null
}

function Resolve-Node {
  $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $bundledNode) { return $bundledNode }

  $command = Get-Command "node" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Test-StudyAdventureServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Test-PublicTunnel($url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Show-LogTail($label, $path) {
  if (-not (Test-Path $path)) { return }
  $lines = Get-Content $path -Tail 25 -ErrorAction SilentlyContinue
  if (-not $lines) { return }
  Write-Host ""
  Write-Host $label -ForegroundColor Yellow
  $lines | ForEach-Object { Write-Host $_ }
}

function Stop-IfRunning($process) {
  if ($process -and -not $process.HasExited) {
    try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Stop-ExistingStudyAdventureProcesses {
  $existingServerPids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($serverPid in $existingServerPids) {
    if (-not $serverPid) { continue }
    Write-Host "Stopping existing Study Adventure server on port $port..."
    try { Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue } catch {}
  }

  $tunnelMatches = @(Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "127\.0\.0\.1:$port|localhost:$port"
  })
  foreach ($process in $tunnelMatches) {
    Write-Host "Stopping existing Study Adventure Cloudflare tunnel..."
    try { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }

  if ($existingServerPids.Count -or $tunnelMatches.Count) {
    Start-Sleep -Seconds 1
  }
}

$nodePath = Resolve-Node
if (-not $nodePath) {
  Write-Host "Node.js was not found. Install Node.js LTS from https://nodejs.org/ and run this again." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

$cloudflaredPath = Resolve-Cloudflared
if (-not $cloudflaredPath) {
  Write-Host "cloudflared was not found. Install Cloudflare Tunnel, then run this again." -ForegroundColor Red
  Write-Host "Install command: winget install --id Cloudflare.cloudflared -e"
  Read-Host "Press Enter to exit"
  exit 1
}

$serverProcess = $null
$tunnelProcess = $null

try {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  Clear-Content -Path $serverOut,$serverErr,$tunnelOut,$tunnelErr -ErrorAction SilentlyContinue

  Stop-ExistingStudyAdventureProcesses

  Write-Host "Starting Study Adventure server on port $port..."
  $serverProcess = Start-Process -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $root -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr -PassThru -WindowStyle Hidden

  Write-Host "Waiting for local server to answer..."
  $serverReady = $false
  $deadline = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $deadline -and -not $serverReady) {
    Start-Sleep -Milliseconds 500
    $serverReady = Test-StudyAdventureServer
    if ($serverProcess -and $serverProcess.HasExited) { break }
  }

  if (-not $serverReady) {
    Write-Host "The Study Adventure server did not start on $healthUrl." -ForegroundColor Red
    Show-LogTail "logs\server-out.log" $serverOut
    Show-LogTail "logs\server-err.log" $serverErr
    throw "Local server did not become ready."
  }

  Write-Host "Starting temporary Cloudflare tunnel..."
  $tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList @("tunnel", "--url", $serviceUrl, "--protocol", "http2", "--no-autoupdate") -WorkingDirectory $root -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru -WindowStyle Hidden

  $publicUrl = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not $publicUrl) {
    Start-Sleep -Milliseconds 500
    $logText = ""
    if (Test-Path $tunnelOut) { $logText += Get-Content $tunnelOut -Raw -ErrorAction SilentlyContinue }
    if (Test-Path $tunnelErr) { $logText += Get-Content $tunnelErr -Raw -ErrorAction SilentlyContinue }
    $match = [regex]::Match($logText, "https://[-a-z0-9]+\.trycloudflare\.com")
    if ($match.Success) { $publicUrl = $match.Value }
    if ($tunnelProcess.HasExited) { break }
  }

  Write-Host ""
  Write-Host "Study Adventure is running." -ForegroundColor Green
  Write-Host "Local teacher page: $localUrl"
  if ($publicUrl) {
    $publicTeacherUrl = "$publicUrl/index.html"
    $publicPlayerUrl = "$publicUrl/player.html"
    Write-Host "Cloudflare teacher page: $publicTeacherUrl" -ForegroundColor Cyan
    Write-Host "Cloudflare player page:  $publicPlayerUrl" -ForegroundColor Cyan
    Write-Host "Waiting for public Cloudflare URL to answer..."
    $publicReady = $false
    $publicDeadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $publicDeadline -and -not $publicReady) {
      Start-Sleep -Seconds 2
      $publicReady = Test-PublicTunnel $publicUrl
      if ($tunnelProcess -and $tunnelProcess.HasExited) { break }
    }
    if ($publicReady) {
      Write-Host "Public Cloudflare URL is reachable." -ForegroundColor Green
    } else {
      Write-Host "Public URL did not answer yet. If it will not load, your DNS/VPN/network may be blocking trycloudflare.com lookup." -ForegroundColor Yellow
      Write-Host "Try turning off VPN, waiting 30-60 seconds, or restarting this launcher to get a new temporary URL." -ForegroundColor Yellow
    }
    try {
      Set-Clipboard -Value $publicTeacherUrl
      Write-Host "Teacher link copied to clipboard." -ForegroundColor Green
    } catch {
      Write-Host "Could not copy the teacher link automatically." -ForegroundColor Yellow
    }
    if ($env:STUDY_ADVENTURE_NO_OPEN -eq "1") {
      Write-Host "Browser opening skipped by STUDY_ADVENTURE_NO_OPEN."
    } else {
      Write-Host "Opening teacher page..."
      Start-Process $publicTeacherUrl
    }
  } else {
    Write-Host "Cloudflare URL was not detected yet. Check logs\cloudflared-tunnel.err.log." -ForegroundColor Yellow
    if ($env:STUDY_ADVENTURE_NO_OPEN -eq "1") {
      Write-Host "Browser opening skipped by STUDY_ADVENTURE_NO_OPEN."
    } else {
      Write-Host "Opening local teacher page..."
      Start-Process $localUrl
    }
  }
  Write-Host ""
  Write-Host "Keep this window open while players are connected."
  Write-Host "Press Ctrl+C or close this window to stop the tunnel and the server started by this launcher."

  while ($true) {
    Start-Sleep -Seconds 2
    if ($serverProcess -and $serverProcess.HasExited) {
      Write-Host "Study Adventure server stopped. Closing Cloudflare tunnel..." -ForegroundColor Yellow
      break
    }
    if ($tunnelProcess -and $tunnelProcess.HasExited) {
      Write-Host "Cloudflare tunnel stopped." -ForegroundColor Yellow
      break
    }
  }
} catch {
  Write-Host ""
  Write-Host "Study Adventure Cloudflare launcher failed:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Show-LogTail "logs\server-out.log" $serverOut
  Show-LogTail "logs\server-err.log" $serverErr
  Show-LogTail "logs\cloudflared-tunnel.err.log" $tunnelErr
  Read-Host "Press Enter to close"
  exit 1
} finally {
  Stop-IfRunning $tunnelProcess
  Stop-IfRunning $serverProcess
  Write-Host "Study Adventure Cloudflare launcher stopped."
}
