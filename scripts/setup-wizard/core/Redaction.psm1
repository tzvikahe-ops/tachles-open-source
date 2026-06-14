Set-StrictMode -Version Latest

function Protect-SetupLogText {
  param(
    [AllowNull()][string]$Text,
    [string[]]$Secrets = @()
  )

  if ($null -eq $Text) {
    return ""
  }

  $redacted = $Text
  foreach ($secret in $Secrets) {
    if (-not [string]::IsNullOrWhiteSpace($secret)) {
      $redacted = $redacted.Replace($secret, "[REDACTED]")
      $encoded = [Uri]::EscapeDataString($secret)
      if ($encoded -ne $secret) {
        $redacted = $redacted.Replace($encoded, "[REDACTED]")
      }
    }
  }

  $patterns = @(
    '(?i)(authorization:\s*bearer\s+)[^\s]+',
    '(?i)(access[_-]?token["''=: ]+)[^\s,"''&]+',
    '(?i)(refresh[_-]?token["''=: ]+)[^\s,"''&]+',
    '(?i)(api[_-]?key["''=: ]+)[^\s,"''&]+',
    '(?i)(password["''=: ]+)[^\s,"''&]+'
  )

  foreach ($pattern in $patterns) {
    $redacted = [regex]::Replace($redacted, $pattern, '$1[REDACTED]')
  }

  return $redacted
}

Export-ModuleMember -Function Protect-SetupLogText

