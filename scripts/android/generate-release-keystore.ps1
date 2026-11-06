[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$KeystorePath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
    [string]$Alias,
    [ValidateLength(1, 2048)]
    [string]$DistinguishedName = 'CN=Mnemosyne, OU=Product, O=Mnemosyne, L=Lisbon, ST=Lisbon, C=PT'
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($KeystorePath)) { throw 'The new keystore path must be absolute.' }
$targetFile = [IO.Path]::GetFullPath($KeystorePath)
if ([IO.Path]::GetExtension($targetFile) -notin @('.keystore', '.p12')) { throw 'Use a new .keystore or .p12 file.' }
if (Test-Path -LiteralPath $targetFile) { throw 'The requested keystore already exists and was preserved.' }
if ($DistinguishedName.Contains("`r") -or $DistinguishedName.Contains("`n")) { throw 'The certificate name must be a single line.' }

$keytoolCommand = Get-Command 'keytool' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$keytoolPath = if ($keytoolCommand) { $keytoolCommand.Source } else { $null }
if (-not $keytoolPath) {
    $candidates = @('C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe')
    if ($env:JAVA_HOME) { $candidates = @((Join-Path $env:JAVA_HOME 'bin/keytool.exe')) + $candidates }
    $keytoolPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $keytoolPath) { throw 'keytool is unavailable; install JDK 21+ or set JAVA_HOME.' }

$secret = $null
$confirmation = $null
$secretPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
$passwordVariable = 'MNEMOSYNE_KEYTOOL_' + [Guid]::NewGuid().ToString('N')
try {
    $secret = Read-Host 'New keystore password (at least 12 characters)' -AsSecureString
    $confirmation = Read-Host 'Confirm the new keystore password' -AsSecureString
    if ($secret.Length -lt 12 -or $secret.Length -gt 1024 -or $confirmation.Length -ne $secret.Length) { throw 'Passwords must match and contain 12 to 1024 characters.' }
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
    $difference = 0
    for ($index = 0; $index -lt $secret.Length; $index++) {
        $difference = $difference -bor ([Runtime.InteropServices.Marshal]::ReadInt16($secretPointer, $index * 2) -bxor [Runtime.InteropServices.Marshal]::ReadInt16($confirmationPointer, $index * 2))
    }
    if ($difference -ne 0) { throw 'Passwords do not match.' }
    [Environment]::SetEnvironmentVariable($passwordVariable, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer), 'Process')
    $targetDirectory = [IO.Path]::GetDirectoryName($targetFile)
    if (-not (Test-Path -LiteralPath $targetDirectory)) { New-Item -ItemType Directory -Path $targetDirectory -ErrorAction Stop | Out-Null }
    & $keytoolPath -genkeypair -keystore $targetFile -storetype PKCS12 -alias $Alias -keyalg RSA -keysize 4096 -validity 10000 -dname $DistinguishedName -storepass:env $passwordVariable -keypass:env $passwordVariable
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $targetFile -PathType Leaf)) { throw 'Key generation failed. Inspect any partial new file before retrying.' }
} finally {
    [Environment]::SetEnvironmentVariable($passwordVariable, $null, 'Process')
    if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
    if ($confirmationPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer) }
    if ($secret) { $secret.Dispose() }
    if ($confirmation) { $confirmation.Dispose() }
}
Write-Host 'New keystore created. Existing signing configuration was preserved; configure Gradle signing privately.'
