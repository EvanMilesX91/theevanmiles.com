param([switch]$DeadlineWindowOnly)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$environmentFile = Join-Path $repo '.env.local'
$line = Get-Content -LiteralPath $environmentFile | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -Last 1
if (-not $line) { throw 'CRON_SECRET is missing.' }
$secret = $line.Substring('CRON_SECRET='.Length).Trim().Trim('"').Trim("'")
if ($secret.Length -lt 16) { throw 'CRON_SECRET is not configured.' }

if ($DeadlineWindowOnly) {
  $bootstrap = Invoke-RestMethod -Uri 'https://fantasy.premierleague.com/api/bootstrap-static/' -TimeoutSec 30
  $next = $bootstrap.events | Where-Object { $_.is_next -eq $true } | Select-Object -First 1
  if (-not $next) { Write-Output 'No next FPL deadline is currently published; deadline refresh skipped.'; exit 0 }
  $hours = ([DateTimeOffset]::Parse($next.deadline_time).UtcDateTime - [DateTime]::UtcNow).TotalHours
  if ($hours -lt 0 -or $hours -gt 8) { Write-Output ("Outside deadline window ({0:N1}h); refresh skipped." -f $hours); exit 0 }
}

$result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3100/api/cron/fpl-refresh' `
  -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 90
if ($result.ok -ne $true -or $result.backend -ne 'supabase') {
  throw 'The FPL production refresh did not complete with durable storage.'
}
$blockingAlerts = @($result.operations.alerts | Where-Object { $_.severity -in @('critical', 'high') })
if ($blockingAlerts.Count -gt 0) {
  $messages = ($blockingAlerts | ForEach-Object { "[$($_.severity)] $($_.message)" }) -join '; '
  throw "FPL refresh stored a snapshot but raised blocking operational alerts: $messages"
}
Write-Output "FPL snapshot refreshed at $($result.refreshedAt); checksum $($result.checksum)."
