[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$wizardRoot = $PSScriptRoot
$serverModule = Join-Path $wizardRoot "server\SetupServer.psm1"

try {
  Import-Module $serverModule -Force

  $session = New-SetupSession -RequestedPort $Port
  $url = "http://127.0.0.1:$($session.Port)/?session=$($session.Token)"

  Write-Host ""
  Write-Host "אשף ההתקנה של תכלס"
  Write-Host "כתובת מקומית: $url"
  Write-Host "סגירת החלון תעצור את שרת ההתקנה."
  Write-Host ""

  if (-not $NoBrowser) {
    Start-Process $url | Out-Null
  }

  Start-SetupServer `
    -Port $session.Port `
    -Token $session.Token `
    -UiRoot (Join-Path $wizardRoot "ui")
} catch {
  Write-Host ""
  Write-Host "אשף ההתקנה לא הצליח להיפתח." -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}
