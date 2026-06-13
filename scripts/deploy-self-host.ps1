[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [Parameter(Mandatory = $true)]
  [string]$DatabasePassword,

  [string]$EnvFile = ".env.local",

  [switch]$IncludeTelegram
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot $EnvFile
$tempDir = Join-Path $repoRoot "supabase\.temp"
$vaultFile = Join-Path $tempDir "self-host-vault.sql"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([^=]+)=(.*)$') {
      continue
    }
    $name = $matches[1].Trim()
    $value = $matches[2].Trim().Trim('"').Trim("'")
    $values[$name] = $value
  }
  return $values
}

Require-Command "supabase"
Require-Command "deno"
Require-Command "npm"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Environment file not found: $envPath"
}

$values = Read-DotEnv $envPath
$required = @(
  "WEB_APP_URL",
  "PROFILE_LINK_SECRET",
  "DISPATCH_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "VAPID_SUBJECT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY"
)
$missing = @($required | Where-Object { -not $values[$_] })
if ($missing.Count -gt 0) {
  throw "Missing required values in ${EnvFile}: $($missing -join ', ')"
}

Push-Location $repoRoot
try {
  Write-Host "Linking Supabase project..."
  & supabase link --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw "supabase link failed" }

  Write-Host "Applying database migrations..."
  & supabase db push --password $DatabasePassword --include-all
  if ($LASTEXITCODE -ne 0) { throw "supabase db push failed" }

  $secretNames = @(
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "BOT_USERNAME",
    "MINI_APP_URL",
    "WEB_APP_URL",
    "WEB_ALLOWED_EMAILS",
    "PROFILE_LINK_SECRET",
    "DISPATCH_SECRET",
    "ANTHROPIC_API_KEY",
    "LLM_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_RESEARCH_MODEL",
    "OPENAI_TRANSCRIBE_MODEL",
    "OPENAI_EMBEDDING_MODEL",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "OAUTH_REDIRECT_URI",
    "VAPID_SUBJECT",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY"
  )
  $secretArgs = @("secrets", "set")
  foreach ($name in $secretNames) {
    if ($values[$name]) {
      $secretArgs += "${name}=$($values[$name])"
    }
  }
  $secretArgs += @("--project-ref", $ProjectRef)

  Write-Host "Uploading non-empty Edge Function secrets..."
  & supabase @secretArgs
  if ($LASTEXITCODE -ne 0) { throw "supabase secrets set failed" }

  $deployments = @(
    @{ Name = "api-web"; NoVerify = $true },
    @{ Name = "dispatch-reminders"; NoVerify = $false },
    @{ Name = "sync-calendars"; NoVerify = $false },
    @{ Name = "agent-tick"; NoVerify = $false },
    @{ Name = "snapshot-daily"; NoVerify = $false },
    @{ Name = "oauth-callback"; NoVerify = $true }
  )
  if ($IncludeTelegram) {
    $deployments += @(
      @{ Name = "telegram-webhook"; NoVerify = $true },
      @{ Name = "api"; NoVerify = $true }
    )
  }

  foreach ($deployment in $deployments) {
    Write-Host "Deploying $($deployment.Name)..."
    $args = @("functions", "deploy", $deployment.Name, "--project-ref", $ProjectRef)
    if ($deployment.NoVerify) { $args += "--no-verify-jwt" }
    & supabase @args
    if ($LASTEXITCODE -ne 0) {
      throw "Function deployment failed: $($deployment.Name)"
    }
  }

  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $dispatchSecret = $values["DISPATCH_SECRET"].Replace("'", "''")
  $baseUrl = "https://$ProjectRef.supabase.co/functions/v1"
  @"
delete from vault.secrets
where name in (
  'dispatch_reminders_url',
  'sync_calendars_url',
  'agent_tick_url',
  'snapshot_daily_url',
  'dispatch_secret'
);

select vault.create_secret('$baseUrl/dispatch-reminders', 'dispatch_reminders_url');
select vault.create_secret('$baseUrl/sync-calendars', 'sync_calendars_url');
select vault.create_secret('$baseUrl/agent-tick', 'agent_tick_url');
select vault.create_secret('$baseUrl/snapshot-daily', 'snapshot_daily_url');
select vault.create_secret('$dispatchSecret', 'dispatch_secret');
"@ | Set-Content -LiteralPath $vaultFile -Encoding utf8

  Write-Host ""
  Write-Host "Backend deployment completed."
  Write-Host "Run this generated file in the Supabase SQL Editor:"
  Write-Host $vaultFile
  Write-Host "Delete it after the Vault secrets are created."
} finally {
  Pop-Location
}
