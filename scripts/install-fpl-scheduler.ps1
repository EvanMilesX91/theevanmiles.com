$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$refreshScript = Join-Path $repo 'scripts\fpl-production-refresh.ps1'
if (-not (Test-Path -LiteralPath $refreshScript)) { throw "Missing refresh script: $refreshScript" }

$dailyAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$refreshScript`""
$deadlineAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$refreshScript`" -DeadlineWindowOnly"
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '05:15'
$deadlineTrigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5)) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'EvanMiles Website - FPL refresh' -Action $dailyAction -Trigger $dailyTrigger -Settings $settings -Description 'Daily durable FPL model refresh.' -Force | Out-Null
Register-ScheduledTask -TaskName 'EvanMiles Website - FPL deadline watch' -Action $deadlineAction -Trigger $deadlineTrigger -Settings $settings -Description 'Checks every 30 minutes and refreshes only within eight hours of an FPL deadline.' -Force | Out-Null
Write-Output 'Installed daily and deadline-window FPL refresh tasks.'
