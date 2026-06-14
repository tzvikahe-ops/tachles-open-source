Set-StrictMode -Version Latest

function ConvertTo-SetupVersion {
  param([AllowNull()][string]$Text)

  if ([string]::IsNullOrWhiteSpace($Text)) {
    return $null
  }
  $match = [regex]::Match($Text, '(\d+)\.(\d+)(?:\.(\d+))?')
  if (-not $match.Success) {
    return $null
  }
  $patch = if ($match.Groups[3].Success) { $match.Groups[3].Value } else { "0" }
  return [version]"$($match.Groups[1].Value).$($match.Groups[2].Value).$patch"
}

function Get-SetupCommandVersion {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @("--version")
  )

  $resolved = Get-Command $Command -ErrorAction SilentlyContinue
  if ($null -eq $resolved) {
    return $null
  }
  try {
    $output = & $resolved.Source @Arguments 2>&1 | Out-String
    return ConvertTo-SetupVersion -Text $output
  } catch {
    return $null
  }
}

function Get-SetupPrerequisites {
  $specs = @(
    @{ Id = "git"; Command = "git"; Minimum = [version]"2.0.0"; Label = "Git" },
    @{ Id = "node"; Command = "node"; Minimum = [version]"22.0.0"; Label = "Node.js" },
    @{ Id = "npm"; Command = "npm"; Minimum = [version]"10.0.0"; Label = "npm" },
    @{ Id = "deno"; Command = "deno"; Minimum = [version]"2.0.0"; Label = "Deno" },
    @{ Id = "vercel"; Command = "vercel"; Minimum = [version]"1.0.0"; Label = "Vercel CLI" }
  )

  $items = foreach ($spec in $specs) {
    $version = Get-SetupCommandVersion -Command $spec.Command
    [ordered]@{
      id = $spec.Id
      label = $spec.Label
      installed = $null -ne $version
      version = if ($null -eq $version) { $null } else { $version.ToString() }
      minimum = $spec.Minimum.ToString()
      ready = $null -ne $version -and $version -ge $spec.Minimum
      installable = $spec.Id -ne "npm"
      hint = $null
    }
  }

  $supabaseVersion = Get-SetupCommandVersion -Command "supabase"
  $usesNpx = $null -eq $supabaseVersion -and
    $null -ne (Get-Command "npx.cmd" -ErrorAction SilentlyContinue)
  $items += [ordered]@{
    id = "supabase"
    label = "Supabase CLI"
    installed = $null -ne $supabaseVersion -or $usesNpx
    version = if ($null -eq $supabaseVersion) {
      $null
    } else {
      $supabaseVersion.ToString()
    }
    minimum = "1.0.0"
    ready = $null -ne $supabaseVersion -or $usesNpx
    installable = $false
    hint = if ($usesNpx) { "npx" } else { $null }
  }

  return [ordered]@{
    ready = @($items | Where-Object { -not $_.ready }).Count -eq 0
    winget = $null -ne (Get-Command "winget.exe" -ErrorAction SilentlyContinue)
    items = @($items)
  }
}

function Get-SetupPrerequisiteInstallCommand {
  param([Parameter(Mandatory = $true)][string]$Tool)

  switch ($Tool) {
    "git" {
      return @{
        FilePath = "winget.exe"
        Arguments = @(
          "install", "--id", "Git.Git", "--exact",
          "--accept-package-agreements", "--accept-source-agreements"
        )
      }
    }
    "node" {
      return @{
        FilePath = "winget.exe"
        Arguments = @(
          "install", "--id", "OpenJS.NodeJS.LTS", "--exact",
          "--accept-package-agreements", "--accept-source-agreements"
        )
      }
    }
    "deno" {
      return @{
        FilePath = "winget.exe"
        Arguments = @(
          "install", "--id", "DenoLand.Deno", "--exact",
          "--accept-package-agreements", "--accept-source-agreements"
        )
      }
    }
    "vercel" {
      return @{
        FilePath = "npm.cmd"
        Arguments = @("install", "--global", "vercel")
      }
    }
    default {
      return $null
    }
  }
}

Export-ModuleMember -Function `
  ConvertTo-SetupVersion, `
  Get-SetupCommandVersion, `
  Get-SetupPrerequisites, `
  Get-SetupPrerequisiteInstallCommand
