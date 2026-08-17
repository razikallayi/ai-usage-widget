<#
  Creates a one-click launcher shortcut in the project root and registers a
  delayed logon autostart.

  The delay exists so the widget does not compete with the rest of Windows
  startup - it polls four sources the moment it launches, which is wasteful
  while the machine is still settling.
#>

param(
    [int]$DelayMinutes = 2
)

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$iconPath = Join-Path $root 'assets\icon.ico'
$shortcutPath = Join-Path $root 'AI Usage Widget.lnk'
$taskName = 'AI Usage Widget'
$startupVbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'AI Usage Widget.vbs'

if (-not (Test-Path $electron)) {
    throw "Electron not found at $electron - run 'npm install' first"
}

# --- icon ------------------------------------------------------------------
if (-not (Test-Path $iconPath)) {
    Write-Host 'Generating icon...'
    & (Join-Path $PSScriptRoot 'make-icon.ps1')
}

# --- shortcut --------------------------------------------------------------
# Deliberately in the project root, not the Desktop or Start Menu. The argument
# is an absolute path so the working directory never matters.
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electron
$shortcut.Arguments = """$root"""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'AI usage for Claude, Codex, Copilot and Antigravity'
$shortcut.Save()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null

Write-Host "Shortcut  : $shortcutPath"

# --- autostart -------------------------------------------------------------
$delay = 'PT{0}M' -f $DelayMinutes
$registered = $false

try {
    $action = New-ScheduledTaskAction -Execute $electron -Argument """$root""" -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $trigger.Delay = $delay

    # ExecutionTimeLimit Zero means unlimited. Without it Task Scheduler kills
    # the task after its default 3 days, silently closing the widget.
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -DontStopOnIdleEnd `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    # RunLevel Limited keeps the widget non-elevated; an elevated always-on-top
    # window cannot exchange drag/drop or clipboard with normal apps.
    $principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERDOMAIN\$env:USERNAME" `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null

    $registered = $true
    Write-Host "Autostart : scheduled task '$taskName', $DelayMinutes min after logon"

    # A stale fallback would double-launch alongside the task.
    if (Test-Path $startupVbs) {
        Remove-Item $startupVbs -Force
        Write-Host 'Removed previous Startup-folder fallback'
    }
}
catch {
    Write-Warning "Scheduled task registration failed: $($_.Exception.Message)"
}

if (-not $registered) {
    # Needs no privileges at all, and shows up in Task Manager > Startup apps
    # where it can be toggled off.
    $ms = $DelayMinutes * 60 * 1000
    $vbs = @"
' Delayed launcher for the AI Usage Widget.
' Waits $DelayMinutes minute(s) after logon so the widget does not compete with
' the rest of Windows startup. Delete this file to disable autostart.
Set sh = CreateObject("WScript.Shell")
WScript.Sleep $ms
sh.Run """$electron"" ""$root""", 0, False
"@
    Set-Content -Path $startupVbs -Value $vbs -Encoding ASCII
    Write-Host "Autostart : Startup folder script, $DelayMinutes min after logon"
    Write-Host "            $startupVbs"
}

Write-Host ''
Write-Host 'Double-click "AI Usage Widget.lnk" in the project folder to launch.'
Write-Host 'Run "npm run launcher:remove" to undo all of this.'
