$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$kokoroRoot = Join-Path $root "tts\kokoro"
$runtimePath = Join-Path $kokoroRoot "runtime"
$downloadsPath = Join-Path $kokoroRoot "downloads"
$modelParent = Join-Path $kokoroRoot "model"
$modelPath = Join-Path $modelParent "kokoro-en-v0_19"
$archivePath = Join-Path $downloadsPath "kokoro-en-v0_19.tar.bz2"
$modelUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2"
$python = if ($env:KOKORO_PYTHON) { $env:KOKORO_PYTHON } else { "python" }

New-Item -ItemType Directory -Force -Path $runtimePath, $downloadsPath, $modelParent | Out-Null

Write-Host "Installing the Kokoro runtime..." -ForegroundColor Cyan
& $python -m pip install --upgrade --target $runtimePath "sherpa-onnx==1.13.4"
if ($LASTEXITCODE -ne 0) { throw "Kokoro runtime installation failed." }

if (-not (Test-Path $archivePath)) {
  Write-Host "Downloading the Kokoro English voice model (about 305 MB)..." -ForegroundColor Cyan
  & curl.exe -L --fail --retry 3 --output $archivePath $modelUrl
  if ($LASTEXITCODE -ne 0) { throw "Kokoro model download failed." }
}

if (-not (Test-Path (Join-Path $modelPath "model.onnx"))) {
  Write-Host "Extracting the Kokoro model..." -ForegroundColor Cyan
  & tar.exe -xjf $archivePath -C $modelParent
  if ($LASTEXITCODE -ne 0) { throw "Kokoro model extraction failed." }
}

$requiredFiles = @("model.onnx", "voices.bin", "tokens.txt")
foreach ($file in $requiredFiles) {
  if (-not (Test-Path (Join-Path $modelPath $file))) { throw "Kokoro setup is missing $file." }
}

Write-Host "Kokoro is ready. Restart the Study Adventure server and select Local Kokoro." -ForegroundColor Green
