$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\server\Router.psm1") -Force

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

$definition = Get-SetupActionDefinition -Name "local_check"
Assert-Equal "local_check" $definition.Name "Action name is wrong."
Assert-Equal "prerequisites" $definition.Step "Action step is wrong."
Assert-Equal "powershell.exe" $definition.FilePath "Action executable is wrong."

$argumentText = $definition.Arguments -join " "
if ($argumentText.Contains("local_check")) {
  throw "Action name was interpolated into command arguments."
}
if ($null -ne (Get-SetupActionDefinition -Name "../local_check")) {
  throw "Path-like action name was accepted."
}
if ($null -ne (Get-SetupActionDefinition -Name "local_check; whoami")) {
  throw "Command-like action name was accepted."
}

Write-Host "Router.Tests.ps1 passed"
