# 前哨 Outpost — D 盘本地环境自检 / 补齐脚本
# 用法（PowerShell）：
#   Set-ExecutionPolicy -Scope Process Bypass
#   D:\outpost-erp\scripts\setup-d-drive-env.ps1

$ErrorActionPreference = "Stop"

$NodeHome = "D:\devtools\nodejs"
$PnpmHome = "D:\devtools\pnpm"
$PnpmStore = "D:\devtools\pnpm\store"
$DataRoot = "D:\outpost-data"
$RepoRoot = if (Test-Path "D:\Outpost_ERP\package.json") { "D:\Outpost_ERP" } elseif (Test-Path "D:\outpost-erp\package.json") { "D:\outpost-erp" } else { "D:\Outpost_ERP" }

Write-Host "== Outpost D-drive env setup ==" -ForegroundColor Cyan

$dirs = @(
  $NodeHome,
  $PnpmHome,
  $PnpmStore,
  "D:\devtools\downloads",
  "$DataRoot\json",
  "$DataRoot\portal-imports",
  "$DataRoot\logs",
  "$DataRoot\postgres"
)
foreach ($d in $dirs) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  Write-Host "OK dir $d"
}

function Ensure-UserPath([string]$entry) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $userPath) { $userPath = "" }
  $parts = $userPath -split ";" | Where-Object { $_ -ne "" }
  if ($parts -notcontains $entry) {
    $userPath = if ($userPath) { "$entry;$userPath" } else { $entry }
    [Environment]::SetEnvironmentVariable("Path", $userPath, "User")
    Write-Host "PATH += $entry"
  } else {
    Write-Host "PATH already has $entry"
  }
}

[Environment]::SetEnvironmentVariable("PNPM_HOME", $PnpmHome, "User")
Ensure-UserPath $NodeHome
Ensure-UserPath $PnpmHome

$env:PNPM_HOME = $PnpmHome
$env:Path = "$NodeHome;$PnpmHome;" + $env:Path

if (-not (Test-Path "$NodeHome\node.exe")) {
  Write-Host "MISSING Node at $NodeHome" -ForegroundColor Red
  Write-Host "Download LTS win-x64 zip from https://nodejs.org/dist/ and extract into $NodeHome"
  exit 1
}

Write-Host "node: $(& "$NodeHome\node.exe" -v)"
Write-Host "npm:  $(& "$NodeHome\npm.cmd" -v)"

$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
  Write-Host "Installing pnpm into $PnpmHome ..."
  & "$NodeHome\npm.cmd" install -g pnpm@10.32.1 --prefix $PnpmHome
}

Write-Host "pnpm: $(pnpm -v)"
pnpm config set store-dir $PnpmStore --global | Out-Null
Write-Host "pnpm store-dir: $(pnpm config get store-dir)"

# UTF-8 console tip for this session
try { chcp 65001 | Out-Null } catch {}

if (-not (Test-Path "$RepoRoot\.env")) {
  if (Test-Path "$RepoRoot\.env.example") {
    Copy-Item "$RepoRoot\.env.example" "$RepoRoot\.env"
    Write-Host "Created .env from .env.example"
  }
} else {
  Write-Host ".env present"
}

$legacy = "$RepoRoot\apps\api\.data\state.json"
$dest = "$DataRoot\json\state.json"
if ((Test-Path $legacy) -and -not (Test-Path $dest)) {
  Copy-Item $legacy $dest -Force
  Write-Host "Migrated state.json -> $dest"
}

Write-Host ""
Write-Host "IMPORTANT (Windows): if 'pnpm install' fails with EPERM symlink," -ForegroundColor Yellow
Write-Host "  turn ON Settings -> System -> For developers -> Developer Mode,"
Write-Host "  reopen the terminal, then retry pnpm install."
Write-Host "  Fallback starter (existing node_modules): scripts\dev-d-drive.ps1"
Write-Host ""
Write-Host "Next:" -ForegroundColor Green
Write-Host "  1. Close and reopen the terminal (so User PATH applies)"
Write-Host "  2. cd $RepoRoot"
Write-Host "  3. pnpm install   (needs Developer Mode on Windows)"
Write-Host "  4. pnpm dev      OR  .\scripts\dev-d-drive.ps1"
Write-Host "  5. Open http://127.0.0.1:5173  and  GET http://127.0.0.1:8787/api/ready"
Write-Host "Docs: $RepoRoot\docs\LOCAL_SETUP.md"
