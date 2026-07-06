$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$downloadDir = Join-Path $root "tts\downloads"
$piperDir = Join-Path $root "tts\piper"
$voiceDir = Join-Path $root "tts\voices"

$piperZip = Join-Path $downloadDir "piper_windows_amd64.zip"
$piperExtract = Join-Path $downloadDir "piper_windows_amd64"
$modelPath = Join-Path $voiceDir "en_GB-northern_english_male-medium.onnx"
$configPath = Join-Path $voiceDir "en_GB-northern_english_male-medium.onnx.json"

$piperUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
$modelUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx"
$configUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium.onnx.json"

New-Item -ItemType Directory -Force -Path $downloadDir, $piperDir, $voiceDir | Out-Null

if (-not (Test-Path (Join-Path $piperDir "piper.exe"))) {
  if (-not (Test-Path $piperZip)) {
    Write-Host "Downloading Piper engine..."
    Invoke-WebRequest -Uri $piperUrl -OutFile $piperZip
  }

  if (Test-Path $piperExtract) {
    Remove-Item -Recurse -Force $piperExtract
  }
  Expand-Archive -Path $piperZip -DestinationPath $piperExtract -Force
  $piperExe = Get-ChildItem -Path $piperExtract -Recurse -Filter "piper.exe" | Select-Object -First 1
  if (-not $piperExe) {
    throw "Could not find piper.exe inside the downloaded archive."
  }
  Copy-Item -Path (Join-Path $piperExe.Directory.FullName "*") -Destination $piperDir -Recurse -Force
}

if (-not (Test-Path $modelPath)) {
  Write-Host "Downloading Northern English male voice model..."
  Invoke-WebRequest -Uri $modelUrl -OutFile $modelPath
}

if (-not (Test-Path $configPath)) {
  Write-Host "Downloading Northern English male voice config..."
  Invoke-WebRequest -Uri $configUrl -OutFile $configPath
}

Write-Host ""
Write-Host "Piper TTS is installed for Study Adventure."
Write-Host "Engine: $piperDir"
Write-Host "Voice:  $modelPath"
Write-Host ""
Write-Host "Restart the Study Adventure server, then choose Mission Audio > Local Piper."
