Set-StrictMode -Version Latest

function New-SetupState {
  return [ordered]@{
    version = 1
    activeStep = 1
    installMode = $null
    updatedAt = [DateTime]::UtcNow.ToString("o")
    steps = [ordered]@{
      welcome = "pending"
      mode = "pending"
      prerequisites = "pending"
      supabase = "pending"
      vercel = "pending"
      capabilities = "pending"
      google = "pending"
      verification = "pending"
    }
  }
}

function Test-SetupActionStatus {
  param([AllowNull()][string]$Status)

  return $Status -in @(
    "pending",
    "running",
    "needs_user_action",
    "succeeded",
    "failed"
  )
}

function Test-SetupInstallMode {
  param([AllowNull()][string]$InstallMode)

  return [string]::IsNullOrWhiteSpace($InstallMode) -or
    $InstallMode -in @("basic", "full")
}

function Test-SetupState {
  param([Parameter(Mandatory = $true)][object]$State)

  if ($State.version -ne 1) {
    return $false
  }

  if ($State.activeStep -lt 1 -or $State.activeStep -gt 8) {
    return $false
  }

  if (-not (Test-SetupInstallMode -InstallMode $State.installMode)) {
    return $false
  }

  $expectedSteps = @(
    "welcome",
    "mode",
    "prerequisites",
    "supabase",
    "vercel",
    "capabilities",
    "google",
    "verification"
  )

  foreach ($step in $expectedSteps) {
    if ($null -eq $State.steps.$step -or
      -not (Test-SetupActionStatus -Status $State.steps.$step)) {
      return $false
    }
  }

  return $true
}

Export-ModuleMember -Function `
  New-SetupState, `
  Test-SetupActionStatus, `
  Test-SetupInstallMode, `
  Test-SetupState
