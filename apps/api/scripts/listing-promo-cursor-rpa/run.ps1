# Outpost Listing promo: local keyboard RPA for Cursor (no SDK/API)
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 -JobDir "D:\...\promo-xxx"
#
# Env:
#   CURSOR_EXE, LISTING_PROMO_RPA_OPEN (default unused), LISTING_PROMO_RPA_SEND (default {ENTER})
#   LISTING_PROMO_RPA_WAIT_MS (default 10000), LISTING_PROMO_RPA_PASTE_WAIT_MS (default 1000)
#   LISTING_PROMO_RPA_NO_SEND=1  paste only, do not send
#   LISTING_PROMO_RPA_OPEN_KEYS  comma list; default empty (do not toggle Agent panel)

param(
  [Parameter(Mandatory = $true)]
  [string]$JobDir,
  [string]$PromptPath = ""
)

$ErrorActionPreference = "Stop"
$script:LogLines = New-Object System.Collections.Generic.List[string]

function Log([string]$Msg) {
  $line = "$(Get-Date -Format o)  $Msg"
  $script:LogLines.Add($line) | Out-Null
  Write-Host $line
}

function Write-ResultJson([bool]$Ok, [string]$Message, [string]$ErrorText = "") {
  $logPath = Join-Path $JobDir "rpa-debug.log"
  try {
    $script:LogLines -join "`r`n" | Set-Content -LiteralPath $logPath -Encoding UTF8
  } catch { }

  $obj = [ordered]@{
    ok      = $Ok
    message = $Message
    error   = $ErrorText
  }
  Write-Output ($obj | ConvertTo-Json -Compress)
  if (-not $Ok) { exit 1 }
  exit 0
}

# --- Win32 focus / click ---
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RpaWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

function Focus-Window([IntPtr]$Hwnd) {
  if ($Hwnd -eq [IntPtr]::Zero) { return $false }
  try { [RpaWin]::AllowSetForegroundWindow(-1) | Out-Null } catch { }
  if ([RpaWin]::IsIconic($Hwnd)) {
    [RpaWin]::ShowWindow($Hwnd, [RpaWin]::SW_RESTORE) | Out-Null
  } else {
    [RpaWin]::ShowWindow($Hwnd, [RpaWin]::SW_SHOW) | Out-Null
  }
  [RpaWin]::BringWindowToTop($Hwnd) | Out-Null

  $fg = [RpaWin]::GetForegroundWindow()
  $pidFg = 0; $pidTarget = 0
  $tidFg = [RpaWin]::GetWindowThreadProcessId($fg, [ref]$pidFg)
  $tidTarget = [RpaWin]::GetWindowThreadProcessId($Hwnd, [ref]$pidTarget)
  $tidCur = [RpaWin]::GetCurrentThreadId()
  if ($tidFg -ne $tidCur) {
    [RpaWin]::AttachThreadInput($tidCur, $tidFg, $true) | Out-Null
  }
  if ($tidTarget -ne $tidCur) {
    [RpaWin]::AttachThreadInput($tidCur, $tidTarget, $true) | Out-Null
  }
  $ok = [RpaWin]::SetForegroundWindow($Hwnd)
  if ($tidFg -ne $tidCur) {
    [RpaWin]::AttachThreadInput($tidCur, $tidFg, $false) | Out-Null
  }
  if ($tidTarget -ne $tidCur) {
    [RpaWin]::AttachThreadInput($tidCur, $tidTarget, $false) | Out-Null
  }
  return $ok
}

function Click-WindowPoint([IntPtr]$Hwnd, [double]$XRatio, [double]$YRatio) {
  $rect = New-Object RpaWin+RECT
  if (-not [RpaWin]::GetWindowRect($Hwnd, [ref]$rect)) { return $false }
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  if ($w -lt 50 -or $h -lt 50) { return $false }
  $x = [int]($rect.Left + $w * $XRatio)
  $y = [int]($rect.Top + $h * $YRatio)
  [RpaWin]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [RpaWin]::mouse_event([RpaWin]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [RpaWin]::mouse_event([RpaWin]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Log "Clicked window at ratio ($XRatio,$YRatio) -> ($x,$y)"
  return $true
}

function Find-CursorHwnd {
  $procs = Get-Process -Name "Cursor" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }
  if (-not $procs) { return [IntPtr]::Zero }
  # Prefer newest window (just opened for this job)
  $pick = $procs | Sort-Object StartTime -Descending | Select-Object -First 1
  Log ("Picked Cursor hwnd=$($pick.MainWindowHandle) title=$($pick.MainWindowTitle) pid=$($pick.Id)")
  return [IntPtr]$pick.MainWindowHandle
}

function Resolve-CursorCmd {
  if ($env:CURSOR_EXE -and (Test-Path -LiteralPath $env:CURSOR_EXE)) {
    return $env:CURSOR_EXE
  }
  $cmd = Get-Command cursor -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\cursor\Cursor.exe",
    "$env:LOCALAPPDATA\Programs\Cursor\Cursor.exe",
    "D:\Cursor\cursor\Cursor.exe",
    "D:\Cursor\cursor\resources\app\bin\cursor.cmd"
  )
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath $c) { return $c }
  }
  return $null
}

# --- main ---
$JobDir = [System.IO.Path]::GetFullPath($JobDir)
if (-not (Test-Path -LiteralPath $JobDir -PathType Container)) {
  Write-ResultJson $false "" "JobDir missing: $JobDir"
}

if (-not $PromptPath) { $PromptPath = Join-Path $JobDir "prompt.md" }
if (-not (Test-Path -LiteralPath $PromptPath -PathType Leaf)) {
  Write-ResultJson $false "" "prompt.md missing: $PromptPath"
}

$promptText = Get-Content -LiteralPath $PromptPath -Raw -Encoding UTF8
if ([string]::IsNullOrWhiteSpace($promptText)) {
  Write-ResultJson $false "" "prompt.md empty"
}

$boot = @"
[Outpost Listing Promo] Execute this task now. Do not edit unrelated repo code.
1. This window's workspace IS the job folder. Follow the full prompt below (same as prompt.md).
2. Reference images are under refs/. Write finished jpg files to the absolute output directory in the prompt (usually out/).
3. When all required filenames exist, reply briefly with the written filename list.

---
"@
$fullText = $boot + $promptText
Log ("Clipboard text length=$($fullText.Length)")

Add-Type -AssemblyName System.Windows.Forms
# Clipboard needs STA; -File scripts are STA by default
try {
  [System.Windows.Forms.Clipboard]::SetText(
    $fullText,
    [System.Windows.Forms.TextDataFormat]::UnicodeText
  )
  Log "Clipboard SetText OK"
} catch {
  Write-ResultJson $false "" ("Clipboard failed: " + $_.Exception.Message)
}

$cursor = Resolve-CursorCmd
if (-not $cursor) {
  Write-ResultJson $false "" "Cursor not found. Set CURSOR_EXE or PATH."
}
Log "Cursor cmd=$cursor"

$beforePids = @(Get-Process -Name "Cursor" -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })

# Agent input is on the RIGHT chat panel (not window bottom — bottom is Terminal).
# Ratios are tunable: LISTING_PROMO_RPA_CLICK_X / LISTING_PROMO_RPA_CLICK_Y
$clickX = 0.82
$clickY = 0.78
if ($env:LISTING_PROMO_RPA_CLICK_X) {
  [void][double]::TryParse($env:LISTING_PROMO_RPA_CLICK_X, [ref]$clickX)
}
if ($env:LISTING_PROMO_RPA_CLICK_Y) {
  [void][double]::TryParse($env:LISTING_PROMO_RPA_CLICK_Y, [ref]$clickY)
}

# Skip workspace-trust modal that steals focus and conflicts with paste
$launchArgs = @(
  "-n",
  "--disable-workspace-trust",
  "--skip-welcome",
  "--skip-release-notes",
  $JobDir
)
try {
  Start-Process -FilePath $cursor -ArgumentList $launchArgs | Out-Null
  Log ("Started cursor args=" + ($launchArgs -join " "))
} catch {
  Write-ResultJson $false "" ("Start Cursor failed: " + $_.Exception.Message)
}

$waitMs = 10000
if ($env:LISTING_PROMO_RPA_WAIT_MS) {
  [void][int]::TryParse($env:LISTING_PROMO_RPA_WAIT_MS, [ref]$waitMs)
}
Log "Waiting ${waitMs}ms for window..."
Start-Sleep -Milliseconds $waitMs

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 15; $i++) {
  $hwnd = Find-CursorHwnd
  if ($hwnd -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 1000
}
if ($hwnd -eq [IntPtr]::Zero) {
  Write-ResultJson $false "" "No Cursor window found after launch"
}

if (-not (Focus-Window $hwnd)) {
  Log "SetForegroundWindow returned false; continuing anyway"
}
Start-Sleep -Milliseconds 800

# If a trust/modal still appears, Enter often confirms the default "Trust" button
if ($env:LISTING_PROMO_RPA_DISMISS_TRUST -ne "0") {
  Log "Send Enter once in case a modal is focused"
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Start-Sleep -Milliseconds 600
  Focus-Window $hwnd | Out-Null
}

# Do NOT send Ctrl+L / Ctrl+I by default — they toggle and CLOSE the Agent panel.
# Only if explicitly configured.
$openKeys = @()
if ($env:LISTING_PROMO_RPA_OPEN_KEYS) {
  $openKeys = $env:LISTING_PROMO_RPA_OPEN_KEYS.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
} elseif ($env:LISTING_PROMO_RPA_OPEN) {
  $openKeys = @($env:LISTING_PROMO_RPA_OPEN)
}
# Cursor Agent chat: plain Enter sends. Ctrl+Enter often does nothing (stuck after paste).
$sendKey = if ($env:LISTING_PROMO_RPA_SEND) { $env:LISTING_PROMO_RPA_SEND } else { "{ENTER}" }
$pasteWait = 1500
if ($env:LISTING_PROMO_RPA_PASTE_WAIT_MS) {
  [void][int]::TryParse($env:LISTING_PROMO_RPA_PASTE_WAIT_MS, [ref]$pasteWait)
}
$noSend = ($env:LISTING_PROMO_RPA_NO_SEND -eq "1")

try {
  foreach ($hk in $openKeys) {
    Focus-Window $hwnd | Out-Null
    Log "SendWait open hotkey: $hk"
    [System.Windows.Forms.SendKeys]::SendWait($hk)
    Start-Sleep -Milliseconds 900
  }

  # Click RIGHT Agent panel input (above terminal)
  Log "Click Agent input at ($clickX, $clickY)"
  Click-WindowPoint $hwnd $clickX $clickY | Out-Null
  Start-Sleep -Milliseconds 400
  Focus-Window $hwnd | Out-Null
  Click-WindowPoint $hwnd $clickX $clickY | Out-Null
  Start-Sleep -Milliseconds 250

  # Paste only (avoid Ctrl+A — may select editor/terminal instead)
  Log "SendWait Ctrl+V"
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds $pasteWait

  if (-not $noSend) {
    # Re-focus input after long paste so Enter lands on the composer, not the editor/terminal
    Focus-Window $hwnd | Out-Null
    Click-WindowPoint $hwnd $clickX $clickY | Out-Null
    Start-Sleep -Milliseconds 200
    Log "SendWait send key: $sendKey"
    [System.Windows.Forms.SendKeys]::SendWait($sendKey)
    Start-Sleep -Milliseconds 500
  } else {
    Log "NO_SEND=1, skipped send"
  }
} catch {
  Write-ResultJson $false "" ("SendKeys failed: " + $_.Exception.Message)
}

$resultPath = Join-Path $JobDir "rpa-result.json"
@{
  ok      = $true
  message = "Pasted prompt into Cursor (focus+click+hotkeys). Wait for Agent to write out/"
  error   = ""
  at      = (Get-Date).ToString("o")
  jobDir  = $JobDir
  cursor  = $cursor
  openKeys = $openKeys
  sendKey = $sendKey
  clickX  = $clickX
  clickY  = $clickY
  hwnd    = [int64]$hwnd
} | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8

Write-ResultJson $true "Pasted prompt into Cursor; waiting for out/ images"
