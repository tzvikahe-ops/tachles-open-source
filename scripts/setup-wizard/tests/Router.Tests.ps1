$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "..\server\Router.psm1") -Force

function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -ne $Actual) {
    throw "$Message Expected '$Expected', got '$Actual'."
  }
}

$definition = Get-SetupActionDefinition -Name "local_check"
Assert-Equal "local_check" $definition.Name "Action name is wrong."
Assert-Equal "prerequisites" $definition.Step "Action step is wrong."
Assert-Equal "powershell.exe" $definition.FilePath "Action executable is wrong."

$argumentText = $definition.Arguments -join " "
if ($argumentText.Contains("local_check")) {
  throw "Action name was interpolated into command arguments."
}
if ($null -ne (Get-SetupActionDefinition -Name "../local_check")) {
  throw "Path-like action name was accepted."
}
if ($null -ne (Get-SetupActionDefinition -Name "local_check; whoami")) {
  throw "Command-like action name was accepted."
}

$wizardRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
foreach ($name in @(
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
  )) {
  $action = Get-SetupActionDefinition `
    -Name $name `
    -WorkspaceRoot "C:\setup-target" `
    -WizardRoot $wizardRoot
  Assert-Equal $name $action.Name "Allowlisted action is missing."
  Assert-Equal "powershell.exe" $action.FilePath "Action host is wrong."
  if ($action.CompletionStatus -notin @(
      "pending",
      "needs_user_action",
      "succeeded"
    )) {
    throw "Action completion status is invalid."
  }
  if (($action.Arguments -join " ").Contains(";")) {
    throw "Action arguments contain a shell separator."
  }
}

Write-Host "Router.Tests.ps1 passed"
