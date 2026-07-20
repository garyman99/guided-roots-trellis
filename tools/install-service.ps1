<#
.SYNOPSIS
  Register (or remove) a Windows Scheduled Task named "TrellisServe" that runs
  `npm run serve` at system startup, so an overnight autopilot course-gen run
  survives an interactive Claude Code / terminal session dying.

.DESCRIPTION
  This is a RECIPE, not something this script runs automatically — read it,
  then run it yourself from an elevated or regular PowerShell prompt as
  appropriate for -RunLevel Limited (no elevation required for Limited).

  The task:
    - Runs `cmd /c npm run serve` with working directory = the repo root
      (the same directory this script lives under, one level up).
    - Triggers: AtStartup, and AtLogOn for the current user (so it also comes
      up immediately if you install it while already logged in, without
      waiting for a reboot).
    - Restarts on failure: RestartCount 999, RestartInterval 1 minute (the
      Scheduled Tasks restart policy — this is not the same as a Windows
      Service's SCM restart, but covers the same need with zero extra deps).
    - -RunLevel Limited: runs as the current user, no admin rights required
      for the task itself (only registering/removing may prompt, depending on
      your machine's policy).

.PARAMETER Uninstall
  Remove the "TrellisServe" scheduled task instead of installing it.

.EXAMPLE
  # Install (run from the repo root, or anywhere — paths below are resolved
  # relative to this script's own location):
  powershell -ExecutionPolicy Bypass -File tools\install-service.ps1

.EXAMPLE
  # Remove:
  powershell -ExecutionPolicy Bypass -File tools\install-service.ps1 -Uninstall

.NOTES
  Logs: `npm run serve` inherits stdio from the scheduled task's own process,
  which Task Scheduler does not capture anywhere useful by default. If you
  need persistent logs, wrap the action in your own `cmd /c npm run serve >>
  path\to\log.txt 2>&1` action, or redirect inside tools/serve.mjs.

  This does NOT run whether-user-is-logged-on-or-not (that needs -RunLevel
  Highest + a stored password, i.e. a real service). For an unattended
  overnight box where nobody is ever logged in, use NSSM or a true Windows
  Service instead — out of scope for this recipe.
#>
param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$TaskName = "TrellisServe"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -eq $existing) {
    Write-Host "No scheduled task named '$TaskName' is registered."
    exit 0
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
  exit 0
}

$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
if ($null -eq $npmCmd) { $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue) }
if ($null -eq $npmCmd) {
  throw "npm was not found on PATH. Install Node.js (which bundles npm) before registering this task."
}

# cmd /c so a plain `npm run serve` (npm.cmd) works the same way it does when
# a person types it — Register-ScheduledTaskAction's Execute must be an actual
# executable, not a .cmd shim.
$action = New-ScheduledTaskAction `
  -Execute "$env:WINDIR\System32\cmd.exe" `
  -Argument "/c npm run serve" `
  -WorkingDirectory $RepoRoot

$triggers = @(
  (New-ScheduledTaskTrigger -AtStartup),
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 0) `
  -DontStopOnIdleEnd `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Principal $principal `
  -Settings $settings `
  -Description "Trellis: npm run serve (built web app + API, single process) — restarts on failure." `
  -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' (repo root: $RepoRoot)."
Write-Host "It will start now if you want to verify: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Check status any time: Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
