Set-StrictMode -Version Latest

function New-SetupToken {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }

  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Test-SetupToken {
  param(
    [AllowNull()]
    [string]$Expected,

    [AllowNull()]
    [string]$Actual
  )

  if ([string]::IsNullOrWhiteSpace($Expected) -or
    [string]::IsNullOrWhiteSpace($Actual)) {
    return $false
  }

  if ($Expected.Length -ne $Actual.Length) {
    return $false
  }

  $difference = 0
  for ($index = 0; $index -lt $Expected.Length; $index++) {
    $difference = $difference -bor (
      [int][char]$Expected[$index] -bxor [int][char]$Actual[$index]
    )
  }

  return $difference -eq 0
}

function Test-SetupOrigin {
  param(
    [AllowNull()]
    [string]$Origin,

    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  if ([string]::IsNullOrWhiteSpace($Origin)) {
    return $true
  }

  return $Origin -eq "http://127.0.0.1:$Port"
}

function Resolve-SetupStaticFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$UiRoot,

    [Parameter(Mandatory = $true)]
    [string]$RequestPath
  )

  $relativePath = if ($RequestPath -eq "/") {
    "index.html"
  } else {
    [Uri]::UnescapeDataString($RequestPath.TrimStart("/"))
  }

  if ($relativePath -match '(^|[\\/])\.\.([\\/]|$)') {
    return $null
  }

  $root = [IO.Path]::GetFullPath($UiRoot).
    TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $candidate = [IO.Path]::GetFullPath((Join-Path $root $relativePath))
  $prefix = $root + [IO.Path]::DirectorySeparatorChar

  if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    return $null
  }

  return $candidate
}

Export-ModuleMember -Function `
  New-SetupToken, `
  Test-SetupToken, `
  Test-SetupOrigin, `
  Resolve-SetupStaticFile
