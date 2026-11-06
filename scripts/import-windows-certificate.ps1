# Import an Authenticode .pfx into the current user certificate store and
# optionally inject the thumbprint into Tauri Windows config.
#
# Local:
#   powershell -File scripts/import-windows-certificate.ps1 -PfxPath .\certs\mnemosyne.pfx -Password '***' -PatchTauriConfig
#
# CI (base64 secret):
#   $env:WINDOWS_CERTIFICATE = '<base64 pfx>'
#   $env:WINDOWS_CERTIFICATE_PASSWORD = '***'
#   powershell -File scripts/import-windows-certificate.ps1 -FromEnv -PatchTauriConfig

param(
  [string]$PfxPath,
  [string]$Password,
  [switch]$FromEnv,
  [switch]$PatchTauriConfig,
  [string]$WindowsConfigPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $WindowsConfigPath) {
  $WindowsConfigPath = Join-Path $root "frontend\src-tauri\tauri.windows.conf.json"
}

$workDir = Join-Path $env:RUNNER_TEMP "mnemosyne-codesign"
if (-not $workDir -or -not (Test-Path (Split-Path $workDir -Parent) -ErrorAction SilentlyContinue)) {
  $workDir = Join-Path ([System.IO.Path]::GetTempPath()) "mnemosyne-codesign"
}
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$pfxFile = Join-Path $workDir "certificate.pfx"

if ($FromEnv) {
  if (-not $env:WINDOWS_CERTIFICATE) {
    Write-Host "WINDOWS_CERTIFICATE not set — skipping Authenticode import (unsigned build)."
    exit 0
  }
  $Password = $env:WINDOWS_CERTIFICATE_PASSWORD
  if (-not $Password) {
    throw "WINDOWS_CERTIFICATE_PASSWORD is required when WINDOWS_CERTIFICATE is set."
  }
  $bytes = [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE)
  [System.IO.File]::WriteAllBytes($pfxFile, $bytes)
} else {
  if (-not $PfxPath -or -not (Test-Path $PfxPath)) {
    throw "Provide -PfxPath to an existing .pfx file, or use -FromEnv with WINDOWS_CERTIFICATE."
  }
  if (-not $Password) {
    throw "Provide -Password for the .pfx file."
  }
  Copy-Item $PfxPath $pfxFile -Force
}

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
$imported = Import-PfxCertificate -FilePath $pfxFile -CertStoreLocation Cert:\CurrentUser\My -Password $secure
$thumbprint = ($imported | Select-Object -First 1).Thumbprint

if (-not $thumbprint) {
  throw "Failed to import certificate / read thumbprint."
}

Write-Host "Imported Authenticode certificate. Thumbprint=$thumbprint"

# Expose for subsequent steps / local shells
$env:WINDOWS_CERTIFICATE_THUMBPRINT = $thumbprint
Write-Output "WINDOWS_CERTIFICATE_THUMBPRINT=$thumbprint"

if ($PatchTauriConfig) {
  if (-not (Test-Path $WindowsConfigPath)) {
    throw "Tauri Windows config not found: $WindowsConfigPath"
  }
  $json = Get-Content $WindowsConfigPath -Raw | ConvertFrom-Json
  if (-not $json.bundle) { $json | Add-Member -NotePropertyName bundle -NotePropertyValue ([pscustomobject]@{}) }
  if (-not $json.bundle.windows) {
    $json.bundle | Add-Member -NotePropertyName windows -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  $json.bundle.windows | Add-Member -NotePropertyName certificateThumbprint -NotePropertyValue $thumbprint -Force
  if (-not $json.bundle.windows.digestAlgorithm) {
    $json.bundle.windows | Add-Member -NotePropertyName digestAlgorithm -NotePropertyValue "sha256" -Force
  }
  if (-not $json.bundle.windows.timestampUrl) {
    $json.bundle.windows | Add-Member -NotePropertyName timestampUrl -NotePropertyValue "http://timestamp.digicert.com" -Force
  }

  $json | ConvertTo-Json -Depth 12 | Set-Content -Path $WindowsConfigPath -Encoding UTF8
  Write-Host "Patched certificateThumbprint into $WindowsConfigPath"
}

# Cleanup plaintext pfx from disk when possible
Remove-Item $pfxFile -Force -ErrorAction SilentlyContinue
