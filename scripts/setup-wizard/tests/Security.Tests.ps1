$ErrorActionPreference = "Stop"
$module = Join-Path $PSScriptRoot "..\server\Security.psm1"
Import-Module $module -Force

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-False([bool]$Condition, [string]$Message) {
  if ($Condition) {
    throw $Message
  }
}

$tokenA = New-SetupToken
$tokenB = New-SetupToken

Assert-True ($tokenA.Length -ge 40) "Token is too short."
Assert-False ($tokenA -eq $tokenB) "Tokens should be unique."
Assert-True (Test-SetupToken -Expected $tokenA -Actual $tokenA) "Matching token was rejected."
Assert-False (Test-SetupToken -Expected $tokenA -Actual $tokenB) "Wrong token was accepted."
Assert-False (Test-SetupToken -Expected $tokenA -Actual $null) "Missing token was accepted."

Assert-True (Test-SetupOrigin -Origin $null -Port 54321) "Missing Origin should be allowed."
Assert-True (
  Test-SetupOrigin -Origin "http://127.0.0.1:54321" -Port 54321
) "Local Origin was rejected."
Assert-False (
  Test-SetupOrigin -Origin "http://localhost:54321" -Port 54321
) "Unexpected hostname was accepted."
Assert-False (
  Test-SetupOrigin -Origin "https://example.com" -Port 54321
) "Remote Origin was accepted."

$uiRoot = Join-Path $PSScriptRoot "..\ui"
$index = Resolve-SetupStaticFile -UiRoot $uiRoot -RequestPath "/"
$scriptFile = Resolve-SetupStaticFile -UiRoot $uiRoot -RequestPath "/app.js"
$traversal = Resolve-SetupStaticFile -UiRoot $uiRoot -RequestPath "/../Start-SetupWizard.ps1"

Assert-True (-not [string]::IsNullOrWhiteSpace($index)) "Index file was not resolved."
Assert-True (-not [string]::IsNullOrWhiteSpace($scriptFile)) "Script file was not resolved."
Assert-True ($null -eq $traversal) "Path traversal was accepted."

Write-Host "Security.Tests.ps1 passed"

