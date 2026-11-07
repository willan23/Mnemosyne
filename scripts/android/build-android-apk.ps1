[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2100000000)]
    [int]$VersionCode,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string]$VersionName,
    [string]$ReportDirectory = ''
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot '../../build-android.ps1') -Target ReleaseApk -VersionCode $VersionCode -VersionName $VersionName -ReportDirectory $ReportDirectory
