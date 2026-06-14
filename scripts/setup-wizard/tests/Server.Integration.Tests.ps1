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

  $page = Invoke-WebRequest `
    -Method Get `
    -Uri "http://127.0.0.1:$port/" `
    -UseBasicParsing
  Assert-True ($page.StatusCode -eq 200) "Wizard page did not load."
  Assert-True (
    $page.Content.Contains('data-step="8"')
  ) "Wizard page does not contain all eight steps."

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

  $configBody = @{
    SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst"
    VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test"
    WEB_APP_URL = "https://tachles-test.vercel.app"
    VAPID_SUBJECT = "mailto:test@example.com"
  } | ConvertTo-Json -Compress
  Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:$port/api/config" `
    -Headers $headers `
    -Body $configBody |
    Out-Null
  $config = Invoke-RestMethod `
    -Method Get `
    -Uri "http://127.0.0.1:$port/api/config" `
    -Headers $headers
  Assert-True (
    $config.SUPABASE_PROJECT_REF -eq "abcdefghijklmnopqrst"
  ) "Public configuration was not persisted."

  $invalidConfigRejected = $false
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri "http://127.0.0.1:$port/api/config" `
      -Headers $headers `
      -Body '{"WEB_APP_URL":"javascript:alert(1)"}' |
      Out-Null
  } catch {
    $invalidConfigRejected = $_.Exception.Response.StatusCode.value__ -eq 400
  }
  Assert-True $invalidConfigRejected "Unsafe configuration URL was accepted."

  $google = Invoke-RestMethod `
    -Method Get `
    -Uri "http://127.0.0.1:$port/api/google" `
    -Headers $headers
  Assert-True (
    $google.authRedirect -eq
      "https://abcdefghijklmnopqrst.supabase.co/auth/v1/callback"
  ) "Google guidance returned the wrong redirect."

  $action = Invoke-RestMethod `
    -Method Post `
    -Uri "http://127.0.0.1:$port/api/action/local_check" `
    -Headers $headers
  Assert-True ($action.status -eq "running") "Action endpoint did not start."

  $action = $null
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    Start-Sleep -Milliseconds 50
    $action = Invoke-RestMethod `
      -Method Get `
      -Uri "http://127.0.0.1:$port/api/action" `
      -Headers $headers
    if ($action.status -ne "running") {
      break
    }
  }
  Assert-True ($action.status -eq "succeeded") "Action endpoint did not succeed."

  $logResponse = Invoke-RestMethod `
    -Method Get `
    -Uri "http://127.0.0.1:$port/api/log" `
    -Headers $headers
  Assert-True (
    $logResponse.content.Contains("Local setup check completed.")
  ) "Action output was not available through the log endpoint."

  $persistedState = Invoke-RestMethod `
    -Method Get `
    -Uri "http://127.0.0.1:$port/api/state" `
    -Headers $headers
  Assert-True (
    $persistedState.steps.prerequisites -eq "succeeded"
  ) "Action result was not persisted in setup state."

  $unknownRejected = $false
  try {
    Invoke-RestMethod `
      -Method Post `
      -Uri "http://127.0.0.1:$port/api/action/not_allowed" `
      -Headers $headers |
      Out-Null
  } catch {
    $unknownRejected = $_.Exception.Response.StatusCode.value__ -eq 404
  }
  Assert-True $unknownRejected "Unknown action was not rejected."

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
