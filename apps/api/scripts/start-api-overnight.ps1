# Outpost API 过夜常开（无 tsx watch）。
# 广告预算峰期/低峰墙钟依赖本进程；禁止用 npm run dev。
#
# 用法（在任意目录）:
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\Outpost_ERP\apps\api\scripts\start-api-overnight.ps1
#
# 日志: D:\outpost-data\pw-rpa\api-overnight.log

$ErrorActionPreference = "Stop"
$ApiRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $ApiRoot "package.json"))) {
  throw "找不到 apps/api/package.json: $ApiRoot"
}

$DataRoot = if ($env:OUTPOST_DATA_ROOT) { $env:OUTPOST_DATA_ROOT } else { "D:\outpost-data" }
$LogDir = Join-Path $DataRoot "pw-rpa"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "api-overnight.log"

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogFile -Value "`n===== overnight start $stamp cwd=$ApiRoot =====`n" -Encoding utf8

Set-Location $ApiRoot
Write-Host "Starting API without watch → $LogFile"
Write-Host "Stop: Ctrl+C in this window (or end the node process)."

# 前台跑，stdout/stderr 同时落盘；退出码写入日志
& npm run start:runtime *>&1 | Tee-Object -FilePath $LogFile -Append
$code = $LASTEXITCODE
$end = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $LogFile -Value "`n===== overnight exit $end code=$code =====`n" -Encoding utf8
exit $code
