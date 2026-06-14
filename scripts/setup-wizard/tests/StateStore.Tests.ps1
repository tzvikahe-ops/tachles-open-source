$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\core\StateStore.psm1") -Force

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

$root = Join-Path ([IO.Path]::GetTempPath()) "tachles-state-$([Guid]::NewGuid())"
try {
  $paths = Initialize-SetupDataDirectory -WorkspaceRoot $root
  $state = Read-SetupState -StatePath $paths.StatePath
  Assert-Equal 1 $state.activeStep "Default active step is wrong."

  $state = Update-SetupState -StatePath $paths.StatePath -Changes @{
    activeStep = 2
    installMode = "full"
  }
  Assert-Equal 2 $state.activeStep "Active step was not persisted."
  Assert-Equal "full" $state.installMode "Install mode was not persisted."

  Set-Content -LiteralPath $paths.StatePath -Value "{broken" -Encoding UTF8
  $recovered = Read-SetupState -StatePath $paths.StatePath
  Assert-Equal 1 $recovered.activeStep "Corrupt state did not reset."
  $backups = @(Get-ChildItem -LiteralPath $paths.DataRoot -Filter "state.json.corrupt-*")
  Assert-Equal 1 $backups.Count "Corrupt state backup was not created."

  $temporaryFiles = @(Get-ChildItem -LiteralPath $paths.DataRoot -Filter "*.tmp-*")
  Assert-Equal 0 $temporaryFiles.Count "Atomic state temporary files remain."
} finally {
  if (Test-Path -LiteralPath $root) {
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}

Write-Host "StateStore.Tests.ps1 passed"

