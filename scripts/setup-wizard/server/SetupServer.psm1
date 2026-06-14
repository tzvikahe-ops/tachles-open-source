Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot "Security.psm1") -Force

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
    [string]$UiRoot
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

    if ($Request.Method -eq "POST" -and $path -eq "/api/shutdown") {
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
    [string]$UiRoot
  )

  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
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
          -UiRoot $UiRoot
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
    $listener.Stop()
  }
}

Export-ModuleMember -Function `
  New-SetupSession, `
  Start-SetupServer
