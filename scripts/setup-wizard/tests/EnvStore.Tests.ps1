$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\core\EnvStore.psm1") -Force

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

$root = Join-Path ([IO.Path]::GetTempPath()) "tachles-env-$([Guid]::NewGuid())"
$envPath = Join-Path $root ".env.local"
try {
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  @(
    "# preserved comment",
    "UNKNOWN_VALUE=keep-me",
    "OPENAI_API_KEY=old"
  ) | Set-Content -LiteralPath $envPath -Encoding UTF8

  Set-SetupEnvValue -EnvPath $envPath -Name "OPENAI_API_KEY" -Value "new-secret"
  Set-SetupEnvValue -EnvPath $envPath -Name "ANTHROPIC_API_KEY" -Value "anthropic-secret"

  $content = Get-Content -LiteralPath $envPath -Raw -Encoding UTF8
  Assert-True ($content -match '# preserved comment') "Comment was removed."
  Assert-True ($content -match 'UNKNOWN_VALUE=keep-me') "Unknown value was removed."
  Assert-True ($content -match 'OPENAI_API_KEY=new-secret') "Value was not updated."
  Assert-True ($content -match 'ANTHROPIC_API_KEY=anthropic-secret') "Value was not added."

  $status = Get-SetupSecretStatus -EnvPath $envPath -Names @(
    "OPENAI_API_KEY",
    "GOOGLE_CLIENT_SECRET"
  )
  Assert-True $status.OPENAI_API_KEY "Configured secret was not reported."
  Assert-True (-not $status.GOOGLE_CLIENT_SECRET) "Missing secret was reported."

  $singleLinePath = Join-Path $root "single.env"
  Set-Content -LiteralPath $singleLinePath -Value "OPENAI_API_KEY=first" -Encoding UTF8
  Set-SetupEnvValue -EnvPath $singleLinePath -Name "OPENAI_API_KEY" -Value "second"
  $singleLine = Get-Content -LiteralPath $singleLinePath -Raw -Encoding UTF8
  Assert-True ($singleLine -match 'OPENAI_API_KEY=second') "Single-line env update failed."
} finally {
  if (Test-Path -LiteralPath $root) {
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}

Write-Host "EnvStore.Tests.ps1 passed"
