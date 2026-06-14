Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "Redaction.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "StateStore.psm1") -Force

if ($null -eq ("Tachles.Setup.NativeProcess" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Tachles.Setup {
  public static class NativeProcess {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetExitCodeProcess(
      IntPtr processHandle,
      out uint exitCode
    );
  }
}
"@
}

function Get-SetupProcessExitCode {
  param([Parameter(Mandatory = $true)][IntPtr]$ProcessHandle)

  [uint32]$exitCode = 0
  if (-not [Tachles.Setup.NativeProcess]::GetExitCodeProcess(
      $ProcessHandle,
      [ref]$exitCode
    )) {
    throw "Unable to read process exit code."
  }
  return [BitConverter]::ToInt32([BitConverter]::GetBytes($exitCode), 0)
}

function New-SetupProcessRunner {
  param([Parameter(Mandatory = $true)][string]$RuntimeRoot)

  New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
  return [pscustomobject]@{
    RuntimeRoot = $RuntimeRoot
    Status = "idle"
    Name = $null
    Step = $null
    Process = $null
    ProcessHandle = [IntPtr]::Zero
    StdoutPath = $null
    StderrPath = $null
    StartedAt = $null
    CompletedAt = $null
    ExitCode = $null
    Message = $null
    Collected = $false
    StateApplied = $false
  }
}

function Get-SetupProcessPublicState {
  param([Parameter(Mandatory = $true)][object]$Runner)

  return [ordered]@{
    name = $Runner.Name
    step = $Runner.Step
    status = $Runner.Status
    startedAt = $Runner.StartedAt
    completedAt = $Runner.CompletedAt
    exitCode = $Runner.ExitCode
    message = $Runner.Message
  }
}

function Complete-SetupProcessOutput {
  param(
    [Parameter(Mandatory = $true)][object]$Runner,
    [Parameter(Mandatory = $true)][string]$LogsRoot,
    [string[]]$Secrets = @()
  )

  if ($Runner.Collected) {
    return
  }

  $parts = @()
  foreach ($path in @($Runner.StdoutPath, $Runner.StderrPath)) {
    if (-not [string]::IsNullOrWhiteSpace($path) -and
      (Test-Path -LiteralPath $path -PathType Leaf)) {
      $content = Get-Content -LiteralPath $path -Raw -Encoding UTF8
      if (-not [string]::IsNullOrWhiteSpace($content)) {
        $parts += $content.Trim()
      }
      Remove-Item -LiteralPath $path -Force
    }
  }

  if ($parts.Count -gt 0) {
    Write-SetupLogEntry `
      -LogsRoot $LogsRoot `
      -Message ($parts -join [Environment]::NewLine) `
      -Secrets $Secrets
  }
  $Runner.Collected = $true
}

function Update-SetupProcessRunner {
  param(
    [Parameter(Mandatory = $true)][object]$Runner,
    [Parameter(Mandatory = $true)][string]$LogsRoot,
    [string[]]$Secrets = @()
  )

  if ($Runner.Status -eq "running" -and $null -ne $Runner.Process) {
    $Runner.Process.Refresh()
    if ($Runner.Process.HasExited) {
      $Runner.Process.WaitForExit()
      $Runner.ExitCode = Get-SetupProcessExitCode `
        -ProcessHandle $Runner.ProcessHandle
      $Runner.CompletedAt = [DateTime]::UtcNow.ToString("o")
      $Runner.Status = if ($Runner.ExitCode -eq 0) { "succeeded" } else { "failed" }
      $Runner.Message = if ($Runner.ExitCode -eq 0) {
        "completed"
      } else {
        "process_failed"
      }
      Complete-SetupProcessOutput `
        -Runner $Runner `
        -LogsRoot $LogsRoot `
        -Secrets $Secrets
      $Runner.Process.Dispose()
      $Runner.Process = $null
    }
  }

  return Get-SetupProcessPublicState -Runner $Runner
}

function Start-SetupProcess {
  param(
    [Parameter(Mandatory = $true)][object]$Runner,
    [Parameter(Mandatory = $true)][object]$Definition
  )

  if ($Runner.Status -eq "running") {
    throw "Another setup action is already running."
  }

  $id = [Guid]::NewGuid().ToString("N")
  $stdoutPath = Join-Path $Runner.RuntimeRoot "$id.stdout.log"
  $stderrPath = Join-Path $Runner.RuntimeRoot "$id.stderr.log"
  $process = Start-Process `
    -FilePath $Definition.FilePath `
    -ArgumentList $Definition.Arguments `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru

  $Runner.Status = "running"
  $Runner.Name = $Definition.Name
  $Runner.Step = $Definition.Step
  $Runner.Process = $process
  $Runner.ProcessHandle = $process.Handle
  $Runner.StdoutPath = $stdoutPath
  $Runner.StderrPath = $stderrPath
  $Runner.StartedAt = [DateTime]::UtcNow.ToString("o")
  $Runner.CompletedAt = $null
  $Runner.ExitCode = $null
  $Runner.Message = "running"
  $Runner.Collected = $false
  $Runner.StateApplied = $false

  return Get-SetupProcessPublicState -Runner $Runner
}

function Stop-SetupProcess {
  param(
    [Parameter(Mandatory = $true)][object]$Runner,
    [Parameter(Mandatory = $true)][string]$LogsRoot,
    [string[]]$Secrets = @()
  )

  Update-SetupProcessRunner `
    -Runner $Runner `
    -LogsRoot $LogsRoot `
    -Secrets $Secrets |
    Out-Null

  if ($Runner.Status -ne "running" -or $null -eq $Runner.Process) {
    return Get-SetupProcessPublicState -Runner $Runner
  }

  Stop-Process -Id $Runner.Process.Id -Force
  $Runner.Process.WaitForExit(5000) | Out-Null
  $Runner.ExitCode = Get-SetupProcessExitCode `
    -ProcessHandle $Runner.ProcessHandle
  $Runner.CompletedAt = [DateTime]::UtcNow.ToString("o")
  $Runner.Status = "failed"
  $Runner.Message = "cancelled"
  Complete-SetupProcessOutput `
    -Runner $Runner `
    -LogsRoot $LogsRoot `
    -Secrets $Secrets
  $Runner.Process.Dispose()
  $Runner.Process = $null
  return Get-SetupProcessPublicState -Runner $Runner
}

Export-ModuleMember -Function `
  New-SetupProcessRunner, `
  Get-SetupProcessPublicState, `
  Update-SetupProcessRunner, `
  Start-SetupProcess, `
  Stop-SetupProcess
