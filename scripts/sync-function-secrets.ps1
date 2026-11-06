<#
Read-only migration checks. The historical dotenv-to-cloud copier was removed.
Usage: powershell -File scripts/sync-function-secrets.ps1 -Project mnemosyne-one -Out <absolute-new-json> [-Mode plan|audit|preflight]
#>
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$Project,
  [Parameter(Mandatory=$true)][string]$Out,
  [ValidateSet('plan','audit','preflight')][string]$Mode='preflight'
)
$ErrorActionPreference='Stop'
if (-not [System.IO.Path]::IsPathRooted($Out)) { throw 'Output must be an absolute new JSON path.' }
& node (Join-Path $PSScriptRoot 'function-secrets.js') $Mode --project $Project --out $Out
exit $LASTEXITCODE
