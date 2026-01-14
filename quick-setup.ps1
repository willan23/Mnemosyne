# Script de Setup Rápido - Mnemosyne Stripe + Capacitor
# Execute: .\quick-setup.ps1

Write-Host "🚀 Mnemosyne - Setup Rápido" -ForegroundColor Cyan
Write-Host ""

# Verificar se está na raiz do projeto
if (-not (Test-Path "frontend") -or -not (Test-Path "functions")) {
    Write-Host "❌ Execute este script na raiz do projeto!" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Instalando dependências do Capacitor..." -ForegroundColor Yellow
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/assets --save-dev

Write-Host ""
Write-Host "✅ Capacitor instalado!" -ForegroundColor Green
Write-Host ""

# Verificar se .env existe no frontend
if (-not (Test-Path "frontend\.env")) {
    Write-Host "📝 Criando frontend/.env a partir do template..." -ForegroundColor Yellow
    Copy-Item "frontend\.env.example" "frontend\.env"
    Write-Host "⚠️  IMPORTANTE: Edite frontend/.env com suas chaves Stripe!" -ForegroundColor Yellow
}
else {
    Write-Host "✅ frontend/.env já existe" -ForegroundColor Green
}

Write-Host ""

# Verificar se .env existe no functions
if (-not (Test-Path "functions\.env")) {
    Write-Host "📝 Criando functions/.env a partir do template..." -ForegroundColor Yellow
    Copy-Item "functions\.env.example" "functions\.env"
    Write-Host "⚠️  IMPORTANTE: Edite functions/.env com suas chaves Stripe!" -ForegroundColor Yellow
}
else {
    Write-Host "✅ functions/.env já existe" -ForegroundColor Green
}

Write-Host ""
Write-Host "📋 Próximos Passos:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Configure Stripe:" -ForegroundColor White
Write-Host "   - Leia: STRIPE_SETUP.md" -ForegroundColor Gray
Write-Host "   - Crie produtos no Stripe Dashboard" -ForegroundColor Gray
Write-Host "   - Edite frontend/.env e functions/.env" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Teste localmente:" -ForegroundColor White
Write-Host "   cd frontend" -ForegroundColor Gray
Write-Host "   npm run dev" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Deploy functions:" -ForegroundColor White
Write-Host "   cd functions" -ForegroundColor Gray
Write-Host "   firebase deploy --only functions" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Configure Capacitor (quando pronto):" -ForegroundColor White
Write-Host "   - Leia: CAPACITOR_PLAYSTORE_GUIDE.md" -ForegroundColor Gray
Write-Host "   - Crie ícones em resources/" -ForegroundColor Gray
Write-Host "   - Execute: npx cap init" -ForegroundColor Gray
Write-Host ""
Write-Host "✨ Setup concluído! Boa sorte! 🎉" -ForegroundColor Green
