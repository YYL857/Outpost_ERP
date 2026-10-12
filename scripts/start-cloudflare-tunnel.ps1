# Start Cloudflare Quick Tunnel (detached), capture public URL, push to Feishu phone.
# Prerequisite: Outpost Web :5173 + API :8787 (pnpm services:start / autostart).
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-cloudflare-tunnel.ps1
#   ... -SkipNotify   # only start tunnel, no Feishu
#   ... -NoWaitPorts  # fail immediately if ports down (default waits up to 3 min)

param(
  [switch]$SkipNotify,
  [switch]$NoWaitPorts
)

$ErrorActionPreference = "Stop"

$Cloudflared = @(
  "D:\devtools\cloudflared\cloudflared.exe",
  "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
  "${env:ProgramFiles}\cloudflared\cloudflared.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Cloudflared) {
  Write-Host "cloudflared not found under D:\devtools\cloudflared\" -ForegroundColor Red
  exit 1
}

$Root = if (Test-Path "D:\Outpost_ERP\package.json") { "D:\Outpost_ERP" }
  elseif (Test-Path "D:\outpost-erp\package.json") { "D:\outpost-erp" }
  else { "D:\Outpost_ERP" }
$LogDir = "D:\outpost-data\logs"
$UrlFile = Join-Path $LogDir "cloudflare-tunnel-url.txt"
$OutLog = Join-Path $LogDir "cloudflared-tunnel.out.log"
$ErrLog = Join-Path $LogDir "cloudflared-tunnel.err.log"
$PidFile = Join-Path $LogDir "cloudflared-tunnel.pid.json"
$Launcher = Join-Path $LogDir "cloudflared-tunnel-run.cmd"
$Node = "D:\devtools\nodejs\node.exe"
$Tsx = Join-Path $Root "node_modules\tsx\dist\cli.mjs"
$NotifyScript = Join-Path $Root "apps\api\scripts\feishu-notify-tunnel.ts"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Wait-OutpostPorts {
  if ($NoWaitPorts) {
    if (-not (Test-Port 5173) -or -not (Test-Port 8787)) {
      throw "Outpost not listening (need 5173 + 8787). Run: pnpm services:start"
    }
    return
  }
  $deadline = (Get-Date).AddMinutes(3)
  Write-Host "Waiting for Outpost ports 5173 + 8787 ..."
  while ((Get-Date) -lt $deadline) {
    if ((Test-Port 5173) -and (Test-Port 8787)) {
      Write-Host "Ports ready." -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 3
  }
  throw "Timed out waiting for 5173/8787. Start services first."
}

function Stop-ExistingCloudflared {
  Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
  Start-Sleep -Seconds 1
}

function Start-DetachedTunnel {
  if (Test-Path $OutLog) { Remove-Item $OutLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path $ErrLog) { Remove-Item $ErrLog -Force -ErrorAction SilentlyContinue }

  # Host rewrite: Vite rejects *.trycloudflare.com Host header (403)
  $args = "tunnel --url http://127.0.0.1:5173 --http-host-header `"127.0.0.1:5173`" --no-autoupdate"
  $lines = @(
    "@echo off",
    "cd /d `"$LogDir`"",
    "`"$Cloudflared`" $args >> `"$OutLog`" 2>> `"$ErrLog`""
  )
  [System.IO.File]::WriteAllText($Launcher, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::ASCII)

  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "cmd.exe /c `"$Launcher`""
    CurrentDirectory = $LogDir
  }
  if ($r.ReturnValue -ne 0) {
    throw "Failed to start cloudflared (Win32_Process.Create=$($r.ReturnValue))"
  }
  return [int]$r.ProcessId
}

function Wait-TunnelUrl {
  $deadline = (Get-Date).AddSeconds(90)
  $pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
  while ((Get-Date) -lt $deadline) {
    foreach ($f in @($ErrLog, $OutLog)) {
      if (-not (Test-Path $f)) { continue }
      $text = Get-Content $f -Raw -ErrorAction SilentlyContinue
      if ($text -and ($text -match $pattern)) {
        return $Matches[0]
      }
    }
    Start-Sleep -Seconds 2
  }
  throw "Timed out waiting for trycloudflare.com URL. See $ErrLog"
}

Wait-OutpostPorts
Stop-ExistingCloudflared
$launcherPid = Start-DetachedTunnel
Write-Host "cloudflared launcher pid=$launcherPid"

$url = Wait-TunnelUrl
$url | Set-Content -Path $UrlFile -Encoding UTF8
@{
  url = $url
  startedAt = (Get-Date).ToString("o")
  launcherPid = $launcherPid
  cloudflared = $Cloudflared
} | ConvertTo-Json | Set-Content -Path $PidFile -Encoding UTF8

Write-Host ""
Write-Host "Public URL:" -ForegroundColor Cyan
Write-Host "  $url" -ForegroundColor Green
Write-Host "Saved: $UrlFile"

if (-not $SkipNotify) {
  if (-not (Test-Path $Node) -or -not (Test-Path $Tsx) -or -not (Test-Path $NotifyScript)) {
    Write-Host "Skip Feishu notify (missing node/tsx/script)." -ForegroundColor Yellow
  } else {
    Write-Host "Pushing URL to Feishu ..."
    & $Node $Tsx $NotifyScript --url $url
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Feishu notify failed (tunnel still running). Check app credentials / bot in chat." -ForegroundColor Yellow
    }
  }
}

Write-Host "Tunnel is detached; closing this window will NOT stop it." -ForegroundColor DarkGray
Write-Host "Stop: Get-Process cloudflared | Stop-Process"
