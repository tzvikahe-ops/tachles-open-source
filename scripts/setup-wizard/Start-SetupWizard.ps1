[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$wizardRoot = $PSScriptRoot
$serverModule = Join-Path $wizardRoot "server\SetupServer.psm1"
$messagesPath = Join-Path $wizardRoot "messages.he.json"
$messages = Get-Content -LiteralPath $messagesPath -Raw -Encoding UTF8 |
  ConvertFrom-Json
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

try {
  Import-Module $serverModule -Force

  $session = New-SetupSession -RequestedPort $Port
  $url = "http://127.0.0.1:$($session.Port)/?session=$($session.Token)"

  Write-Host ""
  Write-Host $messages.wizardTitle
  Write-Host "$($messages.localAddress): $url"
  Write-Host $messages.closeHint
  Write-Host ""

  if (-not $NoBrowser) {
    Start-Process $url | Out-Null
  }

  $serverParameters = @{
    Port = $session.Port
    Token = $session.Token
    UiRoot = Join-Path $wizardRoot "ui"
  }
  Start-SetupServer @serverParameters
} catch {
  Write-Host ""
  Write-Host $messages.startFailed -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}
