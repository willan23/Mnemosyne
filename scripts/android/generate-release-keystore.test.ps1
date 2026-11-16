$ErrorActionPreference = 'Stop'
$taskFixture = Join-Path ([IO.Path]::GetTempPath()) ('mnemosyne-keystore-test-' + [Guid]::NewGuid().ToString('N'))
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskGenerator = Join-Path $PSScriptRoot 'generate-release-keystore.ps1'
$taskOldPath = $env:PATH
$taskOldFixture = $env:MNEMOSYNE_SIGNING_TEST_DIRECTORY
New-Item -ItemType Directory -Path $taskFixture | Out-Null
function Assert-True($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Private-Hash($File) {
    if (-not (Test-Path -LiteralPath $File)) { return $null }
    $algorithm = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($File)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)) } finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Read-Host {
    param($Prompt, [switch]$AsSecureString)
    Assert-True $AsSecureString 'Secret prompt was not secure.'
    $global:taskKeystorePromptCount++
    $taskValue = $global:taskKeystoreResponses.Dequeue()
    $taskSecure = New-Object Security.SecureString
    foreach ($taskCharacter in $taskValue.ToCharArray()) { $taskSecure.AppendChar($taskCharacter) }
    $taskSecure.MakeReadOnly()
    return $taskSecure
}
function Invoke-FixtureGenerator($File, $First, $Second) {
    $global:taskKeystoreResponses = New-Object 'System.Collections.Generic.Queue[string]'
    $global:taskKeystoreResponses.Enqueue($First); $global:taskKeystoreResponses.Enqueue($Second); $global:taskKeystorePromptCount = 0
    & $taskGenerator -KeystorePath $File -Alias 'synthetic-test' -DistinguishedName 'CN=Synthetic fixture'
}
try {
    $taskConfig = Join-Path $taskRoot 'frontend/android/keystore.properties'
    $taskBeforeHash = Private-Hash $taskConfig
    $taskEnvironmentBefore = @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { $_ -like 'MNEMOSYNE_KEYTOOL_*' } | Sort-Object)
    $taskNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
    $taskJdkCandidates = @()
    if ($env:JAVA_HOME) { $taskJdkCandidates += (Join-Path $env:JAVA_HOME 'bin/keytool.exe') }
    $taskJdkCandidates += 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe'
    $taskRealKeytool = $taskJdkCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    Assert-True ([bool]$taskRealKeytool) 'A real JDK keytool is required for this Windows test.'
    $taskFake = Join-Path $taskFixture 'keytool-fixture.cjs'
    @'
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),root=process.env.MNEMOSYNE_SIGNING_TEST_DIRECTORY,find=name=>args[args.indexOf(name)+1];
const envName=find('-storepass:env'),value=process.env[envName],target=path.resolve(find('-keystore'));
const safe=Boolean(value)&&find('-keypass:env')===envName&&!args.includes(value)&&path.dirname(target)===path.resolve(root);
fs.writeFileSync(path.join(root,'transport.json'),JSON.stringify({environmentSupplied:Boolean(value),rawSecretInArguments:args.includes(value),samePasswordVariable:find('-keypass:env')===envName}));
if(!safe)process.exit(43);if(process.env.MNEMOSYNE_SIGNING_TEST_FAIL==='1')process.exit(47);fs.writeFileSync(target,'synthetic keystore transport fixture');
'@ | Set-Content -LiteralPath $taskFake -Encoding UTF8
    ('@"' + $taskNode + '" "' + $taskFake + '" %*') | Set-Content -LiteralPath (Join-Path $taskFixture 'keytool.cmd') -Encoding ASCII
    $env:MNEMOSYNE_SIGNING_TEST_DIRECTORY = $taskFixture
    $env:PATH = $taskFixture + ';' + $taskOldPath
    $taskPhrase = ('synthetic only fixture ' * 2).Trim()
    Invoke-FixtureGenerator (Join-Path $taskFixture 'transport.p12') $taskPhrase $taskPhrase
    $taskTransport = Get-Content -Raw -LiteralPath (Join-Path $taskFixture 'transport.json') | ConvertFrom-Json
    Assert-True ($taskTransport.environmentSupplied -and -not $taskTransport.rawSecretInArguments -and $taskTransport.samePasswordVariable) 'The native child did not receive password references safely.'
    foreach ($taskCase in @(@('short', 'short'), @('synthetic first password', 'synthetic other password'))) {
        $taskTarget = Join-Path $taskFixture ('refused-' + [Guid]::NewGuid().ToString('N') + '.p12')
        $taskThrew = $false
        try { Invoke-FixtureGenerator $taskTarget $taskCase[0] $taskCase[1] } catch { $taskThrew = $true }
        Assert-True ($taskThrew -and -not (Test-Path -LiteralPath $taskTarget)) 'Invalid password created a keystore.'
    }
    $taskExisting = Join-Path $taskFixture 'existing.p12'; 'existing synthetic file' | Set-Content -LiteralPath $taskExisting
    $taskExistingHash = Private-Hash $taskExisting; $global:taskKeystorePromptCount = 0; $taskThrew = $false
    try { & $taskGenerator -KeystorePath $taskExisting -Alias 'synthetic-test' } catch { $taskThrew = $true }
    Assert-True ($taskThrew -and $global:taskKeystorePromptCount -eq 0 -and (Private-Hash $taskExisting) -eq $taskExistingHash) 'Existing keystore was touched or prompted for.'
    $env:MNEMOSYNE_SIGNING_TEST_FAIL = '1'; $taskThrew = $false
    try { Invoke-FixtureGenerator (Join-Path $taskFixture 'native-failure.p12') $taskPhrase $taskPhrase } catch { $taskThrew = $true }
    Assert-True $taskThrew 'Native keytool failure was ignored.'
    Remove-Item Env:MNEMOSYNE_SIGNING_TEST_FAIL
    $env:PATH = [IO.Path]::GetDirectoryName($taskRealKeytool) + ';' + $taskOldPath
    $taskRealFile = Join-Path $taskFixture 'actual-synthetic.p12'
    Invoke-FixtureGenerator $taskRealFile $taskPhrase $taskPhrase
    $env:MNEMOSYNE_SIGNING_TEST_VERIFY = $taskPhrase
    try {
        $taskListing = & $taskRealKeytool -list -keystore $taskRealFile -storepass:env MNEMOSYNE_SIGNING_TEST_VERIFY 2>&1
        Assert-True ($LASTEXITCODE -eq 0 -and ($taskListing -join ' ') -match 'synthetic-test') 'The real JDK did not verify the generated synthetic keystore.'
    } finally { Remove-Item Env:MNEMOSYNE_SIGNING_TEST_VERIFY }
    $taskEnvironmentAfter = @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { $_ -like 'MNEMOSYNE_KEYTOOL_*' } | Sort-Object)
    Assert-True (($taskEnvironmentBefore -join ',') -eq ($taskEnvironmentAfter -join ',')) 'Ephemeral password environment survived a return or exception.'
    Assert-True ($taskBeforeHash -eq (Private-Hash $taskConfig)) 'Existing Gradle signing configuration changed.'
    Write-Host 'ANDROID_KEYSTORE_ASSERTIONS_PASSED'
} finally {
    $env:PATH = $taskOldPath
    $env:MNEMOSYNE_SIGNING_TEST_DIRECTORY = $taskOldFixture
    Remove-Item Env:MNEMOSYNE_SIGNING_TEST_FAIL -ErrorAction SilentlyContinue
    Remove-Item Env:MNEMOSYNE_SIGNING_TEST_VERIFY -ErrorAction SilentlyContinue
    Remove-Variable taskKeystoreResponses, taskKeystorePromptCount -Scope Global -ErrorAction SilentlyContinue
    $taskAbsolute = [IO.Path]::GetFullPath($taskFixture)
    if ([IO.Path]::GetDirectoryName($taskAbsolute).TrimEnd('\') -ne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($taskAbsolute) -notlike 'mnemosyne-keystore-test-*') { throw 'Fixture cleanup outside intended directory.' }
    Remove-Item -LiteralPath $taskAbsolute -Recurse -Force
}
