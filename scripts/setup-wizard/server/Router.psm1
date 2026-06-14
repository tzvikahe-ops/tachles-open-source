Set-StrictMode -Version Latest

function Get-SetupActionDefinition {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$WorkspaceRoot = (Get-Location).Path,
    [string]$WizardRoot = $WorkspaceRoot
  )

  switch ($Name) {
    "local_check" {
      return [pscustomobject]@{
        Name = "local_check"
        Step = "prerequisites"
        CompletionStatus = "succeeded"
        FilePath = "powershell.exe"
        Arguments = @(
          "-NoLogo",
          "-NoProfile",
          "-Command",
          "Start-Sleep -Milliseconds 700; Write-Output 'Local setup check completed.'"
        )
      }
    }
    { $_ -in @(
        "install_git",
        "install_node",
        "install_deno",
        "install_vercel",
        "prepare_supabase",
        "validate_ai",
        "generate_secrets",
        "deploy_supabase",
        "deploy_vercel",
        "deploy_google"
      ) } {
      $steps = @{
        install_git = "prerequisites"
        install_node = "prerequisites"
        install_deno = "prerequisites"
        install_vercel = "prerequisites"
        prepare_supabase = "supabase"
        validate_ai = "capabilities"
        generate_secrets = "capabilities"
        deploy_supabase = "capabilities"
        deploy_vercel = "vercel"
        deploy_google = "google"
      }
      return [pscustomobject]@{
        Name = $Name
        Step = $steps[$Name]
        CompletionStatus = switch ($Name) {
          { $_ -match '^install_' } { "pending"; break }
          "validate_ai" { "pending"; break }
          "generate_secrets" { "pending"; break }
          "deploy_vercel" { "needs_user_action"; break }
          "deploy_supabase" { "needs_user_action"; break }
          default { "succeeded" }
        }
        FilePath = "powershell.exe"
        Arguments = @(
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          (Join-Path $WizardRoot "actions\Invoke-SetupAction.ps1"),
          "-Name",
          $Name,
          "-WorkspaceRoot",
          $WorkspaceRoot
        )
      }
    }
    default {
      return $null
    }
  }
}

Export-ModuleMember -Function Get-SetupActionDefinition
