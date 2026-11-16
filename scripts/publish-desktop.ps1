# Verify and stage exact Windows installers. Publication uses the full root deploy procedure.
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
  [string]$Version,
  [string]$Notes = "Mnemosyne Cognitive OS desktop update.",
  [switch]$SkipCopy,
  [switch]$DeployHosting
)

$ErrorActionPreference = "Stop"
if ($DeployHosting) {
  throw 'Use deploy.ps1 -Project <project> after staging to run the full release validation and publication sequence.'
}
$arguments = @((Join-Path $PSScriptRoot 'stage-desktop-artifacts.cjs'), '--version', $Version, '--notes', $Notes)
if ($SkipCopy) { $arguments += '--skip-copy' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw 'Desktop staging refused. No deployment was attempted.' }
