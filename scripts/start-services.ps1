# Start API + Web as detached background processes (not tied to Cursor / terminal Job).
# Usage:
#   Set-ExecutionPolicy -Scope Process Bypass
#   D:\Outpost_ERP\scripts\start-services.ps1
# Close Cursor anytime; stop with stop-services.ps1.

$ErrorActionPreference = "Stop"

$Node = "D:\devtools\nodejs\node.exe"
$Root = if (Test-Path "D:\Outpost_ERP\package.json") { "D:\Outpost_ERP" }
  elseif (Test-Path "D:\outpost-erp\package.json") { "D:\outpost-erp" }
  else { "D:\Outpost_ERP" }
$LogDir = "D:\outpost-data\logs"
$PidFile = Join-Path $LogDir "outpost-services.pids.json"

if (-not (Test-Path $Node)) {
  Write-Host "Missing $Node — run scripts\setup-d-drive-env.ps1 first" -ForegroundColor Red
  exit 1
}

$tsx = Join-Path $Root "node_modules\tsx\dist\cli.mjs"
$vite = Join-Path $Root "node_modules\vite\bin\vite.js"
if (-not (Test-Path $tsx)) {
  Write-Host "Missing tsx. Enable Windows Developer Mode, then: cd $Root; pnpm install" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
try { chcp 65001 | Out-Null } catch {}

function Get-PidOnPort([int]$Port) {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return $null
}

function Write-LauncherCmd {
  param(
    [string]$Path,
    [string]$WorkDir,
    [string]$Exe,
    [string]$NodeArgs,
    [string]$OutLog,
    [string]$ErrLog
  )
  $lines = @(
    "@echo off",
    "cd /d `"$WorkDir`"",
    "`"$Exe`" $NodeArgs >> `"$OutLog`" 2>> `"$ErrLog`""
  )
  # cmd.exe needs ANSI/OEM-friendly ASCII here
  [System.IO.File]::WriteAllText($Path, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::ASCII)
}

function Start-DetachedCmd([string]$CmdPath, [string]$WorkDir) {
  # WMI Create: process is outside Cursor Kill-on-Job-Close.
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "cmd.exe /c `"$CmdPath`""
    CurrentDirectory = $WorkDir
  }
  if ($r.ReturnValue -ne 0) {
    throw "Win32_Process.Create failed (ReturnValue=$($r.ReturnValue)): $CmdPath"
  }
  return [int]$r.ProcessId
}

$apiPidExisting = Get-PidOnPort 8787
$webPidExisting = Get-PidOnPort 5173
if ($apiPidExisting -and $webPidExisting) {
  @{
    apiPid = $apiPidExisting
    webPid = $webPidExisting
    startedAt = (Get-Date).ToString("o")
    note = "already-running"
  } | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8
  Write-Host "Already running — API pid=$apiPidExisting  Web pid=$webPidExisting" -ForegroundColor Yellow
  Write-Host "Frontend http://127.0.0.1:5173"
  Write-Host "Backend  http://127.0.0.1:8787/api/ready"
  exit 0
}

if ($apiPidExisting -or $webPidExisting) {
  Write-Host "Partial listen detected (api=$apiPidExisting web=$webPidExisting)." -ForegroundColor Yellow
  Write-Host "Run scripts\stop-services.ps1 first, then start again." -ForegroundColor Yellow
  exit 1
}

$apiOut = Join-Path $LogDir "api-out.log"
$apiErr = Join-Path $LogDir "api-err.log"
$webOut = Join-Path $LogDir "web-out.log"
$webErr = Join-Path $LogDir "web-err.log"
$apiCmd = Join-Path $LogDir "run-api.cmd"
$webCmd = Join-Path $LogDir "run-web.cmd"

# Truncate logs for this run
foreach ($f in @($apiOut, $apiErr, $webOut, $webErr)) {
  [System.IO.File]::WriteAllText($f, "")
}

Write-LauncherCmd -Path $apiCmd -WorkDir (Join-Path $Root "apps\api") `
  -Exe $Node -NodeArgs "`"$tsx`" watch src/index.ts" -OutLog $apiOut -ErrLog $apiErr

# Must match apps/web/vite.config.ts (0.0.0.0) so LAN devices can open the UI.
# Do NOT pass --host 127.0.0.1 here — that blocks other devices.
Write-LauncherCmd -Path $webCmd -WorkDir (Join-Path $Root "apps\web") `
  -Exe $Node -NodeArgs "`"$vite`" --host 0.0.0.0 --port 5173" -OutLog $webOut -ErrLog $webErr

Write-Host "Starting API :8787 (detached) ..." -ForegroundColor Cyan
$apiCmdPid = Start-DetachedCmd -CmdPath $apiCmd -WorkDir (Join-Path $Root "apps\api")

Write-Host "Starting Web :5173 (detached) ..." -ForegroundColor Cyan
$webCmdPid = Start-DetachedCmd -CmdPath $webCmd -WorkDir (Join-Path $Root "apps\web")

$deadline = (Get-Date).AddSeconds(25)
$apiPid = $null
$webPid = $null
while ((Get-Date) -lt $deadline) {
  if (-not $apiPid) { $apiPid = Get-PidOnPort 8787 }
  if (-not $webPid) { $webPid = Get-PidOnPort 5173 }
  if ($apiPid -and $webPid) { break }
  Start-Sleep -Milliseconds 400
}

@{
  apiCmdPid = $apiCmdPid
  webCmdPid = $webCmdPid
  apiPid = $apiPid
  webPid = $webPid
  startedAt = (Get-Date).ToString("o")
  root = $Root
} | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8

if (-not $apiPid -or -not $webPid) {
  Write-Host "Started wrappers but ports not ready yet." -ForegroundColor Yellow
  Write-Host "API wrapper pid=$apiCmdPid  Web wrapper pid=$webCmdPid"
  Write-Host "--- api-err.log ---"
  Get-Content $apiErr -ErrorAction SilentlyContinue
  Write-Host "--- web-err.log ---"
  Get-Content $webErr -ErrorAction SilentlyContinue
  Write-Host "Status: scripts\status-services.ps1"
  exit 1
}

Write-Host "API pid=$apiPid  Web pid=$webPid" -ForegroundColor Green
Write-Host "Frontend http://127.0.0.1:5173"
Write-Host "Backend  http://127.0.0.1:8787/api/ready"
Write-Host "Logs     $LogDir"
Write-Host "Stop     scripts\stop-services.ps1"
Write-Host "OK: Cursor can close; services keep running." -ForegroundColor Green
