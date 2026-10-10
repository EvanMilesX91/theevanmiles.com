$ErrorActionPreference = 'Stop'
$siteRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $PSScriptRoot
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Stop the running frontend before installing dependencies (use .\stop.ps1 or stop its terminal). Windows locks active native modules.'
}
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.13+ is required.' }
}
& '.\.venv\Scripts\python.exe' -m pip install -r backend\requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
& '.\.venv\Scripts\python.exe' configure-local.py
if ($LASTEXITCODE -ne 0) { throw 'Private local configuration failed.' }
Push-Location $siteRoot
try {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
} finally { Pop-Location }
Push-Location backend
try {
    & '..\.venv\Scripts\python.exe' -m app.migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
} finally { Pop-Location }
Write-Host 'Setup complete. Run .\start.ps1, then open http://127.0.0.1:3000/waypoint'
