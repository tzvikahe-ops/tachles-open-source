$ErrorActionPreference = "Stop"

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

function Get-FreePort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

$wizardRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$scriptPath = Join-Path $wizardRoot "Start-SetupWizard.ps1"
$workspace = Join-Path ([IO.Path]::GetTempPath()) "tachles-server-$([Guid]::NewGuid())"
$outputPath = Join-Path $workspace "server.out.log"
$errorPath = Join-Path $workspace "server.err.log"
$port = Get-FreePort
$process = $null

try {
  New-Item -ItemType Directory -Path $workspace -Force | Out-Null
  $arguments = @(
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $scriptPath,
    "-NoBrowser",
    "-Port",
    $port,
    "-WorkspaceRoot",
    $workspace
  )
  $process = Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList $arguments `
    -RedirectStandardOutput $outputPath `
    -RedirectStandardError $errorPath `
    -WindowStyle Hidden `
    -PassThru

  $token = $null
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    Start-Sleep -Milliseconds 100
    if (Test-Path -LiteralPath $outputPath) {
      $output = Get-Content -LiteralPath $outputPath -Raw -Encoding UTF8
      if (-not [string]::IsNullOrWhiteSpace($output)) {
        $match = [regex]::Match(
          $output,
          "http://127\.0\.0\.1:$port/\?session=([A-Za-z0-9_-]+)"
        )
        if ($match.Success) {
          $token = $match.Groups[1].Value
          break
        }
      }
    }
  }

  Assert-True (-not [string]::IsNullOrWhiteSpace($token)) "Server token was not emitted."
  $headers = @{
    "X-Tachles-Setup-Token" = $token
    "Origin" = "http://127.0.0.1:$port"
    "Content-Type" = "application/json"
  }

  $state = Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:$port/api/state" `
    -Headers $headers `
    -Body '{"activeStep":3,"installMode":"full"}'
  Assert-True ($state.activeStep -eq 3) "State endpoint did not persist activeStep."
  Assert-True ($state.installMode -eq "full") "State endpoint did not persist installMode."

  $fakeSecret = "sk-integration-secret-49281"
  $secretBody = @{
    name = "OPENAI_API_KEY"
    value = $fakeSecret
  } | ConvertTo-Json -Compress
  $secretResponse = Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:$port/api/secret" `
    -Headers $headers `
    -Body $secretBody
  Assert-True $secretResponse.configured "Secret endpoint did not report success."
  Assert-True (
    -not (($secretResponse | ConvertTo-Json -Compress).Contains($fakeSecret))
  ) "Secret endpoint returned the secret value."

  $stateText = Get-Content `
    -LiteralPath (Join-Path $workspace ".tachles-setup\state.json") `
    -Raw
  $logs = Get-ChildItem `
    -LiteralPath (Join-Path $workspace ".tachles-setup\logs") `
    -File |
    ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }
  Assert-True (-not $stateText.Contains($fakeSecret)) "State file contains a secret."
  Assert-True (-not (($logs -join "`n").Contains($fakeSecret))) "Log contains a secret."

  Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:$port/api/shutdown" `
    -Headers $headers |
    Out-Null
  $process.WaitForExit(5000) | Out-Null
  Assert-True $process.HasExited "Setup server did not shut down."
} finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit(5000) | Out-Null
  }
  if ($null -ne $process) {
    $process.Dispose()
  }
  if (Test-Path -LiteralPath $workspace) {
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
      try {
        Remove-Item -LiteralPath $workspace -Recurse -Force
        break
      } catch {
        if ($attempt -eq 9) {
          throw
        }
        Start-Sleep -Milliseconds 100
      }
    }
  }
}

Write-Host "Server.Integration.Tests.ps1 passed"
