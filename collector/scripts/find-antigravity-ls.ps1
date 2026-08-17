<#
  Locates Antigravity's local language server and prints { csrfToken, ports }.

  The Settings > Models & Usage panel is fed by this local server, not by a
  Google cloud endpoint - so reading it needs no OAuth token and never goes
  stale. The port is assigned at random on each launch (--https_server_port 0)
  and the CSRF token is regenerated per run, so both must be discovered live
  rather than cached.
#>

$ErrorActionPreference = 'Stop'

$proc = Get-CimInstance Win32_Process -Filter "Name='language_server.exe'" |
    Where-Object { $_.CommandLine -match 'csrf_token' } |
    Select-Object -First 1

if (-not $proc) {
    Write-Output (@{ error = 'not-running' } | ConvertTo-Json -Compress)
    exit 0
}

$token = $null
if ($proc.CommandLine -match '--csrf_token[=\s]+([0-9a-fA-F-]{36})') {
    $token = $Matches[1]
}
if (-not $token) {
    Write-Output (@{ error = 'no-csrf-token' } | ConvertTo-Json -Compress)
    exit 0
}

# The server listens on more than one port (one TLS, one plain). Emit them all
# and let the caller use whichever answers.
$ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -eq $proc.ProcessId } |
    Select-Object -ExpandProperty LocalPort -Unique)

if (-not $ports -or $ports.Count -eq 0) {
    Write-Output (@{ error = 'no-listening-port' } | ConvertTo-Json -Compress)
    exit 0
}

Write-Output (@{ csrfToken = $token; ports = @($ports) } | ConvertTo-Json -Compress)
