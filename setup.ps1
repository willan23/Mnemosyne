# Script de Configuração Rápida do Mnemosyne
# Execute: .\setup.ps1

Write-Host "🔥 Configuração do Mnemosyne Firebase" -ForegroundColor Cyan
Write-Host ""

# Verificar se Firebase CLI está instalado
Write-Host "Verificando Firebase CLI..." -ForegroundColor Yellow
$firebaseInstalled = Get-Command firebase -ErrorAction SilentlyContinue
if (-not $firebaseInstalled) {
    Write-Host "❌ Firebase CLI não encontrado!" -ForegroundColor Red
    Write-Host "Instale com: npm install -g firebase-tools" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Firebase CLI encontrado" -ForegroundColor Green

# Criar .env do frontend
Write-Host ""
Write-Host "📝 Configurando Frontend..." -ForegroundColor Yellow
if (-not (Test-Path "frontend\.env")) {
    Copy-Item "frontend\.env.example" "frontend\.env"
    Write-Host "✅ Criado frontend\.env" -ForegroundColor Green
    Write-Host "⚠️  EDITE frontend\.env com suas credenciais Firebase!" -ForegroundColor Yellow
} else {
    Write-Host "⏭️  frontend\.env já existe" -ForegroundColor Cyan
}

# Criar .env das functions
Write-Host ""
Write-Host "📝 Configurando Cloud Functions..." -ForegroundColor Yellow
if (-not (Test-Path "functions\.env")) {
    Copy-Item "functions\.env.example" "functions\.env"
    Write-Host "✅ Criado functions\.env" -ForegroundColor Green
    Write-Host "⚠️  EDITE functions\.env com sua OpenAI API key (opcional)" -ForegroundColor Yellow
} else {
    Write-Host "⏭️  functions\.env já existe" -ForegroundColor Cyan
}

# Instalar dependências do frontend
Write-Host ""
Write-Host "📦 Instalando dependências do frontend..." -ForegroundColor Yellow
Set-Location frontend
npm install
Set-Location ..
Write-Host "✅ Dependências do frontend instaladas" -ForegroundColor Green

# Instalar dependências das functions
Write-Host ""
Write-Host "📦 Instalando dependências das Cloud Functions..." -ForegroundColor Yellow
Set-Location functions
npm install
Set-Location ..
Write-Host "✅ Dependências das functions instaladas" -ForegroundColor Green

# Resumo
Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "✅ CONFIGURAÇÃO CONCLUÍDA!" -ForegroundColor Green
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 PRÓXIMOS PASSOS:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Edite frontend\.env com suas credenciais Firebase" -ForegroundColor White
Write-Host "   (Veja FIREBASE_SETUP.md para instruções)" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Edite .firebaserc com seu Project ID" -ForegroundColor White
Write-Host ""
Write-Host "3. (Opcional) Edite functions\.env com OpenAI API key" -ForegroundColor White
Write-Host ""
Write-Host "4. Faça login no Firebase:" -ForegroundColor White
Write-Host "   firebase login" -ForegroundColor Cyan
Write-Host ""
Write-Host "5. Deploy das regras de segurança:" -ForegroundColor White
Write-Host "   firebase deploy --only firestore:rules,storage:rules" -ForegroundColor Cyan
Write-Host ""
Write-Host "6. Deploy das Cloud Functions:" -ForegroundColor White
Write-Host "   firebase deploy --only functions" -ForegroundColor Cyan
Write-Host ""
Write-Host "7. Testar localmente:" -ForegroundColor White
Write-Host "   cd frontend" -ForegroundColor Cyan
Write-Host "   npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "📚 Documentação completa: FIREBASE_SETUP.md" -ForegroundColor Yellow
Write-Host ""
