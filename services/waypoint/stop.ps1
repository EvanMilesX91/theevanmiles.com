$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'logs\processes.json'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No saved Waypoint processes.'; exit }
$processes = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
function Stop-Tree([int]$rootId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$rootId" -ErrorAction SilentlyContinue
    foreach ($child in $children) { Stop-Tree ([int]$child.ProcessId) }
    Stop-Process -Id $rootId -Force -ErrorAction SilentlyContinue
}
foreach ($entry in @(@{Id=$processes.backend; Match='uvicorn app.main:app'}, @{Id=$processes.frontend; Match='node_modules/next/dist/bin/next'})) {
    $runningProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.Id)" -ErrorAction SilentlyContinue
    if ($runningProcess -and $runningProcess.CommandLine -like "*$($entry.Match)*") {
        Stop-Tree ([int]$entry.Id)
    }
}
Remove-Item -LiteralPath $pidFile
Write-Host 'Waypoint processes stopped. Saved data is retained.'
