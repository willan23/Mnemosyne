[CmdletBinding()]
param(
    [ValidateSet('Debug', 'ReleaseBundle', 'ReleaseApk')]
    [string]$Target = 'Debug',
    [int]$VersionCode = 0,
    [string]$VersionName = '',
    [string]$ReportDirectory = ''
)

$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'scripts/android/build-pipeline.ps1')
    Invoke-MnemosyneAndroidBuild -Root $PSScriptRoot -Target $Target -VersionCode $VersionCode -VersionName $VersionName -ReportDirectory $ReportDirectory
} catch {
    Write-Error 'Android build failed. Inspect the failed step and its local report; no artifact was published.'
    exit 1
}
