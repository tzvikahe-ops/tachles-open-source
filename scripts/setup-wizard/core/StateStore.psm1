Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "Types.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "Redaction.psm1") -Force

function Initialize-SetupDataDirectory {
  param([Parameter(Mandatory = $true)][string]$WorkspaceRoot)

  $dataRoot = Join-Path $WorkspaceRoot ".tachles-setup"
  $logsRoot = Join-Path $dataRoot "logs"

  New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
  Protect-SetupPath -Path $dataRoot

  return [pscustomobject]@{
    DataRoot = $dataRoot
    LogsRoot = $logsRoot
    StatePath = Join-Path $dataRoot "state.json"
  }
}

function Protect-SetupPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ($env:OS -ne "Windows_NT") {
    return
  }

  $icacls = Get-Command "icacls.exe" -ErrorAction SilentlyContinue
  if ($null -eq $icacls) {
    return
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $grant = if (Test-Path -LiteralPath $Path -PathType Container) {
    "${identity}:(OI)(CI)F"
  } else {
    "${identity}:F"
  }
  & $icacls.Source $Path "/inheritance:r" "/grant:r" $grant | Out-Null
}

function Backup-CorruptSetupState {
  param([Parameter(Mandatory = $true)][string]$StatePath)

  $timestamp = [DateTime]::UtcNow.ToString("yyyyMMddHHmmssfff")
  $backupPath = "$StatePath.corrupt-$timestamp"
  Move-Item -LiteralPath $StatePath -Destination $backupPath -Force
  return $backupPath
}

function Read-SetupState {
  param([Parameter(Mandatory = $true)][string]$StatePath)

  if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
    $state = New-SetupState
    Write-SetupState -StatePath $StatePath -State $state
    return $state
  }

  try {
    $state = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 |
      ConvertFrom-Json
    if (-not (Test-SetupState -State $state)) {
      throw "Invalid setup state."
    }
    return $state
  } catch {
    Backup-CorruptSetupState -StatePath $StatePath | Out-Null
    $state = New-SetupState
    Write-SetupState -StatePath $StatePath -State $state
    return $state
  }
}

function Write-SetupState {
  param(
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][object]$State
  )

  if (-not (Test-SetupState -State $State)) {
    throw "Refusing to write invalid setup state."
  }

  $State.updatedAt = [DateTime]::UtcNow.ToString("o")
  $directory = Split-Path -Parent $StatePath
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $temporaryPath = "$StatePath.tmp-$([Guid]::NewGuid().ToString('N'))"
  $json = $State | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText(
    $temporaryPath,
    $json,
    (New-Object Text.UTF8Encoding($false))
  )

  try {
    Move-Item -LiteralPath $temporaryPath -Destination $StatePath -Force
    Protect-SetupPath -Path $StatePath
  } finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

function Update-SetupState {
  param(
    [Parameter(Mandatory = $true)][string]$StatePath,
    [Parameter(Mandatory = $true)][hashtable]$Changes
  )

  $allowedChanges = @("activeStep", "installMode")
  foreach ($name in $Changes.Keys) {
    if ($name -notin $allowedChanges) {
      throw "Unsupported setup state field: $name"
    }
  }

  $state = Read-SetupState -StatePath $StatePath
  if ($Changes.ContainsKey("activeStep")) {
    $activeStep = [int]$Changes["activeStep"]
    if ($activeStep -lt 1 -or $activeStep -gt 8) {
      throw "activeStep must be between 1 and 8."
    }
    $state.activeStep = $activeStep
  }

  if ($Changes.ContainsKey("installMode")) {
    $installMode = $Changes["installMode"]
    if (-not (Test-SetupInstallMode -InstallMode $installMode)) {
      throw "installMode must be basic or full."
    }
    $state.installMode = $installMode
  }

  Write-SetupState -StatePath $StatePath -State $state
  return Read-SetupState -StatePath $StatePath
}

function Write-SetupLogEntry {
  param(
    [Parameter(Mandatory = $true)][string]$LogsRoot,
    [Parameter(Mandatory = $true)][string]$Message,
    [string[]]$Secrets = @()
  )

  New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
  $path = Join-Path $LogsRoot "$([DateTime]::UtcNow.ToString('yyyy-MM-dd')).log"
  $safeMessage = Protect-SetupLogText -Text $Message -Secrets $Secrets
  $line = "$([DateTime]::UtcNow.ToString('o')) $safeMessage"
  [IO.File]::AppendAllText(
    $path,
    $line + [Environment]::NewLine,
    (New-Object Text.UTF8Encoding($false))
  )
  Protect-SetupPath -Path $path
}

Export-ModuleMember -Function `
  Initialize-SetupDataDirectory, `
  Protect-SetupPath, `
  Read-SetupState, `
  Write-SetupState, `
  Update-SetupState, `
  Write-SetupLogEntry
