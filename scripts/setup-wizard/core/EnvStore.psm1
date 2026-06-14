Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "StateStore.psm1") -Force

function Read-SetupEnv {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = [ordered]@{}
  if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $EnvPath -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([^=]+)=(.*)$') {
      continue
    }
    $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
  }

  return $values
}

function Set-SetupEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$EnvPath,
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowEmptyString()][Parameter(Mandatory = $true)][string]$Value
  )

  if ($Name -notmatch '^[A-Z][A-Z0-9_]*$') {
    throw "Invalid environment variable name."
  }

  $lines = @()
  if (Test-Path -LiteralPath $EnvPath -PathType Leaf) {
    $lines = @(Get-Content -LiteralPath $EnvPath -Encoding UTF8)
  }

  $escapedValue = $Value.Replace("`r", "").Replace("`n", "")
  $replacement = "$Name=$escapedValue"
  $found = $false

  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index] -match "^\s*$([regex]::Escape($Name))=") {
      $lines[$index] = $replacement
      $found = $true
      break
    }
  }

  if (-not $found) {
    if ($lines.Count -gt 0 -and $lines[-1] -ne "") {
      $lines += ""
    }
    $lines += $replacement
  }

  $directory = Split-Path -Parent $EnvPath
  if (-not [string]::IsNullOrWhiteSpace($directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  [IO.File]::WriteAllLines(
    $EnvPath,
    $lines,
    (New-Object Text.UTF8Encoding($false))
  )
  Protect-SetupPath -Path $EnvPath
}

function Get-SetupSecretStatus {
  param(
    [Parameter(Mandatory = $true)][string]$EnvPath,
    [Parameter(Mandatory = $true)][string[]]$Names
  )

  $values = Read-SetupEnv -EnvPath $EnvPath
  $status = [ordered]@{}
  foreach ($name in $Names) {
    $status[$name] = $values.Contains($name) -and
      -not [string]::IsNullOrWhiteSpace([string]$values[$name])
  }
  return $status
}

Export-ModuleMember -Function `
  Read-SetupEnv, `
  Set-SetupEnvValue, `
  Get-SetupSecretStatus
