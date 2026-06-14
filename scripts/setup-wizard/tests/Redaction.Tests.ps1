$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\core\Redaction.psm1") -Force

function Assert-Hidden([string]$Text, [string]$Secret, [string]$Message) {
  if ($Text.Contains($Secret)) {
    throw $Message
  }
}

$secret = "sk-test-special+/="
$encoded = [Uri]::EscapeDataString($secret)
$input = @"
Authorization: Bearer abc123
api_key=visible-key
password: visible-password
direct=$secret
url=https://example.test/?key=$encoded
"@

$output = Protect-SetupLogText -Text $input -Secrets @($secret)
Assert-Hidden $output "abc123" "Bearer token was not hidden."
Assert-Hidden $output "visible-key" "API key was not hidden."
Assert-Hidden $output "visible-password" "Password was not hidden."
Assert-Hidden $output $secret "Known secret was not hidden."
Assert-Hidden $output $encoded "Encoded secret was not hidden."

Write-Host "Redaction.Tests.ps1 passed"
