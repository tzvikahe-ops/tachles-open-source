[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [string]$DatabasePassword = "",

  [string]$EnvFile = ".env.local",

  [switch]$IncludeTelegram
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot $EnvFile
$tempDir = Join-Path $repoRoot "supabase\.temp"
$vaultFile = Join-Path $tempDir "self-host-vault.sql"
$secretFile = Join-Path $tempDir "self-host-secrets.env"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Invoke-Supabase([string[]]$Arguments) {
  if (Get-Command "supabase" -ErrorAction SilentlyContinue) {
    & supabase @Arguments
  } else {
    & npx.cmd --yes supabase @Arguments
  }
}

function Protect-SecretFile([string]$Path) {
  $icacls = Get-Command "icacls.exe" -ErrorAction SilentlyContinue
  if ($null -eq $icacls) {
    return
  }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & $icacls.Source `
    $Path `
    "/inheritance:r" `
    "/grant:r" `
    "${identity}:F" |
    Out-Null
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

Require-Command "deno"
Require-Command "npm"
Require-Command "npx.cmd"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Environment file not found: $envPath"
}

$values = Read-DotEnv $envPath
$resolvedDatabasePassword = if (
  -not [string]::IsNullOrWhiteSpace($DatabasePassword)
) {
  $DatabasePassword
} else {
  [string]$values["SUPABASE_DB_PASSWORD"]
}
if ([string]::IsNullOrWhiteSpace($resolvedDatabasePassword)) {
  throw "Missing required value: SUPABASE_DB_PASSWORD"
}
$required = @(
  "PROFILE_LINK_SECRET",
  "DISPATCH_SECRET",
  "VAPID_SUBJECT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY"
)
$missing = @($required | Where-Object { -not $values[$_] })
if ($missing.Count -gt 0) {
  throw "Missing required values in ${EnvFile}: $($missing -join ', ')"
}

Push-Location $repoRoot
$previousDatabasePassword = $env:SUPABASE_DB_PASSWORD
$env:SUPABASE_DB_PASSWORD = $resolvedDatabasePassword
try {
  Write-Host "Linking Supabase project..."
  Invoke-Supabase @("link", "--project-ref", $ProjectRef)
  if ($LASTEXITCODE -ne 0) { throw "supabase link failed" }

  Write-Host "Applying database migrations..."
  Invoke-Supabase @("db", "push", "--include-all")
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
  $secretLines = @()
  foreach ($name in $secretNames) {
    if ($values[$name]) {
      $secretLines += "${name}=$($values[$name])"
    }
  }

  Write-Host "Uploading non-empty Edge Function secrets..."
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  [IO.File]::WriteAllLines(
    $secretFile,
    $secretLines,
    (New-Object Text.UTF8Encoding($false))
  )
  Protect-SecretFile -Path $secretFile
  try {
    Invoke-Supabase @(
      "secrets",
      "set",
      "--env-file",
      $secretFile,
      "--project-ref",
      $ProjectRef
    )
    if ($LASTEXITCODE -ne 0) { throw "supabase secrets set failed" }
  } finally {
    if (Test-Path -LiteralPath $secretFile) {
      Remove-Item -LiteralPath $secretFile -Force
    }
  }

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
    Invoke-Supabase $args
    if ($LASTEXITCODE -ne 0) {
      throw "Function deployment failed: $($deployment.Name)"
    }
  }

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
  $env:SUPABASE_DB_PASSWORD = $previousDatabasePassword
  Pop-Location
}
