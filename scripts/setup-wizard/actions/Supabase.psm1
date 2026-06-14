Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "..\core\EnvStore.psm1") -Force

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Invoke-SetupSupabaseCommand {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  if (Get-Command "supabase" -ErrorAction SilentlyContinue) {
    & supabase @Arguments
  } else {
    & npx.cmd --yes supabase @Arguments
  }
}

function Invoke-SetupSupabaseDeploy {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$EnvPath
  )

  $values = Read-SetupEnv -EnvPath $EnvPath
  $projectRef = [string]$values["SUPABASE_PROJECT_REF"]
  $databasePassword = [string]$values["SUPABASE_DB_PASSWORD"]
  if ($projectRef -notmatch '^[a-z0-9]{20}$') {
    throw "SUPABASE_PROJECT_REF is missing or invalid."
  }
  if ([string]::IsNullOrWhiteSpace($databasePassword)) {
    throw "SUPABASE_DB_PASSWORD is missing."
  }
  if ([string]::IsNullOrWhiteSpace([string]$values["WEB_APP_URL"])) {
    Set-SetupEnvValue `
      -EnvPath $EnvPath `
      -Name "WEB_APP_URL" `
      -Value "http://localhost:5173"
  }

  $scriptPath = Join-Path $WorkspaceRoot "scripts\deploy-self-host.ps1"
  Invoke-CheckedCommand `
    -FilePath "powershell.exe" `
    -Arguments @(
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $scriptPath,
      "-ProjectRef",
      $projectRef,
      "-EnvFile",
      ".env.local"
    ) `
    -FailureMessage "Supabase deployment failed."
}

function Invoke-SetupSupabasePrepare {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  $projectRef = [string]$values["SUPABASE_PROJECT_REF"]
  $databasePassword = [string]$values["SUPABASE_DB_PASSWORD"]
  if ($projectRef -notmatch '^[a-z0-9]{20}$') {
    throw "SUPABASE_PROJECT_REF is missing or invalid."
  }
  if ([string]::IsNullOrWhiteSpace($databasePassword)) {
    throw "SUPABASE_DB_PASSWORD is missing."
  }

  $previousDatabasePassword = $env:SUPABASE_DB_PASSWORD
  $env:SUPABASE_DB_PASSWORD = $databasePassword
  try {
    Invoke-SetupSupabaseCommand @("link", "--project-ref", $projectRef)
    if ($LASTEXITCODE -ne 0) { throw "Supabase project link failed." }
    Invoke-SetupSupabaseCommand @("db", "push", "--include-all")
    if ($LASTEXITCODE -ne 0) { throw "Supabase migration failed." }
  } finally {
    $env:SUPABASE_DB_PASSWORD = $previousDatabasePassword
  }
}

function Get-SetupSupabaseStatus {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  $projectRef = [string]$values["SUPABASE_PROJECT_REF"]
  return [ordered]@{
    configured = $projectRef -match '^[a-z0-9]{20}$' -and
      -not [string]::IsNullOrWhiteSpace([string]$values["VITE_SUPABASE_PUBLISHABLE_KEY"])
    projectRef = if ($projectRef -match '^[a-z0-9]{20}$') { $projectRef } else { $null }
    dashboardUrl = if ($projectRef -match '^[a-z0-9]{20}$') {
      "https://supabase.com/dashboard/project/$projectRef"
    } else {
      "https://supabase.com/dashboard/projects"
    }
    vaultFileReady = Test-Path (
      Join-Path (Split-Path -Parent $EnvPath) "supabase\.temp\self-host-vault.sql"
    )
  }
}

Export-ModuleMember -Function `
  Invoke-SetupSupabasePrepare, `
  Invoke-SetupSupabaseDeploy, `
  Get-SetupSupabaseStatus
