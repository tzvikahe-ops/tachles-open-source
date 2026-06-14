Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "..\core\EnvStore.psm1") -Force

function Invoke-SetupVercelCommand {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  if (Get-Command "vercel.cmd" -ErrorAction SilentlyContinue) {
    & vercel.cmd @Arguments
  } else {
    & npx.cmd --yes vercel @Arguments
  }
}

function Invoke-SetupVercelInputCommand {
  param(
    [Parameter(Mandatory = $true)][string]$InputValue,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  if (Get-Command "vercel.cmd" -ErrorAction SilentlyContinue) {
    $InputValue | & vercel.cmd @Arguments
  } else {
    $InputValue | & npx.cmd --yes vercel @Arguments
  }
}

function Invoke-SetupVercelDeploy {
  param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$EnvPath
  )

  $values = Read-SetupEnv -EnvPath $EnvPath
  foreach ($name in @(
      "SUPABASE_PROJECT_REF",
      "VITE_SUPABASE_PUBLISHABLE_KEY"
    )) {
    if ([string]::IsNullOrWhiteSpace([string]$values[$name])) {
      throw "$name is missing."
    }
  }

  $projectRef = [string]$values["SUPABASE_PROJECT_REF"]
  $webRoot = Join-Path $WorkspaceRoot "apps\web-app"
  $webEnv = Join-Path $webRoot ".env"
  $lines = @(
    "VITE_SUPABASE_URL=https://$projectRef.supabase.co",
    "VITE_SUPABASE_PUBLISHABLE_KEY=$($values['VITE_SUPABASE_PUBLISHABLE_KEY'])",
    "VITE_API_BASE=https://$projectRef.supabase.co/functions/v1/api-web"
  )
  [IO.File]::WriteAllLines(
    $webEnv,
    $lines,
    (New-Object Text.UTF8Encoding($false))
  )

  Push-Location $webRoot
  try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "Web app dependency install failed." }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Web app build failed." }
    Invoke-SetupVercelCommand @("link", "--yes")
    if ($LASTEXITCODE -ne 0) { throw "Vercel project link failed." }

    $vercelValues = [ordered]@{
      VITE_SUPABASE_URL = "https://$projectRef.supabase.co"
      VITE_SUPABASE_PUBLISHABLE_KEY =
        [string]$values["VITE_SUPABASE_PUBLISHABLE_KEY"]
      VITE_API_BASE = "https://$projectRef.supabase.co/functions/v1/api-web"
    }
    foreach ($name in $vercelValues.Keys) {
      Invoke-SetupVercelInputCommand `
        -InputValue $vercelValues[$name] `
        -Arguments @("env", "add", $name, "production", "--force")
      if ($LASTEXITCODE -ne 0) {
        throw "Vercel environment variable update failed: $name"
      }
    }

    $output = Invoke-SetupVercelCommand @("--prod", "--yes") 2>&1 |
      Tee-Object -Variable deployment
    if ($LASTEXITCODE -ne 0) { throw "Vercel deployment failed." }
  } finally {
    Pop-Location
  }

  $url = @($deployment) |
    ForEach-Object {
      [regex]::Matches([string]$_, 'https://[a-zA-Z0-9.-]+\.vercel\.app')
    } |
    ForEach-Object { $_.Value } |
    Select-Object -Last 1
  if ($url -notmatch '^https://') {
    throw "Vercel did not return a production URL."
  }
  $webAppUrl = $url.TrimEnd("/")
  Set-SetupEnvValue -EnvPath $EnvPath -Name "WEB_APP_URL" -Value $webAppUrl
  Write-Output "TACHLES_WEB_APP_URL=$webAppUrl"
}

function Get-SetupVercelStatus {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  $url = [string]$values["WEB_APP_URL"]
  return [ordered]@{
    configured = $url -match '^https://'
    url = if ($url -match '^https://') { $url } else { $null }
    dashboardUrl = "https://vercel.com/dashboard"
  }
}

Export-ModuleMember -Function `
  Invoke-SetupVercelDeploy, `
  Get-SetupVercelStatus
