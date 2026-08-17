<#
  Removes everything install-launcher.ps1 creates. Each step is guarded so a
  partial install still cleans up fully.
#>

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$shortcutPath = Join-Path $root 'AI Usage Widget.lnk'
$taskName = 'AI Usage Widget'
$startupVbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'AI Usage Widget.vbs'

if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Removed shortcut       : $shortcutPath"
} else {
    Write-Host 'Shortcut               : not present'
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        Write-Host "Removed scheduled task : $taskName"
    }
    catch {
        Write-Warning "Could not remove scheduled task: $($_.Exception.Message)"
    }
} else {
    Write-Host 'Scheduled task         : not present'
}

if (Test-Path $startupVbs) {
    Remove-Item $startupVbs -Force
    Write-Host "Removed startup script : $startupVbs"
} else {
    Write-Host 'Startup script         : not present'
}

Write-Host ''
Write-Host 'The widget itself is untouched - "npm start" still works.'
