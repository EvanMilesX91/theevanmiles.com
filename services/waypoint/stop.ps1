$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot 'logs\processes.json'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No saved Waypoint processes.'; exit }
$processes = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
foreach ($entry in @(@{Id=$processes.backend; Match='uvicorn app.main:app'}, @{Id=$processes.frontend; Match='node_modules/next/dist/bin/next'})) {
    $runningProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.Id)" -ErrorAction SilentlyContinue
    if ($runningProcess -and $runningProcess.CommandLine -like "*$($entry.Match)*") {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($entry.Id)" -ErrorAction SilentlyContinue
        foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
        Stop-Process -Id $entry.Id -ErrorAction SilentlyContinue
    }
}
Remove-Item -LiteralPath $pidFile
Write-Host 'Waypoint processes stopped. Saved data is retained.'
