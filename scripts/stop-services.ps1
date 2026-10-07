# 停止 start-services.ps1 拉起的后台 API + Web
# 用法：D:\Outpost_ERP\scripts\stop-services.ps1

$ErrorActionPreference = "Continue"

$LogDir = "D:\outpost-data\logs"
$PidFile = Join-Path $LogDir "outpost-services.pids.json"

function Get-PidOnPort([int]$Port) {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return $null
}

function Stop-Tree([int]$ProcessId) {
  if ($ProcessId -le 0) { return }
  # /T 含子进程（cmd 包装下的 node）
  & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
}

$pids = @()
if (Test-Path $PidFile) {
  try {
    $state = Get-Content -Path $PidFile -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @("apiPid", "webPid", "apiCmdPid", "webCmdPid")) {
      $v = $state.$k
      if ($v) { $pids += [int]$v }
    }
  } catch {}
}

$pids += @(Get-PidOnPort 8787)
$pids += @(Get-PidOnPort 5173)
$pids = $pids | Where-Object { $_ } | Select-Object -Unique

if (-not $pids -or $pids.Count -eq 0) {
  Write-Host "No Outpost services found on :8787 / :5173" -ForegroundColor Yellow
  if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
  exit 0
}

Write-Host "Stopping: $($pids -join ', ')" -ForegroundColor Cyan
foreach ($p in $pids) { Stop-Tree $p }

Start-Sleep -Seconds 1
$leftApi = Get-PidOnPort 8787
$leftWeb = Get-PidOnPort 5173
if ($leftApi -or $leftWeb) {
  Write-Host "Still listening: api=$leftApi web=$leftWeb — force again" -ForegroundColor Yellow
  if ($leftApi) { Stop-Tree $leftApi }
  if ($leftWeb) { Stop-Tree $leftWeb }
}

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "Stopped." -ForegroundColor Green
