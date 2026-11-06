function Invoke-MnemosyneAndroidBuild {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [ValidateSet('Debug', 'ReleaseBundle', 'ReleaseApk')][string]$Target = 'Debug',
        [int]$VersionCode = 0,
        [string]$VersionName = '',
        [string]$ReportDirectory = '',
        [scriptblock]$Runner
    )

    $ErrorActionPreference = 'Stop'
    if (-not [IO.Path]::IsPathRooted($Root)) { throw 'Android root must be absolute.' }
    $resolvedRoot = [IO.Path]::GetFullPath($Root)
    $frontend = Join-Path $resolvedRoot 'frontend'
    $android = Join-Path $frontend 'android'
    if (-not (Test-Path -LiteralPath (Join-Path $android 'gradlew.bat') -PathType Leaf)) { throw 'Android wrapper is unavailable.' }
    $package = Get-Content -Raw -LiteralPath (Join-Path $frontend 'package.json') | ConvertFrom-Json
    if ($Target -eq 'Debug') {
        if ($VersionCode -eq 0) { $VersionCode = 1 }
        if (-not $VersionName) { $VersionName = $package.version }
    }
    if ($VersionCode -lt 1 -or $VersionCode -gt 2100000000 -or $VersionName -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') { throw 'Release requires an explicit valid version code and name.' }
    if ($VersionName -cne $package.version) { throw 'Android version name must match the frontend package.' }
    if (-not $ReportDirectory) { $ReportDirectory = Join-Path ([IO.Path]::GetTempPath()) ('mnemosyne-android-' + [Guid]::NewGuid().ToString('N')) }
    if (-not [IO.Path]::IsPathRooted($ReportDirectory)) { throw 'Android report directory must be absolute.' }
    if (Test-Path -LiteralPath $ReportDirectory) { throw 'Android report directory must be new.' }
    New-Item -ItemType Directory -Path $ReportDirectory -ErrorAction Stop | Out-Null

    $result = [ordered]@{ v = 1; target = $Target; versionCode = $VersionCode; versionName = $VersionName; completedSteps = @(); failedStep = $null; failedExitCode = $null; nativeBuildCompleted = $false; signingVerified = $false; devicePilotVerified = $false; published = $false }
    $oldJava = $env:JAVA_HOME
    $oldPath = $env:PATH
    $location = Get-Location
    try {
        if (-not $env:JAVA_HOME) {
            $studioJdk = 'C:\Program Files\Android\Android Studio\jbr'
            if (Test-Path -LiteralPath (Join-Path $studioJdk 'bin/java.exe')) { $env:JAVA_HOME = $studioJdk }
        }
        if ($env:JAVA_HOME) { $env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH }
        if (-not $Runner) {
            $Runner = {
                param($Step)
                Set-Location -LiteralPath $Step.WorkingDirectory
                & $Step.Tool @($Step.Arguments) | Out-Host
                return $LASTEXITCODE
            }
        }
        $task = @{ Debug = 'assembleDebug'; ReleaseBundle = 'bundleRelease'; ReleaseApk = 'assembleRelease' }[$Target]
        $steps = @(
            @{ Id = 'node22'; Tool = 'node'; Arguments = @((Join-Path $resolvedRoot 'scripts/preflight-node.js')); WorkingDirectory = $resolvedRoot },
            @{ Id = 'java21'; Tool = 'node'; Arguments = @((Join-Path $resolvedRoot 'scripts/preflight-java.js')); WorkingDirectory = $resolvedRoot },
            @{ Id = 'frontend-tests'; Tool = 'npm.cmd'; Arguments = @('run', 'test', '--', '--run', '--maxWorkers=1'); WorkingDirectory = $frontend },
            @{ Id = 'frontend-build'; Tool = 'npm.cmd'; Arguments = @('run', 'build'); WorkingDirectory = $frontend },
            @{ Id = 'capacitor-sync'; Tool = 'node'; Arguments = @((Join-Path $frontend 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'); WorkingDirectory = $frontend },
            @{ Id = 'gradle'; Tool = (Join-Path $android 'gradlew.bat'); Arguments = @('--no-daemon', $task, "-PMNEMOSYNE_VERSION_CODE=$VersionCode", "-PMNEMOSYNE_VERSION_NAME=$VersionName"); WorkingDirectory = $android }
        )
        foreach ($step in $steps) {
            $result.failedStep = $step.Id
            Write-Host ('Android: ' + $step.Id)
            $code = & $Runner $step
            if ($null -eq $code -or $code -isnot [int] -or $code -ne 0) { $result.failedExitCode = $code; throw 'Android command failed.' }
            $result.completedSteps += $step.Id
        }
        $result.failedStep = $null
        $result.nativeBuildCompleted = $true
    } finally {
        $env:JAVA_HOME = $oldJava
        $env:PATH = $oldPath
        Set-Location -LiteralPath $location.Path
        $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $ReportDirectory 'android-build-result.json') -Encoding UTF8
    }
    Write-Host ('Android build commands completed. Report: ' + $ReportDirectory)
}
