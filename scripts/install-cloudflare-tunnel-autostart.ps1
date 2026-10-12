# Install / uninstall / check logon auto-start for Cloudflare Quick Tunnel + Feishu URL push.
# Runs after Outpost services (default +2 min) so :5173/:8787 are up.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-cloudflare-tunnel-autostart.ps1
#   ... -Uninstall
#   ... -Status

param(
  [switch]$Uninstall,
  [switch]$Status
)

$ErrorActionPreference = "Stop"

$TaskName = "OutpostERP-CloudflareTunnel"
$Root = if (Test-Path "D:\Outpost_ERP\package.json") { "D:\Outpost_ERP" }
  elseif (Test-Path "D:\outpost-erp\package.json") { "D:\outpost-erp" }
  else { "D:\Outpost_ERP" }
$StartScript = Join-Path $Root "scripts\start-cloudflare-tunnel.ps1"

function Get-TunnelTask {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

if ($Status) {
  $t = Get-TunnelTask
  if (-not $t) {
    Write-Host "Tunnel autostart: NOT installed ($TaskName)" -ForegroundColor Yellow
    exit 1
  }
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Tunnel autostart: installed" -ForegroundColor Green
  Write-Host "  Task:     $TaskName"
  Write-Host "  State:    $($t.State)"
  Write-Host "  LastRun:  $($info.LastRunTime)"
  Write-Host "  LastResult: $($info.LastTaskResult)"
  $urlFile = "D:\outpost-data\logs\cloudflare-tunnel-url.txt"
  if (Test-Path $urlFile) {
    Write-Host "  Last URL: $((Get-Content $urlFile -Raw).Trim())"
  }
  exit 0
}

if ($Uninstall) {
  $t = Get-TunnelTask
  if (-not $t) {
    Write-Host "Tunnel autostart already removed ($TaskName)" -ForegroundColor Yellow
    exit 0
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tunnel autostart removed: $TaskName" -ForegroundColor Green
  exit 0
}

if (-not (Test-Path $StartScript)) {
  Write-Host "Missing $StartScript" -ForegroundColor Red
  exit 1
}

if (Get-TunnelTask) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$StartScript`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg

# After OutpostERP-Services (+45s): give API/Web time to bind
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT2M"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 2)

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
  -Description "After logon: Cloudflare Quick Tunnel to :5173, save URL, push Feishu" `
  -Force | Out-Null

Write-Host "Tunnel autostart installed: $TaskName" -ForegroundColor Green
Write-Host "  Trigger: at logon (+2 min) for $env:USERNAME"
Write-Host "  Action:  $StartScript"
Write-Host "  URL file: D:\outpost-data\logs\cloudflare-tunnel-url.txt"
Write-Host "  Remove:  scripts\install-cloudflare-tunnel-autostart.ps1 -Uninstall"
Write-Host "  Check:   scripts\install-cloudflare-tunnel-autostart.ps1 -Status"
Write-Host "Tip: ensure OutpostERP-Services autostart is also installed." -ForegroundColor Cyan
