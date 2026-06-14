$ErrorActionPreference = "Stop"
$tests = Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.Tests.ps1" |
  Sort-Object Name

foreach ($test in $tests) {
  & $test.FullName
}

Write-Host "All setup wizard tests passed"

