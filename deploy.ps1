# Deploy Script for Mnemosyne
# Execute this script to do a full deploy

Write-Host "Starting Mnemosyne deployment..." -ForegroundColor Cyan
Write-Host ""

# Check Firebase login
Write-Host "Checking Firebase authentication..." -ForegroundColor Yellow
$firebaseUser = firebase.cmd login:list 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged into Firebase. Please run: firebase login" -ForegroundColor Red
    exit 1
}
Write-Host "Authenticated in Firebase" -ForegroundColor Green
Write-Host ""

# Check project
Write-Host "Checking Firebase project..." -ForegroundColor Yellow
$project = Get-Content .firebaserc | ConvertFrom-Json
$projectId = $project.projects.default
Write-Host "Project: $projectId" -ForegroundColor Green
Write-Host ""

# Build Functions
Write-Host "Building Cloud Functions..." -ForegroundColor Yellow
Set-Location functions
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error building functions" -ForegroundColor Red
    exit 1
}
Write-Host "Functions built successfully" -ForegroundColor Green
Set-Location ..
Write-Host ""

# Build Frontend
Write-Host "Building Frontend..." -ForegroundColor Yellow
Set-Location frontend
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error building frontend" -ForegroundColor Red
    exit 1
}
Write-Host "Frontend built successfully" -ForegroundColor Green
Set-Location ..
Write-Host ""

# Deploy Firestore Rules
Write-Host "Deploying Firestore Rules..." -ForegroundColor Yellow
firebase.cmd deploy --only firestore:rules
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Error deploying Firestore rules" -ForegroundColor Yellow
}
Write-Host ""

# Deploy Storage Rules
Write-Host "Deploying Storage Rules..." -ForegroundColor Yellow
firebase.cmd deploy --only storage:rules
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Error deploying Storage rules" -ForegroundColor Yellow
}
Write-Host ""

# Deploy Functions
Write-Host "Deploying Cloud Functions..." -ForegroundColor Yellow
firebase.cmd deploy --only functions
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Error deploying functions" -ForegroundColor Yellow
}
Write-Host ""

# Deploy Hosting
Write-Host "Deploying Hosting..." -ForegroundColor Yellow
firebase.cmd deploy --only hosting
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error deploying hosting" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "Deploy completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "URLs:" -ForegroundColor Cyan
Write-Host "   Hosting: https://$projectId.web.app" -ForegroundColor White
Write-Host "   Console: https://console.firebase.google.com/project/$projectId" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "   1. Access the app and test functionalities" -ForegroundColor White
Write-Host "   2. Check logs: firebase functions:log" -ForegroundColor White
Write-Host "   3. Configure custom domain (optional)" -ForegroundColor White
Write-Host ""
