# Install / uninstall / check Windows logon auto-start for Outpost services.
# Usage:
#   Set-ExecutionPolicy -Scope Process Bypass
#   D:\Outpost_ERP\scripts\install-autostart.ps1          # install
#   D:\Outpost_ERP\scripts\install-autostart.ps1 -Uninstall
#   D:\Outpost_ERP\scripts\install-autostart.ps1 -Status

param(
  [switch]$Uninstall,
  [switch]$Status
)

$ErrorActionPreference = "Stop"

$TaskName = "OutpostERP-Services"
$Root = if (Test-Path "D:\Outpost_ERP\package.json") { "D:\Outpost_ERP" }
  elseif (Test-Path "D:\outpost-erp\package.json") { "D:\outpost-erp" }
  else { "D:\Outpost_ERP" }
$StartScript = Join-Path $Root "scripts\start-services.ps1"

function Get-OutpostTask {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

if ($Status) {
  $t = Get-OutpostTask
  if (-not $t) {
    Write-Host "Autostart: NOT installed ($TaskName)" -ForegroundColor Yellow
    exit 1
  }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Autostart: installed" -ForegroundColor Green
  Write-Host "  Task:     $TaskName"
  Write-Host "  State:    $($t.State)"
  Write-Host "  LastRun:  $($info.LastRunTime)"
  Write-Host "  LastResult: $($info.LastTaskResult)"
  Write-Host "  NextRun:  $($info.NextRunTime)"
  exit 0
}

if ($Uninstall) {
  $t = Get-OutpostTask
  if (-not $t) {
    Write-Host "Autostart already removed ($TaskName)" -ForegroundColor Yellow
    exit 0
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Autostart removed: $TaskName" -ForegroundColor Green
  exit 0
}

if (-not (Test-Path $StartScript)) {
  Write-Host "Missing $StartScript" -ForegroundColor Red
  exit 1
}

# Remove old task if present, then recreate
if (Get-OutpostTask) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# Wait for D: / desktop settle after login
$trigger.Delay = "PT45S"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Start Outpost ERP API (:8787) + Web (:5173) after user logon" `
  -Force | Out-Null

Write-Host "Autostart installed: $TaskName" -ForegroundColor Green
Write-Host "  Trigger: at logon (+45s) for $env:USERNAME"
Write-Host "  Action:  $StartScript"
Write-Host "  Remove:  scripts\install-autostart.ps1 -Uninstall"
Write-Host "  Check:   scripts\install-autostart.ps1 -Status"

# Best-effort firewall (needs admin)
$fw = Join-Path $Root "scripts\open-firewall.ps1"
try {
  & $fw
} catch {
  Write-Host "Firewall not updated (run open-firewall.ps1 as Admin for LAN)." -ForegroundColor Yellow
}

Write-Host "Tip: reboot or re-login to verify; or run start-services.ps1 now." -ForegroundColor Cyan
