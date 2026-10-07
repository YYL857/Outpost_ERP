# 不依赖 pnpm symlink：用 D 盘 Node 直接启动前后端
# 用法：D:\outpost-erp\scripts\dev-d-drive.ps1

$ErrorActionPreference = "Stop"
$Node = "D:\devtools\nodejs\node.exe"
$Root = "D:\outpost-erp"
$LogDir = "D:\outpost-data\logs"

if (-not (Test-Path $Node)) {
  Write-Host "Missing $Node — run scripts\setup-d-drive-env.ps1 first" -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
try { chcp 65001 | Out-Null } catch {}

$tsx = Join-Path $Root "node_modules\tsx\dist\cli.mjs"
$vite = Join-Path $Root "node_modules\vite\bin\vite.js"
if (-not (Test-Path $tsx)) {
  Write-Host "Missing tsx. Enable Windows Developer Mode, then: cd $Root; pnpm install" -ForegroundColor Red
  exit 1
}

Write-Host "Starting API :8787 ..." -ForegroundColor Cyan
$api = Start-Process -FilePath $Node -ArgumentList $tsx,"watch","src/index.ts" `
  -WorkingDirectory (Join-Path $Root "apps\api") `
  -RedirectStandardOutput (Join-Path $LogDir "api-out.log") `
  -RedirectStandardError (Join-Path $LogDir "api-err.log") `
  -PassThru

Write-Host "Starting Web :5173 ..." -ForegroundColor Cyan
$web = Start-Process -FilePath $Node -ArgumentList $vite,"--host","127.0.0.1","--port","5173" `
  -WorkingDirectory (Join-Path $Root "apps\web") `
  -RedirectStandardOutput (Join-Path $LogDir "web-out.log") `
  -RedirectStandardError (Join-Path $LogDir "web-err.log") `
  -PassThru

Write-Host "API pid=$($api.Id)  Web pid=$($web.Id)"
Write-Host "Frontend http://127.0.0.1:5173"
Write-Host "Backend  http://127.0.0.1:8787/api/ready"
Write-Host "Logs     $LogDir"
Write-Host "Press Ctrl+C to stop both..."

try {
  while ($true) {
    if ($api.HasExited -or $web.HasExited) { break }
    Start-Sleep -Seconds 2
  }
} finally {
  foreach ($p in @($api, $web)) {
    if ($p -and -not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
