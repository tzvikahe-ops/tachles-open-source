[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$WorkspaceRoot
)

$ErrorActionPreference = "Stop"
$envPath = Join-Path $WorkspaceRoot ".env.local"

Import-Module (Join-Path $PSScriptRoot "Prerequisites.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "Secrets.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "Supabase.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "Vercel.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "Google.psm1") -Force

switch ($Name) {
  { $_ -match '^install_(git|node|deno|vercel)$' } {
    $tool = $Name.Substring("install_".Length)
    $command = Get-SetupPrerequisiteInstallCommand -Tool $tool
    if ($null -eq $command) {
      throw "Unsupported prerequisite installer."
    }
    & $command.FilePath @($command.Arguments)
    if ($LASTEXITCODE -ne 0) {
      throw "Prerequisite installation failed."
    }
  }
  "generate_secrets" {
    Initialize-SetupInternalSecrets -EnvPath $envPath
    Initialize-SetupVapidKeys -EnvPath $envPath
    Write-Output "Local secrets are ready."
  }
  "validate_ai" {
    Test-SetupAiKeys -EnvPath $envPath
    Write-Output "AI provider keys are valid."
  }
  "prepare_supabase" {
    Invoke-SetupSupabasePrepare -EnvPath $envPath
  }
  "deploy_supabase" {
    Invoke-SetupSupabaseDeploy -WorkspaceRoot $WorkspaceRoot -EnvPath $envPath
  }
  "deploy_vercel" {
    Invoke-SetupVercelDeploy -WorkspaceRoot $WorkspaceRoot -EnvPath $envPath
  }
  "deploy_google" {
    Invoke-SetupGoogleDeploy -WorkspaceRoot $WorkspaceRoot -EnvPath $envPath
  }
  default {
    throw "Unsupported setup action."
  }
}
