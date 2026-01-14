# Script para configurar variáveis de ambiente do Stripe no Firebase
# Execute este script e cole suas chaves quando solicitado

Write-Host "=== Configuração do Stripe no Firebase ===" -ForegroundColor Cyan
Write-Host ""

# Verificar se está no diretório correto
if (!(Test-Path "firebase.json")) {
    Write-Host "ERRO: Execute este script no diretório raiz do projeto (w:\SaaS)" -ForegroundColor Red
    exit 1
}

# Função para ler input de forma segura
function Read-SecureInput {
    param([string]$Prompt)
    Write-Host $Prompt -NoNewline -ForegroundColor Yellow
    $value = Read-Host
    return $value.Trim()
}

Write-Host "Por favor, tenha em mãos:" -ForegroundColor Green
Write-Host "  1. Stripe Secret Key (sk_test_...)" -ForegroundColor White
Write-Host "  2. Stripe Webhook Secret (whsec_...)" -ForegroundColor White
Write-Host "  3. Stripe Price IDs (price_...)" -ForegroundColor White
Write-Host ""

# Ler as chaves
$secretKey = Read-SecureInput "Stripe Secret Key (sk_test_...): "
$webhookSecret = Read-SecureInput "Stripe Webhook Secret (whsec_...): "
$priceProMonthly = Read-SecureInput "Price ID - Pro Monthly (price_...): "
$priceProYearly = Read-SecureInput "Price ID - Pro Yearly (price_...): "
$priceBusinessMonthly = Read-SecureInput "Price ID - Business Monthly (price_...): "
$priceBusinessYearly = Read-SecureInput "Price ID - Business Yearly (price_...): "

Write-Host ""
Write-Host "Configurando Firebase Functions..." -ForegroundColor Cyan

# Configurar as variáveis
try {
    firebase functions:config:set `
        stripe.secret_key="$secretKey" `
        stripe.webhook_secret="$webhookSecret" `
        stripe.price_pro_monthly="$priceProMonthly" `
        stripe.price_pro_yearly="$priceProYearly" `
        stripe.price_business_monthly="$priceBusinessMonthly" `
        stripe.price_business_yearly="$priceBusinessYearly"
    
    Write-Host ""
    Write-Host "✅ Configuração concluída com sucesso!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Próximo passo: Redeploy das functions" -ForegroundColor Yellow
    Write-Host "Execute: firebase deploy --only functions" -ForegroundColor White
    Write-Host ""
    
}
catch {
    Write-Host "❌ Erro ao configurar: $_" -ForegroundColor Red
    exit 1
}
