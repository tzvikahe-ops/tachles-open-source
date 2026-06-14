Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "Security.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "Router.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\core\StateStore.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\core\EnvStore.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\core\ProcessRunner.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\core\Redaction.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Prerequisites.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Supabase.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Vercel.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Google.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "..\actions\Verification.psm1") -Force

$script:ShouldStop = $false

function Get-FreeSetupPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function New-SetupSession {
  param(
    [int]$RequestedPort = 0
  )

  $selectedPort = if ($RequestedPort -gt 0) {
    $RequestedPort
  } else {
    Get-FreeSetupPort
  }

  return [pscustomobject]@{
    Port = $selectedPort
    Token = New-SetupToken
  }
}

function Get-ContentType {
  param([string]$Path)

  switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".js" { return "application/javascript; charset=utf-8" }
    ".svg" { return "image/svg+xml" }
    ".png" { return "image/png" }
    default { return "application/octet-stream" }
  }
}

function Read-HttpRequest {
  param([Parameter(Mandatory = $true)][Net.Sockets.NetworkStream]$Stream)

  $buffer = New-Object byte[] 8192
  $memory = [IO.MemoryStream]::new()
  $headerEnd = -1

  while ($headerEnd -lt 0) {
    $read = $Stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) {
      throw "Connection closed before the request was complete."
    }

    $memory.Write($buffer, 0, $read)
    $text = [Text.Encoding]::UTF8.GetString($memory.ToArray())
    $headerEnd = $text.IndexOf("`r`n`r`n", [StringComparison]::Ordinal)

    if ($memory.Length -gt 1048576) {
      throw "Request headers are too large."
    }
  }

  $bytes = $memory.ToArray()
  $headerText = [Text.Encoding]::UTF8.GetString($bytes, 0, $headerEnd)
  $lines = $headerText -split "`r`n"
  $requestLine = $lines[0] -split " "

  if ($requestLine.Length -lt 2) {
    throw "Invalid request line."
  }

  $headers = @{}
  foreach ($line in $lines | Select-Object -Skip 1) {
    $separator = $line.IndexOf(":")
    if ($separator -gt 0) {
      $headers[$line.Substring(0, $separator).Trim().ToLowerInvariant()] =
        $line.Substring($separator + 1).Trim()
    }
  }

  $contentLength = 0
  if ($headers.ContainsKey("content-length")) {
    $contentLength = [int]$headers["content-length"]
  }

  $bodyOffset = $headerEnd + 4
  while (($bytes.Length - $bodyOffset) -lt $contentLength) {
    $read = $Stream.Read($buffer, 0, $buffer.Length)
    if ($read -le 0) {
      throw "Connection closed before the body was complete."
    }
    $memory.Write($buffer, 0, $read)
    $bytes = $memory.ToArray()
  }

  $body = if ($contentLength -gt 0) {
    [Text.Encoding]::UTF8.GetString($bytes, $bodyOffset, $contentLength)
  } else {
    ""
  }
  $memory.Dispose()

  return [pscustomobject]@{
    Method = $requestLine[0].ToUpperInvariant()
    Target = $requestLine[1]
    Headers = $headers
    Body = $body
  }
}

function Write-HttpResponse {
  param(
    [Parameter(Mandatory = $true)]
    [Net.Sockets.NetworkStream]$Stream,

    [Parameter(Mandatory = $true)]
    [int]$StatusCode,

    [Parameter(Mandatory = $true)]
    [string]$StatusText,

    [Parameter(Mandatory = $true)]
    [byte[]]$Body,

    [string]$ContentType = "application/json; charset=utf-8",

    [hashtable]$Headers = @{}
  )

  $responseHeaders = [ordered]@{
    "Content-Type" = $ContentType
    "Content-Length" = $Body.Length
    "Cache-Control" = "no-store"
    "X-Content-Type-Options" = "nosniff"
    "Referrer-Policy" = "no-referrer"
    "Connection" = "close"
  }

  foreach ($key in $Headers.Keys) {
    $responseHeaders[$key] = $Headers[$key]
  }

  $head = "HTTP/1.1 $StatusCode $StatusText`r`n"
  foreach ($key in $responseHeaders.Keys) {
    $head += "$key`: $($responseHeaders[$key])`r`n"
  }
  $head += "`r`n"

  $headBytes = [Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($headBytes, 0, $headBytes.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

function Write-JsonResponse {
  param(
    [Parameter(Mandatory = $true)]
    [Net.Sockets.NetworkStream]$Stream,

    [Parameter(Mandatory = $true)]
    [int]$StatusCode,

    [Parameter(Mandatory = $true)]
    [string]$StatusText,

    [Parameter(Mandatory = $true)]
    [object]$Value,

    [hashtable]$Headers = @{}
  )

  $json = $Value | ConvertTo-Json -Depth 8 -Compress
  Write-HttpResponse `
    -Stream $Stream `
    -StatusCode $StatusCode `
    -StatusText $StatusText `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) `
    -Headers $Headers
}

function Test-ApiRequest {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Request,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  $actualToken = $Request.Headers["x-tachles-setup-token"]
  $origin = $Request.Headers["origin"]

  return (Test-SetupToken -Expected $Token -Actual $actualToken) -and
    (Test-SetupOrigin -Origin $origin -Port $Port)
}

function Get-SetupRedactionSecrets {
  param([Parameter(Mandatory = $true)][string]$EnvPath)

  $values = Read-SetupEnv -EnvPath $EnvPath
  return @(
    $values.Values |
      Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
  )
}

function Test-SetupConfigValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowEmptyString()][string]$Value
  )

  switch ($Name) {
    "SUPABASE_PROJECT_REF" {
      return $Value -match '^[a-z0-9]{20}$'
    }
    "VITE_SUPABASE_PUBLISHABLE_KEY" {
      return $Value -match '^(sb_publishable_|eyJ)[A-Za-z0-9._-]+$'
    }
    "WEB_APP_URL" {
      if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
      $uri = $null
      return [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri) -and
        $uri.Scheme -eq "https"
    }
    "WEB_ALLOWED_EMAILS" {
      return $Value -notmatch '[\r\n]'
    }
    "VAPID_SUBJECT" {
      return $Value -match '^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$'
    }
    "OAUTH_REDIRECT_URI" {
      if ([string]::IsNullOrWhiteSpace($Value)) { return $true }
      return $Value -match (
        '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/oauth-callback$'
      )
    }
    default {
      return $false
    }
  }
}

function Invoke-SetupRequest {
  param(
    [Parameter(Mandatory = $true)]
    [Net.Sockets.NetworkStream]$Stream,

    [Parameter(Mandatory = $true)]
    [object]$Request,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [Parameter(Mandatory = $true)]
    [int]$Port,

    [Parameter(Mandatory = $true)]
    [string]$UiRoot,

    [Parameter(Mandatory = $true)]
    [object]$Paths,

    [Parameter(Mandatory = $true)]
    [string]$EnvPath,

    [Parameter(Mandatory = $true)]
    [object]$Runner
  )

  $uri = [Uri]::new("http://127.0.0.1:$Port$($Request.Target)")
  $path = $uri.AbsolutePath
  $corsHeaders = @{
    "Content-Security-Policy" =
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  }

  if ($path.StartsWith("/api/", [StringComparison]::Ordinal)) {
    if (-not (Test-ApiRequest -Request $Request -Token $Token -Port $Port)) {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 401 `
        -StatusText "Unauthorized" `
        -Value @{ error = "unauthorized" } `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/session") {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value @{
          status = "ready"
          platform = "windows"
          version = 1
        } `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/state") {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value (Read-SetupState -StatePath $Paths.StatePath) `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "POST" -and $path -eq "/api/state") {
      try {
        $body = $Request.Body | ConvertFrom-Json
        $changes = @{}
        if ($body.PSObject.Properties.Name -contains "activeStep") {
          $changes["activeStep"] = [int]$body.activeStep
        }
        if ($body.PSObject.Properties.Name -contains "installMode") {
          $changes["installMode"] = [string]$body.installMode
        }
        $state = Update-SetupState -StatePath $Paths.StatePath -Changes $changes
        if ($body.PSObject.Properties.Name -contains "stepStatus") {
          $stepName = [string]$body.stepStatus.step
          $stepValue = [string]$body.stepStatus.status
          $state = Set-SetupStepStatus `
            -StatePath $Paths.StatePath `
            -Step $stepName `
            -Status $stepValue
        }
        Write-SetupLogEntry -LogsRoot $Paths.LogsRoot -Message "Setup state updated."
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 200 `
          -StatusText "OK" `
          -Value $state `
          -Headers $corsHeaders
      } catch {
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 400 `
          -StatusText "Bad Request" `
          -Value @{ error = "invalid_state" } `
          -Headers $corsHeaders
      }
      return
    }

    if ($Request.Method -eq "POST" -and $path -eq "/api/secret") {
      $allowedSecrets = @(
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "SUPABASE_DB_PASSWORD",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "VAPID_SUBJECT",
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY"
      )

      try {
        $body = $Request.Body | ConvertFrom-Json
        $name = [string]$body.name
        $value = [string]$body.value
        if ($name -notin $allowedSecrets -or [string]::IsNullOrWhiteSpace($value)) {
          throw "Invalid secret."
        }
        Set-SetupEnvValue -EnvPath $EnvPath -Name $name -Value $value
        Write-SetupLogEntry `
          -LogsRoot $Paths.LogsRoot `
          -Message "Secret $name configured." `
          -Secrets @($value)
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 200 `
          -StatusText "OK" `
          -Value @{ name = $name; configured = $true } `
          -Headers $corsHeaders
      } catch {
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 400 `
          -StatusText "Bad Request" `
          -Value @{ error = "invalid_secret" } `
          -Headers $corsHeaders
      }
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/secrets") {
      $names = @(
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "SUPABASE_DB_PASSWORD",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "VAPID_SUBJECT",
        "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY"
      )
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value (Get-SetupSecretStatus -EnvPath $EnvPath -Names $names) `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/config") {
      $values = Read-SetupEnv -EnvPath $EnvPath
      $publicNames = @(
        "SUPABASE_PROJECT_REF",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "WEB_APP_URL",
        "WEB_ALLOWED_EMAILS",
        "VAPID_SUBJECT",
        "OAUTH_REDIRECT_URI"
      )
      $public = [ordered]@{}
      foreach ($name in $publicNames) {
        $public[$name] = if ($values.Contains($name)) {
          [string]$values[$name]
        } else {
          ""
        }
      }
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value $public `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "POST" -and $path -eq "/api/config") {
      $allowedConfig = @(
        "SUPABASE_PROJECT_REF",
        "VITE_SUPABASE_PUBLISHABLE_KEY",
        "WEB_APP_URL",
        "WEB_ALLOWED_EMAILS",
        "VAPID_SUBJECT",
        "OAUTH_REDIRECT_URI"
      )
      try {
        $body = $Request.Body | ConvertFrom-Json
        $properties = @($body.PSObject.Properties)
        if ($properties.Count -eq 0) {
          throw "Configuration body is empty."
        }
        foreach ($property in $properties) {
          if ($property.Name -notin $allowedConfig) {
            throw "Invalid configuration field."
          }
          if (-not (Test-SetupConfigValue `
              -Name $property.Name `
              -Value ([string]$property.Value))) {
            throw "Invalid configuration value."
          }
        }
        foreach ($property in $properties) {
          Set-SetupEnvValue `
            -EnvPath $EnvPath `
            -Name $property.Name `
            -Value ([string]$property.Value)
        }
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 200 `
          -StatusText "OK" `
          -Value @{ configured = $true } `
          -Headers $corsHeaders
      } catch {
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 400 `
          -StatusText "Bad Request" `
          -Value @{ error = "invalid_config" } `
          -Headers $corsHeaders
      }
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/prerequisites") {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value (Get-SetupPrerequisites) `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/supabase") {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value (Get-SetupSupabaseStatus -EnvPath $EnvPath) `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/vercel") {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value (Get-SetupVercelStatus -EnvPath $EnvPath) `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/google") {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value (Get-SetupGoogleGuidance -EnvPath $EnvPath) `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/verification") {
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value (Get-SetupVerificationReport -EnvPath $EnvPath) `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "POST" -and $path.StartsWith("/api/action/")) {
      $actionName = $path.Substring("/api/action/".Length)
      if ($actionName -eq "cancel") {
        $wasRunning = $Runner.Status -eq "running"
        $action = Stop-SetupProcess `
          -Runner $Runner `
          -LogsRoot $Paths.LogsRoot `
          -Secrets (Get-SetupRedactionSecrets -EnvPath $EnvPath)
        if ($wasRunning -and
          -not [string]::IsNullOrWhiteSpace($Runner.Step)) {
          Set-SetupStepStatus `
            -StatePath $Paths.StatePath `
            -Step $Runner.Step `
            -Status "failed" |
            Out-Null
          $Runner.StateApplied = $true
        }
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 200 `
          -StatusText "OK" `
          -Value $action `
          -Headers $corsHeaders
        return
      }

      $definition = Get-SetupActionDefinition `
        -Name $actionName `
        -WorkspaceRoot (Split-Path -Parent $EnvPath) `
        -WizardRoot (Resolve-Path (Join-Path $PSScriptRoot ".."))
      if ($null -eq $definition) {
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 404 `
          -StatusText "Not Found" `
          -Value @{ error = "unknown_action" } `
          -Headers $corsHeaders
        return
      }

      try {
        $action = Start-SetupProcess -Runner $Runner -Definition $definition
        Set-SetupStepStatus `
          -StatePath $Paths.StatePath `
          -Step $definition.Step `
          -Status "running" |
          Out-Null
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 202 `
          -StatusText "Accepted" `
          -Value $action `
          -Headers $corsHeaders
      } catch {
        Write-JsonResponse `
          -Stream $Stream `
          -StatusCode 409 `
          -StatusText "Conflict" `
          -Value @{ error = "action_running" } `
          -Headers $corsHeaders
      }
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/action") {
      $action = Update-SetupProcessRunner `
        -Runner $Runner `
        -LogsRoot $Paths.LogsRoot `
        -Secrets (Get-SetupRedactionSecrets -EnvPath $EnvPath)
      if ($Runner.Status -in @("succeeded", "failed") -and
        -not $Runner.StateApplied -and
        -not [string]::IsNullOrWhiteSpace($Runner.Step)) {
        $stepStatus = if ($Runner.Status -eq "failed") {
          "failed"
        } else {
          $Runner.CompletionStatus
        }
        Set-SetupStepStatus `
          -StatePath $Paths.StatePath `
          -Step $Runner.Step `
          -Status $stepStatus |
          Out-Null
        $Runner.StateApplied = $true
      }
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value $action `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "GET" -and $path -eq "/api/log") {
      $latest = Get-ChildItem -LiteralPath $Paths.LogsRoot -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
      $content = if ($null -eq $latest) {
        ""
      } else {
        $lines = @(Get-Content -LiteralPath $latest.FullName -Encoding UTF8)
        ($lines | Select-Object -Last 200) -join [Environment]::NewLine
      }
      if ($Runner.Status -eq "running") {
        $liveParts = @()
        foreach ($runtimePath in @($Runner.StdoutPath, $Runner.StderrPath)) {
          if (-not [string]::IsNullOrWhiteSpace($runtimePath) -and
            (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
            $liveParts += Get-Content `
              -LiteralPath $runtimePath `
              -Raw `
              -Encoding UTF8
          }
        }
        if ($liveParts.Count -gt 0) {
          $live = Protect-SetupLogText `
            -Text ($liveParts -join [Environment]::NewLine) `
            -Secrets (Get-SetupRedactionSecrets -EnvPath $EnvPath)
          $content = @($content, $live) |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Select-Object -Last 200
          $content = $content -join [Environment]::NewLine
        }
      }
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value @{ content = $content } `
        -Headers $corsHeaders
      return
    }

    if ($Request.Method -eq "POST" -and $path -eq "/api/shutdown") {
      Stop-SetupProcess `
        -Runner $Runner `
        -LogsRoot $Paths.LogsRoot `
        -Secrets (Get-SetupRedactionSecrets -EnvPath $EnvPath) |
        Out-Null
      $script:ShouldStop = $true
      Write-JsonResponse `
        -Stream $Stream `
        -StatusCode 200 `
        -StatusText "OK" `
        -Value @{ status = "stopping" } `
        -Headers $corsHeaders
      return
    }

    Write-JsonResponse `
      -Stream $Stream `
      -StatusCode 404 `
      -StatusText "Not Found" `
      -Value @{ error = "not_found" } `
      -Headers $corsHeaders
    return
  }

  if ($Request.Method -ne "GET") {
    Write-JsonResponse `
      -Stream $Stream `
      -StatusCode 405 `
      -StatusText "Method Not Allowed" `
      -Value @{ error = "method_not_allowed" } `
      -Headers $corsHeaders
    return
  }

  $file = Resolve-SetupStaticFile -UiRoot $UiRoot -RequestPath $path
  if ($null -eq $file) {
    Write-JsonResponse `
      -Stream $Stream `
      -StatusCode 404 `
      -StatusText "Not Found" `
      -Value @{ error = "not_found" } `
      -Headers $corsHeaders
    return
  }

  Write-HttpResponse `
    -Stream $Stream `
    -StatusCode 200 `
    -StatusText "OK" `
    -Body ([IO.File]::ReadAllBytes($file)) `
    -ContentType (Get-ContentType -Path $file) `
    -Headers $corsHeaders
}

function Start-SetupServer {
  param(
    [Parameter(Mandatory = $true)]
    [int]$Port,

    [Parameter(Mandatory = $true)]
    [string]$Token,

    [Parameter(Mandatory = $true)]
    [string]$UiRoot,

    [Parameter(Mandatory = $true)]
    [string]$WorkspaceRoot
  )

  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
  $paths = Initialize-SetupDataDirectory -WorkspaceRoot $WorkspaceRoot
  $envPath = Join-Path $WorkspaceRoot ".env.local"
  $runner = New-SetupProcessRunner -RuntimeRoot $paths.RuntimeRoot
  Read-SetupState -StatePath $paths.StatePath | Out-Null
  $script:ShouldStop = $false
  $listener.Start()

  try {
    while (-not $script:ShouldStop) {
      $client = $listener.AcceptTcpClient()
      $stream = $null
      try {
        $stream = $client.GetStream()
        $request = Read-HttpRequest -Stream $stream
        Invoke-SetupRequest `
          -Stream $stream `
          -Request $request `
          -Token $Token `
          -Port $Port `
          -UiRoot $UiRoot `
          -Paths $paths `
          -EnvPath $envPath `
          -Runner $runner
      } catch {
        if ($null -ne $stream) {
          try {
            Write-JsonResponse `
              -Stream $stream `
              -StatusCode 500 `
              -StatusText "Internal Server Error" `
              -Value @{ error = "server_error" }
          } catch {
            # The client may already have disconnected.
          }
        }
      } finally {
        if ($null -ne $stream) {
          $stream.Dispose()
        }
        $client.Dispose()
      }
    }
  } finally {
    Stop-SetupProcess `
      -Runner $runner `
      -LogsRoot $paths.LogsRoot `
      -Secrets (Get-SetupRedactionSecrets -EnvPath $envPath) |
      Out-Null
    $listener.Stop()
  }
}

Export-ModuleMember -Function `
  New-SetupSession, `
  Start-SetupServer
