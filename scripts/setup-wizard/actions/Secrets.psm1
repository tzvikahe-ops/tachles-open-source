Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "..\core\EnvStore.psm1") -Force

function New-SetupRandomSecret {
  param([int]$ByteCount = 32)

  $bytes = New-Object byte[] $ByteCount
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Initialize-SetupInternalSecrets {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  foreach ($name in @("PROFILE_LINK_SECRET", "DISPATCH_SECRET")) {
    if (-not $values.Contains($name) -or
      [string]::IsNullOrWhiteSpace([string]$values[$name])) {
      Set-SetupEnvValue `
        -EnvPath $EnvPath `
        -Name $name `
        -Value (New-SetupRandomSecret)
    }
  }
}

function Initialize-SetupVapidKeys {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  if ($values["VAPID_PUBLIC_KEY"] -and $values["VAPID_PRIVATE_KEY"]) {
    return
  }

  $json = & npx.cmd --yes web-push generate-vapid-keys --json 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "VAPID key generation failed."
  }
  $keys = $json | ConvertFrom-Json
  Set-SetupEnvValue -EnvPath $EnvPath -Name "VAPID_PUBLIC_KEY" -Value $keys.publicKey
  Set-SetupEnvValue -EnvPath $EnvPath -Name "VAPID_PRIVATE_KEY" -Value $keys.privateKey
}

function Test-SetupAiKeys {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  $anthropicKey = [string]$values["ANTHROPIC_API_KEY"]
  $openAiKey = [string]$values["OPENAI_API_KEY"]
  if ([string]::IsNullOrWhiteSpace($anthropicKey) -or
    [string]::IsNullOrWhiteSpace($openAiKey)) {
    throw "Both AI keys are required for the full installation."
  }

  Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.anthropic.com/v1/messages" `
    -Headers @{
      "x-api-key" = $anthropicKey
      "anthropic-version" = "2023-06-01"
      "content-type" = "application/json"
    } `
    -Body (@{
      model = "claude-sonnet-4-6"
      max_tokens = 1
      messages = @(@{ role = "user"; content = "ok" })
    } | ConvertTo-Json -Depth 5 -Compress) `
    -TimeoutSec 30 |
    Out-Null

  Invoke-RestMethod `
    -Method Get `
    -Uri "https://api.openai.com/v1/models" `
    -Headers @{ Authorization = "Bearer $openAiKey" } `
    -TimeoutSec 30 |
    Out-Null
}

Export-ModuleMember -Function `
  New-SetupRandomSecret, `
  Initialize-SetupInternalSecrets, `
  Initialize-SetupVapidKeys, `
  Test-SetupAiKeys
