Set-StrictMode -Version Latest

function Get-SetupActionDefinition {
  param([Parameter(Mandatory = $true)][string]$Name)

  switch ($Name) {
    "local_check" {
      return [pscustomobject]@{
        Name = "local_check"
        Step = "prerequisites"
        FilePath = "powershell.exe"
        Arguments = @(
          "-NoLogo",
          "-NoProfile",
          "-Command",
          "Start-Sleep -Milliseconds 700; Write-Output 'Local setup check completed.'"
        )
      }
    }
    default {
      return $null
    }
  }
}

Export-ModuleMember -Function Get-SetupActionDefinition
