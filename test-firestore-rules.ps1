$ErrorActionPreference = "Stop"

$javaHomeCandidates = @(@(
    $env:JAVA_HOME,
    "C:\Program Files\Android\Android Studio\jbr",
    "C:\Program Files\Android\Android Studio\jre"
) | Where-Object { $_ -and (Test-Path (Join-Path $_ "bin\java.exe")) })

if (-not $javaHomeCandidates -or $javaHomeCandidates.Count -eq 0) {
    throw "Java/JDK not found. Install a JDK or Android Studio, then set JAVA_HOME."
}

$env:JAVA_HOME = $javaHomeCandidates[0]
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

npx -y firebase-tools@latest emulators:exec --only firestore "npm --prefix frontend run test:rules"
