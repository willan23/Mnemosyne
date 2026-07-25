param(
    [string]$Alias = "mnemosyne-release",
    [string]$KeystorePath = "frontend/android/keystores/mnemosyne-release.keystore",
    [string]$DistinguishedName = "CN=Mnemosyne, OU=Product, O=Mnemosyne, L=Lisbon, ST=Lisbon, C=PT"
)

$ErrorActionPreference = "Stop"

function Read-SecretValue([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Resolve-KeytoolPath {
    $fromPath = Get-Command "keytool" -ErrorAction SilentlyContinue
    if ($fromPath) {
        return $fromPath.Source
    }

    $candidates = @()
    if ($env:JAVA_HOME) {
        $candidates += (Join-Path $env:JAVA_HOME "bin/keytool.exe")
    }
    $candidates += "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "keytool not found. Install Android Studio/JDK or set JAVA_HOME to a JDK path."
}

$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$keystoreFullPath = Join-Path $root $KeystorePath
$keystoreDir = Split-Path $keystoreFullPath -Parent
$propertiesPath = Join-Path $root "frontend/android/keystore.properties"
$keytoolPath = Resolve-KeytoolPath

if (Test-Path $keystoreFullPath) {
    throw "Keystore already exists: $keystoreFullPath"
}

New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null

$storePassword = Read-SecretValue "Store password"
$keyPassword = Read-SecretValue "Key password"

if ($storePassword.Length -lt 12 -or $keyPassword.Length -lt 12) {
    throw "Use passwords with at least 12 characters."
}

& $keytoolPath -genkeypair `
    -v `
    -keystore $keystoreFullPath `
    -storetype PKCS12 `
    -alias $Alias `
    -keyalg RSA `
    -keysize 4096 `
    -validity 10000 `
    -dname $DistinguishedName `
    -storepass $storePassword `
    -keypass $keyPassword

if ($LASTEXITCODE -ne 0) {
    throw "keytool failed with exit code $LASTEXITCODE"
}

$relativeStoreFile = "../keystores/" + (Split-Path $keystoreFullPath -Leaf)
@"
storeFile=$relativeStoreFile
storePassword=$storePassword
keyAlias=$Alias
keyPassword=$keyPassword
versionCode=1
versionName=1.0.0
"@ | Set-Content -Path $propertiesPath -Encoding UTF8

Write-Host "Created release keystore:" $keystoreFullPath
Write-Host "Created local Gradle signing file:" $propertiesPath
Write-Host "Keep both files private and backed up. Losing the keystore can block future app updates."
