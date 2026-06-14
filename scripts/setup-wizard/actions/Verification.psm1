Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "..\core\EnvStore.psm1") -Force

function Test-SetupHttpEndpoint {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Url,
    [int[]]$AllowedStatus = @(200),
    [hashtable]$Headers = @{}
  )

  try {
    $response = Invoke-WebRequest `
      -Uri $Url `
      -Method Get `
      -UseBasicParsing `
      -MaximumRedirection 5 `
      -Headers $Headers `
      -TimeoutSec 20
    $status = [int]$response.StatusCode
    return [ordered]@{
      name = $Name
      ready = $status -in $AllowedStatus
      status = $status
      url = $Url
    }
  } catch {
    $status = if ($null -ne $_.Exception.Response) {
      [int]$_.Exception.Response.StatusCode
    } else {
      0
    }
    return [ordered]@{
      name = $Name
      ready = $status -in $AllowedStatus
      status = $status
      url = $Url
    }
  }
}

function Get-SetupVerificationReport {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  $projectRef = [string]$values["SUPABASE_PROJECT_REF"]
  $webUrl = [string]$values["WEB_APP_URL"]
  $checks = @()
  if ($webUrl -match '^https://') {
    $checks += Test-SetupHttpEndpoint -Name "pwa" -Url $webUrl
  }
  if ($projectRef -match '^[a-z0-9]{20}$') {
    $publishableKey = [string]$values["VITE_SUPABASE_PUBLISHABLE_KEY"]
    if (-not [string]::IsNullOrWhiteSpace($publishableKey)) {
      $checks += Test-SetupHttpEndpoint `
        -Name "auth-settings" `
        -Url "https://$projectRef.supabase.co/auth/v1/settings" `
        -Headers @{ apikey = $publishableKey }
    }
    $checks += Test-SetupHttpEndpoint `
      -Name "api-web-auth" `
      -Url "https://$projectRef.supabase.co/functions/v1/api-web/tasks" `
      -AllowedStatus @(401)
  }

  return [ordered]@{
    ready = $checks.Count -ge 3 -and
      @($checks | Where-Object { -not $_.ready }).Count -eq 0
    checks = $checks
    webAppUrl = if ($webUrl -match '^https://') { $webUrl } else { $null }
    supabaseDashboard = if ($projectRef -match '^[a-z0-9]{20}$') {
      "https://supabase.com/dashboard/project/$projectRef"
    } else { $null }
    vercelDashboard = "https://vercel.com/dashboard"
    capabilities = [ordered]@{
      ai = -not [string]::IsNullOrWhiteSpace(
        [string]$values["ANTHROPIC_API_KEY"]
      ) -and -not [string]::IsNullOrWhiteSpace(
        [string]$values["OPENAI_API_KEY"]
      )
      push = -not [string]::IsNullOrWhiteSpace(
        [string]$values["VAPID_PUBLIC_KEY"]
      )
      google = -not [string]::IsNullOrWhiteSpace(
        [string]$values["GOOGLE_CLIENT_ID"]
      )
    }
  }
}

Export-ModuleMember -Function `
  Test-SetupHttpEndpoint, `
  Get-SetupVerificationReport
