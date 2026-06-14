Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "..\core\EnvStore.psm1") -Force

function Get-SetupGoogleGuidance {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  $projectRef = [string]$values["SUPABASE_PROJECT_REF"]
  $validRef = $projectRef -match '^[a-z0-9]{20}$'
  return [ordered]@{
    configured = $validRef -and
      -not [string]::IsNullOrWhiteSpace([string]$values["GOOGLE_CLIENT_ID"]) -and
      -not [string]::IsNullOrWhiteSpace([string]$values["GOOGLE_CLIENT_SECRET"])
    cloudConsoleUrl = "https://console.cloud.google.com/apis/credentials"
    consentUrl = "https://console.cloud.google.com/auth/audience"
    calendarApiUrl =
      "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
    driveApiUrl =
      "https://console.cloud.google.com/apis/library/drive.googleapis.com"
    authRedirect = if ($validRef) {
      "https://$projectRef.supabase.co/auth/v1/callback"
    } else { $null }
    integrationRedirect = if ($validRef) {
      "https://$projectRef.supabase.co/functions/v1/oauth-callback"
    } else { $null }
  }
}

function Invoke-SetupGoogleDeploy {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$EnvPath
  )

  $values = Read-SetupEnv -EnvPath $EnvPath
  $projectRef = [string]$values["SUPABASE_PROJECT_REF"]
  $clientId = [string]$values["GOOGLE_CLIENT_ID"]
  $clientSecret = [string]$values["GOOGLE_CLIENT_SECRET"]
  $redirect = [string]$values["OAUTH_REDIRECT_URI"]
  if ($projectRef -notmatch '^[a-z0-9]{20}$' -or
    [string]::IsNullOrWhiteSpace($clientId) -or
    [string]::IsNullOrWhiteSpace($clientSecret) -or
    [string]::IsNullOrWhiteSpace($redirect)) {
    throw "Google configuration is incomplete."
  }

  $temporaryPath = Join-Path $WorkspaceRoot ".tachles-setup\runtime\google.env"
  $directory = Split-Path -Parent $temporaryPath
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  [IO.File]::WriteAllLines(
    $temporaryPath,
    @(
      "GOOGLE_CLIENT_ID=$clientId",
      "GOOGLE_CLIENT_SECRET=$clientSecret",
      "OAUTH_REDIRECT_URI=$redirect"
    ),
    (New-Object Text.UTF8Encoding($false))
  )
  try {
    if (Get-Command "supabase" -ErrorAction SilentlyContinue) {
      & supabase secrets set `
        --env-file $temporaryPath `
        --project-ref $projectRef
    } else {
      & npx.cmd --yes supabase secrets set `
        --env-file $temporaryPath `
        --project-ref $projectRef
    }
    if ($LASTEXITCODE -ne 0) { throw "Google secret upload failed." }

    $deployArgs = @(
      "functions",
      "deploy",
      "oauth-callback",
      "--no-verify-jwt",
      "--project-ref",
      $projectRef
    )
    if (Get-Command "supabase" -ErrorAction SilentlyContinue) {
      & supabase @deployArgs
    } else {
      & npx.cmd --yes supabase @deployArgs
    }
    if ($LASTEXITCODE -ne 0) { throw "OAuth callback deployment failed." }
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

Export-ModuleMember -Function `
  Get-SetupGoogleGuidance, `
  Invoke-SetupGoogleDeploy
