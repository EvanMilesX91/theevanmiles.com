param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$siteRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$pythonPath = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Run .\setup.ps1 first.' }
foreach ($port in @(8000, 3000)) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw "Port $port is already in use. If Waypoint is already running, open http://127.0.0.1:3000. Otherwise stop the process using that port." }
}
$logPath = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null
$backendProcess = Start-Process -FilePath $pythonPath -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory (Join-Path $PSScriptRoot 'backend') -RedirectStandardOutput (Join-Path $logPath 'backend.log') -RedirectStandardError (Join-Path $logPath 'backend-error.log') -WindowStyle Hidden -PassThru
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$frontendProcess = Start-Process -FilePath $nodePath -ArgumentList @('node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000') -WorkingDirectory $siteRoot -RedirectStandardOutput (Join-Path $logPath 'frontend.log') -RedirectStandardError (Join-Path $logPath 'frontend-error.log') -WindowStyle Hidden -PassThru
@{backend=$backendProcess.Id; frontend=$frontendProcess.Id} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logPath 'processes.json')
Write-Host 'Waypoint is starting at http://127.0.0.1:3000/waypoint. Logs are in .\logs. Run .\stop.ps1 to stop.'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3000/waypoint' }
