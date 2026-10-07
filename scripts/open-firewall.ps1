# Ensure Windows Firewall allows LAN access to Outpost ports.
# Needs Administrator. Safe to re-run (idempotent).
# Usage: D:\Outpost_ERP\scripts\open-firewall.ps1

$ErrorActionPreference = "Stop"

$rules = @(
  @{ Name = "OutpostERP-Web-5173"; Port = 5173; Desc = "Outpost ERP Vite Web" },
  @{ Name = "OutpostERP-API-8787"; Port = 8787; Desc = "Outpost ERP API" }
)

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).
  IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "Need Administrator to add firewall rules." -ForegroundColor Yellow
  Write-Host "Right-click PowerShell -> Run as administrator, then:" -ForegroundColor Yellow
  Write-Host "  D:\Outpost_ERP\scripts\open-firewall.ps1"
  exit 1
}

foreach ($r in $rules) {
  $existing = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "OK exists: $($r.Name)" -ForegroundColor Green
    continue
  }
  New-NetFirewallRule `
    -DisplayName $r.Name `
    -Description $r.Desc `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $r.Port `
    -Profile Any | Out-Null
  Write-Host "Added: $($r.Name) TCP $($r.Port)" -ForegroundColor Green
}

Write-Host "Firewall ready for LAN access on :5173 and :8787" -ForegroundColor Green
