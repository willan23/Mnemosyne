$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-pipeline.ps1')
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskFixture = Join-Path ([IO.Path]::GetTempPath()) ('mnemosyne-android-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskFixture | Out-Null
function Assert-True($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Get-PrivateFileHash($File) {
    if (-not (Test-Path -LiteralPath $File)) { return $null }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($File)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)) } finally { $stream.Dispose(); $algorithm.Dispose() }
}
$script:taskCalls = @()
$script:taskFailure = ''
$taskRunner = {
    param($Step)
    $script:taskCalls += ,$Step
    Set-Location -LiteralPath $Step.WorkingDirectory
    if ($Step.Id -eq $script:taskFailure) { return [int]47 }
    return [int]0
}
try {
    $taskCwd = (Get-Location).Path
    $taskJava = $env:JAVA_HOME
    $taskPath = $env:PATH
    $taskVersion = (Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'frontend/package.json') | ConvertFrom-Json).version
    $taskKeystore = Join-Path $taskRoot 'frontend/android/keystore.properties'
    $taskKeystoreHash = Get-PrivateFileHash $taskKeystore
    foreach ($taskTarget in @('Debug', 'ReleaseApk', 'ReleaseBundle')) {
        $script:taskCalls = @()
        $taskOut = Join-Path $taskFixture $taskTarget
        Invoke-MnemosyneAndroidBuild -Root $taskRoot -Target $taskTarget -VersionCode 123 -VersionName $taskVersion -ReportDirectory $taskOut -Runner $taskRunner
        $taskSteps = @($script:taskCalls | ForEach-Object { $_.Id })
        Assert-True (($taskSteps -join ',') -eq 'node22,java21,frontend-tests,frontend-build,capacitor-sync,gradle') 'Android build skipped or reordered a required step.'
        $taskGradle = $script:taskCalls[-1]
        $taskExpected = @{ Debug = 'assembleDebug'; ReleaseApk = 'assembleRelease'; ReleaseBundle = 'bundleRelease' }[$taskTarget]
        Assert-True ($taskGradle.Arguments -contains $taskExpected) 'Wrong Android target.'
        Assert-True ($taskGradle.Arguments -contains '-PMNEMOSYNE_VERSION_CODE=123' -and $taskGradle.Arguments -contains "-PMNEMOSYNE_VERSION_NAME=$taskVersion") 'Version was not passed as a project property.'
        Assert-True ($script:taskCalls[4].Arguments[0] -like '*/node_modules/@capacitor/cli/bin/capacitor' -or $script:taskCalls[4].Arguments[0] -like '*\node_modules\@capacitor\cli\bin\capacitor') 'Capacitor must use the installed CLI.'
        $taskResult = Get-Content -Raw -LiteralPath (Join-Path $taskOut 'android-build-result.json') | ConvertFrom-Json
        Assert-True ($taskResult.nativeBuildCompleted -and -not $taskResult.signingVerified -and -not $taskResult.devicePilotVerified -and -not $taskResult.published) 'Build commands cannot prove signature, device or publication.'
    }
    foreach ($taskFailure in $taskSteps) {
        $script:taskCalls = @(); $script:taskFailure = $taskFailure
        $taskOut = Join-Path $taskFixture ('failure-' + $taskFailure)
        $taskThrew = $false
        try { Invoke-MnemosyneAndroidBuild -Root $taskRoot -ReportDirectory $taskOut -Runner $taskRunner } catch { $taskThrew = $true }
        Assert-True ($taskThrew -and $script:taskCalls[-1].Id -eq $taskFailure) 'Android build continued after a failed command.'
        Assert-True ($script:taskCalls.Count -eq ([Array]::IndexOf($taskSteps, $taskFailure) + 1)) 'Android build repeated or skipped an earlier command.'
        $taskResult = Get-Content -Raw -LiteralPath (Join-Path $taskOut 'android-build-result.json') | ConvertFrom-Json
        Assert-True ($taskResult.failedStep -eq $taskFailure -and $taskResult.failedExitCode -eq 47 -and -not $taskResult.nativeBuildCompleted) 'Android failure report is incorrect.'
        Assert-True ((Get-Location).Path -eq $taskCwd -and $env:JAVA_HOME -eq $taskJava -and $env:PATH -eq $taskPath) 'Android build did not restore process context.'
    }
    $script:taskFailure = ''
    foreach ($taskInvalid in @(@{ Target='ReleaseApk'; VersionCode=0; VersionName=$taskVersion }, @{ Target='ReleaseBundle'; VersionCode=1; VersionName='' }, @{ Target='ReleaseApk'; VersionCode=1; VersionName='0.0.0' }, @{ Target='Debug'; VersionCode=-1; VersionName=$taskVersion })) {
        $script:taskCalls = @(); $taskThrew = $false
        try { Invoke-MnemosyneAndroidBuild -Root $taskRoot @taskInvalid -ReportDirectory (Join-Path $taskFixture 'invalid') -Runner $taskRunner } catch { $taskThrew = $true }
        Assert-True ($taskThrew -and $script:taskCalls.Count -eq 0) 'Invalid version reached build commands.'
    }
    $script:taskCalls = @(); $taskThrew = $false
    try { Invoke-MnemosyneAndroidBuild -Root $taskRoot -ReportDirectory (Join-Path $taskFixture 'Debug') -Runner $taskRunner } catch { $taskThrew = $true }
    Assert-True ($taskThrew -and $script:taskCalls.Count -eq 0) 'Existing evidence was overwritten.'
    $taskAfterHash = Get-PrivateFileHash $taskKeystore
    Assert-True ($taskKeystoreHash -eq $taskAfterHash) 'Signing configuration was changed.'
    Write-Host 'ANDROID_SEQUENCE_ASSERTIONS_PASSED'
} finally {
    $taskAbsolute = [IO.Path]::GetFullPath($taskFixture)
    if ([IO.Path]::GetDirectoryName($taskAbsolute).TrimEnd('\') -ne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($taskAbsolute) -notlike 'mnemosyne-android-test-*') { throw 'Fixture cleanup outside intended directory.' }
    Remove-Item -LiteralPath $taskAbsolute -Recurse -Force
}
