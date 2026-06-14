$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\core\ProcessRunner.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\server\Router.psm1") -Force

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

function Wait-ForAction([object]$Runner, [string]$LogsRoot, [string[]]$Secrets) {
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    $state = Update-SetupProcessRunner `
      -Runner $Runner `
      -LogsRoot $LogsRoot `
      -Secrets $Secrets
    if ($state.status -ne "running") {
      return $state
    }
    Start-Sleep -Milliseconds 50
  }
  throw "Action did not finish in time."
}

$root = Join-Path ([IO.Path]::GetTempPath()) "tachles-runner-$([Guid]::NewGuid())"
$runtimeRoot = Join-Path $root "runtime"
$logsRoot = Join-Path $root "logs"

try {
  New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
  $runner = New-SetupProcessRunner -RuntimeRoot $runtimeRoot
  $definition = Get-SetupActionDefinition -Name "local_check"
  $started = Start-SetupProcess -Runner $runner -Definition $definition
  Assert-Equal "running" $started.status "Action did not start."

  $parallelBlocked = $false
  try {
    Start-SetupProcess -Runner $runner -Definition $definition | Out-Null
  } catch {
    $parallelBlocked = $true
  }
  Assert-Equal $true $parallelBlocked "Parallel action was not blocked."

  $completed = Wait-ForAction `
    -Runner $runner `
    -LogsRoot $logsRoot `
    -Secrets @()
  if ($completed.status -ne "succeeded") {
    $failureLog = Get-ChildItem -LiteralPath $logsRoot -File |
      ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
    $completedJson = $completed | ConvertTo-Json -Depth 5 -Compress
    throw "Action failed: $completedJson Log: $failureLog"
  }
  Assert-Equal 0 $completed.exitCode "Action exit code is wrong."

  $logText = Get-ChildItem -LiteralPath $logsRoot -File |
    ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
  if (-not (($logText -join "`n").Contains("Local setup check completed."))) {
    throw "Action output was not written to the safe log."
  }

  $secret = "runner-secret-91827"
  $secretDefinition = [pscustomobject]@{
    Name = "secret_test"
    Step = "prerequisites"
    FilePath = "powershell.exe"
    Arguments = @(
      "-NoLogo",
      "-NoProfile",
      "-Command",
      "Write-Output '$secret'"
    )
  }
  Start-SetupProcess -Runner $runner -Definition $secretDefinition | Out-Null
  Wait-ForAction `
    -Runner $runner `
    -LogsRoot $logsRoot `
    -Secrets @($secret) |
    Out-Null
  $safeLogText = Get-ChildItem -LiteralPath $logsRoot -File |
    ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
  if (($safeLogText -join "`n").Contains($secret)) {
    throw "Known secret was written to the process log."
  }

  $cancelDefinition = [pscustomobject]@{
    Name = "cancel_test"
    Step = "prerequisites"
    FilePath = "powershell.exe"
    Arguments = @(
      "-NoLogo",
      "-NoProfile",
      "-Command",
      "Start-Sleep -Seconds 30"
    )
  }
  Start-SetupProcess -Runner $runner -Definition $cancelDefinition | Out-Null
  Start-Sleep -Milliseconds 150
  $cancelled = Stop-SetupProcess -Runner $runner -LogsRoot $logsRoot
  Assert-Equal "failed" $cancelled.status "Cancelled action status is wrong."
  Assert-Equal "cancelled" $cancelled.message "Cancelled action message is wrong."
} finally {
  if (Test-Path -LiteralPath $root) {
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}

Write-Host "ProcessRunner.Tests.ps1 passed"
