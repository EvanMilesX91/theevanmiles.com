$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$environmentFile = Join-Path $repo '.env.local'
$line = Get-Content -LiteralPath $environmentFile | Where-Object { $_ -match '^CRON_SECRET=' } | Select-Object -Last 1
if (-not $line) { throw 'CRON_SECRET is missing.' }
$secret = $line.Substring('CRON_SECRET='.Length).Trim().Trim('"').Trim("'")
if ($secret.Length -lt 16) { throw 'CRON_SECRET is not configured.' }

$result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3100/api/cron/fpl-refresh' `
  -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 90
if ($result.ok -ne $true -or $result.backend -ne 'supabase') {
  throw 'The FPL production refresh did not complete with durable storage.'
}
Write-Output "FPL snapshot refreshed at $($result.refreshedAt); checksum $($result.checksum)."
