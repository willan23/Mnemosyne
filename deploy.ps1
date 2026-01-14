# 🚀 Deploy Script para Mnemosyne
# Execute este script para fazer deploy completo

Write-Host "🚀 Iniciando deploy do Mnemosyne..." -ForegroundColor Cyan
Write-Host ""

# Verificar se está logado no Firebase
Write-Host "📋 Verificando autenticação Firebase..." -ForegroundColor Yellow
$firebaseUser = firebase login:list 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Não está logado no Firebase. Execute: firebase login" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Autenticado no Firebase" -ForegroundColor Green
Write-Host ""

# Verificar projeto
Write-Host "📋 Verificando projeto Firebase..." -ForegroundColor Yellow
$project = Get-Content .firebaserc | ConvertFrom-Json
$projectId = $project.projects.default
Write-Host "✅ Projeto: $projectId" -ForegroundColor Green
Write-Host ""

# Build Functions
Write-Host "🔨 Building Cloud Functions..." -ForegroundColor Yellow
Set-Location functions
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao buildar functions" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Functions buildadas" -ForegroundColor Green
Set-Location ..
Write-Host ""

# Build Frontend
Write-Host "🔨 Building Frontend..." -ForegroundColor Yellow
Set-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao buildar frontend" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Frontend buildado" -ForegroundColor Green
Set-Location ..
Write-Host ""

# Deploy Firestore Rules
Write-Host "📤 Deploying Firestore Rules..." -ForegroundColor Yellow
firebase deploy --only firestore:rules
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Erro ao deployar Firestore rules" -ForegroundColor Yellow
}
Write-Host ""

# Deploy Storage Rules
Write-Host "📤 Deploying Storage Rules..." -ForegroundColor Yellow
firebase deploy --only storage:rules
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Erro ao deployar Storage rules" -ForegroundColor Yellow
}
Write-Host ""

# Deploy Functions
Write-Host "📤 Deploying Cloud Functions..." -ForegroundColor Yellow
firebase deploy --only functions
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Erro ao deployar functions" -ForegroundColor Yellow
}
Write-Host ""

# Deploy Hosting
Write-Host "📤 Deploying Hosting..." -ForegroundColor Yellow
firebase deploy --only hosting
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro ao deployar hosting" -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "✅ Deploy concluído com sucesso!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 URLs:" -ForegroundColor Cyan
Write-Host "   Hosting: https://$projectId.web.app" -ForegroundColor White
Write-Host "   Console: https://console.firebase.google.com/project/$projectId" -ForegroundColor White
Write-Host ""
Write-Host "📊 Próximos passos:" -ForegroundColor Yellow
Write-Host "   1. Acesse o app e teste funcionalidades" -ForegroundColor White
Write-Host "   2. Verifique logs: firebase functions:log" -ForegroundColor White
Write-Host "   3. Configure domínio customizado (opcional)" -ForegroundColor White
Write-Host ""
