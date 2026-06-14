$ErrorActionPreference = "Stop"
$wizardRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$files = Get-ChildItem -LiteralPath $wizardRoot -Recurse -File |
  Where-Object { $_.Extension -in @(".ps1", ".psm1") }

foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile(
    $file.FullName,
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null

  if ($errors.Count -gt 0) {
    $messages = $errors | ForEach-Object {
      "$($_.Message) at line $($_.Extent.StartLineNumber)"
    }
    throw "PowerShell syntax failed for $($file.FullName): $($messages -join '; ')"
  }
}

Write-Host "Syntax.Tests.ps1 passed"
