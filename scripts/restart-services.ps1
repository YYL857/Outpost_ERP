# 一键重启：先 stop-services，再 start-services
# 用法：D:\Outpost_ERP\scripts\restart-services.ps1

$ErrorActionPreference = "Stop"

$Root = if (Test-Path "D:\Outpost_ERP\package.json") { "D:\Outpost_ERP" }
  elseif (Test-Path "D:\outpost-erp\package.json") { "D:\outpost-erp" }
  else { "D:\Outpost_ERP" }

$Stop = Join-Path $Root "scripts\stop-services.ps1"
$Start = Join-Path $Root "scripts\start-services.ps1"

Write-Host "=== Restart Outpost services ===" -ForegroundColor Cyan
& $Stop
Start-Sleep -Seconds 2
& $Start
