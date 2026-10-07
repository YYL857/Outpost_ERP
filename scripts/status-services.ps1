# 查看后台服务是否在跑（与 Cursor 无关）
# 用法：D:\Outpost_ERP\scripts\status-services.ps1

$ErrorActionPreference = "Continue"
$LogDir = "D:\outpost-data\logs"
$PidFile = Join-Path $LogDir "outpost-services.pids.json"

function Get-PidOnPort([int]$Port) {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return $null
}

$apiPid = Get-PidOnPort 8787
$webPid = Get-PidOnPort 5173

Write-Host "API  :8787  $(if ($apiPid) { "LISTEN pid=$apiPid" } else { "DOWN" })"
Write-Host "Web  :5173  $(if ($webPid) { "LISTEN pid=$webPid" } else { "DOWN" })"

if (Test-Path $PidFile) {
  Write-Host "Pid file: $PidFile"
  Get-Content $PidFile -Encoding UTF8
} else {
  Write-Host "Pid file: (none)"
}

if ($apiPid) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/ready" -UseBasicParsing -TimeoutSec 3
    Write-Host "Ready: $($r.StatusCode) $($r.Content)"
  } catch {
    Write-Host "Ready probe failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}
