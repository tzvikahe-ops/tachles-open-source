$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "..\actions\Prerequisites.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Secrets.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Supabase.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Vercel.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Google.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Verification.psm1") -Force

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

Assert-Equal `
  ([version]"22.14.0") `
  (ConvertTo-SetupVersion -Text "v22.14.0") `
  "Node version parsing failed."
Assert-Equal `
  ([version]"2.101.0") `
  (ConvertTo-SetupVersion -Text "Supabase CLI 2.101") `
  "Two-part version parsing failed."
Assert-Equal $null (ConvertTo-SetupVersion -Text "unknown") "Invalid version was accepted."

$nodeInstall = Get-SetupPrerequisiteInstallCommand -Tool "node"
Assert-Equal "winget.exe" $nodeInstall.FilePath "Node installer is wrong."
Assert-True `
  (($nodeInstall.Arguments -join " ") -notmatch '[;&|]') `
  "Node installer contains shell metacharacters."
Assert-Equal `
  $null `
  (Get-SetupPrerequisiteInstallCommand -Tool "supabase") `
  "Supabase should use the official npx path."

$secretA = New-SetupRandomSecret
$secretB = New-SetupRandomSecret
Assert-True ($secretA.Length -ge 40) "Generated secret is too short."
Assert-True ($secretA -ne $secretB) "Generated secrets are not unique."

$root = Join-Path ([IO.Path]::GetTempPath()) "tachles-actions-$([Guid]::NewGuid())"
$envPath = Join-Path $root ".env.local"
try {
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  @"
SUPABASE_PROJECT_REF=abcdefghijklmnopqrst
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test
WEB_APP_URL=https://tachles-test.vercel.app
GOOGLE_CLIENT_ID=test.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=test-secret
"@ | Set-Content -LiteralPath $envPath -Encoding UTF8

  Initialize-SetupInternalSecrets -EnvPath $envPath
  $envText = Get-Content -LiteralPath $envPath -Raw
  Assert-True $envText.Contains("PROFILE_LINK_SECRET=") "Profile secret was not created."
  Assert-True $envText.Contains("DISPATCH_SECRET=") "Dispatch secret was not created."

  $supabase = Get-SetupSupabaseStatus -EnvPath $envPath
  Assert-True $supabase.configured "Supabase status was not detected."

  $vercel = Get-SetupVercelStatus -EnvPath $envPath
  Assert-True $vercel.configured "Vercel status was not detected."

  $google = Get-SetupGoogleGuidance -EnvPath $envPath
  Assert-True $google.configured "Google status was not detected."
  Assert-Equal `
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1/callback" `
    $google.authRedirect `
    "Google Auth redirect is wrong."
  Assert-Equal `
    "https://abcdefghijklmnopqrst.supabase.co/functions/v1/oauth-callback" `
    $google.integrationRedirect `
    "Google integration redirect is wrong."

  $unreachable = Test-SetupHttpEndpoint `
    -Name "unreachable" `
    -Url "http://127.0.0.1:1"
  Assert-Equal $false $unreachable.ready "Unreachable endpoint passed."
} finally {
  if (Test-Path -LiteralPath $root) {
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}

Write-Host "Actions.Tests.ps1 passed"
