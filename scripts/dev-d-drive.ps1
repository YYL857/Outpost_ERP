# 兼容入口：转发到与 Cursor 解耦的后台启动脚本
# 用法：D:\Outpost_ERP\scripts\dev-d-drive.ps1
# 停止：D:\Outpost_ERP\scripts\stop-services.ps1

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "dev-d-drive.ps1 → start-services.ps1（后台独立进程，关 Cursor 不停）" -ForegroundColor Cyan
& (Join-Path $here "start-services.ps1")
exit $LASTEXITCODE
