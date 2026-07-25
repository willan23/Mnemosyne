param(
    [int]$VersionCode = 2,
    [string]$VersionName = "1.0.1",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$frontend = Join-Path $root "frontend"
$android = Join-Path $frontend "android"
$propertiesPath = Join-Path $android "keystore.properties"
$bundle = Join-Path $android "app/build/outputs/bundle/release/app-release.aab"

if (-not $env:JAVA_HOME) {
    $androidStudioJbr = "C:\Program Files\Android\Android Studio\jbr"
    if (Test-Path (Join-Path $androidStudioJbr "bin/java.exe")) {
        $env:JAVA_HOME = $androidStudioJbr
        $env:PATH = "$androidStudioJbr\bin;$env:PATH"
        Write-Host "Using Android Studio bundled JDK:" $env:JAVA_HOME
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

Push-Location $frontend
try {
    if (-not $SkipTests) {
        Invoke-Native "npm" @("run", "test", "--", "--run")
    }

    Invoke-Native "npm" @("run", "build")

    $distDownloads = Join-Path $frontend "dist/downloads"
    if (Test-Path $distDownloads) {
        Remove-Item -LiteralPath $distDownloads -Recurse -Force
    }

    Invoke-Native "npx" @("cap", "sync", "android")
} finally {
    Pop-Location
}

$androidDownloads = Join-Path $android "app/src/main/assets/public/downloads"
if (Test-Path $androidDownloads) {
    Remove-Item -LiteralPath $androidDownloads -Recurse -Force
}

if (Test-Path $propertiesPath) {
    $content = Get-Content -LiteralPath $propertiesPath
    $content = $content | Where-Object { $_ -notmatch "^(versionCode|versionName)=" }
    $content += "versionCode=$VersionCode"
    $content += "versionName=$VersionName"
    $content | Set-Content -LiteralPath $propertiesPath -Encoding UTF8
} else {
    Write-Warning "frontend/android/keystore.properties not found. Gradle can still build an unsigned release bundle, but Play Console needs a signed artifact or Play App Signing setup."
}

Push-Location $android
try {
    if (Test-Path $bundle) {
        Remove-Item -LiteralPath $bundle -Force
    }
    Invoke-Native ".\gradlew.bat" @("bundleRelease")
} finally {
    Pop-Location
}

if (Test-Path $bundle) {
    Write-Host "Play Store AAB ready:" $bundle
} else {
    throw "Release bundle not found at $bundle"
}
