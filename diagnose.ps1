# 🔍 Script de Diagnóstico Completo - Mnemosyne

Write-Host "`n🔍 DIAGNÓSTICO COMPLETO DO MNEMOSYNE`n" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray

# Função auxiliar para verificar arquivo
function Test-FileExists {
    param($Path, $Name)
    if (Test-Path $Path) {
        Write-Host "✅ $Name encontrado" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "❌ $Name NÃO encontrado" -ForegroundColor Red
        return $false
    }
}

# Função para verificar conteúdo de .env
function Test-EnvVariable {
    param($FilePath, $VarName, $InvalidValues = @())
    
    if (-not (Test-Path $FilePath)) {
        Write-Host "  ❌ Arquivo $FilePath não existe" -ForegroundColor Red
        return $false
    }
    
    $content = Get-Content $FilePath -Raw
    $line = $content -split "`n" | Where-Object { $_ -match "^$VarName=" } | Select-Object -First 1
    
    if (-not $line) {
        Write-Host "  ❌ $VarName não encontrada" -ForegroundColor Red
        return $false
    }
    
    $value = ($line -split "=", 2)[1].Trim()
    
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Host "  ❌ $VarName está vazia" -ForegroundColor Red
        return $false
    }
    
    foreach ($invalid in $InvalidValues) {
        if ($value -eq $invalid) {
            Write-Host "  ⚠️  $VarName não configurada (valor padrão)" -ForegroundColor Yellow
            return $false
        }
    }
    
    $maskedValue = $value.Substring(0, [Math]::Min(10, $value.Length)) + "..."
    Write-Host "  ✅ $VarName configurada ($maskedValue)" -ForegroundColor Green
    return $true
}

# ============================================
# 1. VERIFICAR ESTRUTURA DE ARQUIVOS
# ============================================
Write-Host "`n📁 1. ESTRUTURA DE ARQUIVOS" -ForegroundColor Yellow
Write-Host "-" * 60 -ForegroundColor Gray

$requiredFiles = @{
    "frontend\.env"   = "Frontend .env"
    "functions\.env"  = "Functions .env"
    ".firebaserc"     = "Firebase config"
    "firebase.json"   = "Firebase project config"
    "firestore.rules" = "Firestore rules"
    "storage.rules"   = "Storage rules"
}

$filesOk = $true
foreach ($file in $requiredFiles.GetEnumerator()) {
    if (-not (Test-FileExists $file.Key $file.Value)) {
        $filesOk = $false
    }
}

# ============================================
# 2. VERIFICAR CONFIGURAÇÃO DO STRIPE
# ============================================
Write-Host "`n💳 2. CONFIGURAÇÃO STRIPE" -ForegroundColor Yellow
Write-Host "-" * 60 -ForegroundColor Gray

$stripeOk = $true

if (Test-Path "functions\.env") {
    $stripeOk = $stripeOk -and (Test-EnvVariable "functions\.env" "STRIPE_SECRET_KEY" @("sk_test_your_key_here", "your_key_here"))
    $stripeOk = $stripeOk -and (Test-EnvVariable "functions\.env" "STRIPE_WEBHOOK_SECRET" @("whsec_your_secret_here"))
}
else {
    Write-Host "  ❌ Arquivo functions\.env não existe!" -ForegroundColor Red
    $stripeOk = $false
}

# ============================================
# 3. VERIFICAR CONFIGURAÇÃO DO FIREBASE
# ============================================
Write-Host "`n🔥 3. CONFIGURAÇÃO FIREBASE" -ForegroundColor Yellow
Write-Host "-" * 60 -ForegroundColor Gray

$firebaseOk = $true

if (Test-Path "frontend\.env") {
    $firebaseOk = $firebaseOk -and (Test-EnvVariable "frontend\.env" "VITE_FIREBASE_API_KEY" @("your-api-key"))
    $firebaseOk = $firebaseOk -and (Test-EnvVariable "frontend\.env" "VITE_FIREBASE_PROJECT_ID" @("your-project-id"))
    $firebaseOk = $firebaseOk -and (Test-EnvVariable "frontend\.env" "VITE_FIREBASE_APP_ID" @("your-app-id"))
}
else {
    Write-Host "  ❌ Arquivo frontend\.env não existe!" -ForegroundColor Red
    $firebaseOk = $false
}

# ============================================
# 4. VERIFICAR DEPENDÊNCIAS
# ============================================
Write-Host "`n📦 4. DEPENDÊNCIAS" -ForegroundColor Yellow
Write-Host "-" * 60 -ForegroundColor Gray

# Verificar node_modules
if (Test-Path "frontend\node_modules") {
    Write-Host "  ✅ Frontend node_modules instalado" -ForegroundColor Green
}
else {
    Write-Host "  ❌ Frontend node_modules NÃO instalado" -ForegroundColor Red
    Write-Host "     Execute: cd frontend && npm install" -ForegroundColor Gray
}

if (Test-Path "functions\node_modules") {
    Write-Host "  ✅ Functions node_modules instalado" -ForegroundColor Green
}
else {
    Write-Host "  ❌ Functions node_modules NÃO instalado" -ForegroundColor Red
    Write-Host "     Execute: cd functions && npm install" -ForegroundColor Gray
}

# ============================================
# 5. VERIFICAR FIREBASE CLI
# ============================================
Write-Host "`n🔧 5. FERRAMENTAS" -ForegroundColor Yellow
Write-Host "-" * 60 -ForegroundColor Gray

try {
    $firebaseVersion = firebase --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ Firebase CLI instalado ($firebaseVersion)" -ForegroundColor Green
    }
    else {
        throw
    }
}
catch {
    Write-Host "  ❌ Firebase CLI NÃO instalado" -ForegroundColor Red
    Write-Host "     Execute: npm install -g firebase-tools" -ForegroundColor Gray
}

try {
    $nodeVersion = node --version 2>&1
    Write-Host "  ✅ Node.js instalado ($nodeVersion)" -ForegroundColor Green
}
catch {
    Write-Host "  ❌ Node.js NÃO instalado" -ForegroundColor Red
}

try {
    $npmVersion = npm --version 2>&1
    Write-Host "  ✅ npm instalado ($npmVersion)" -ForegroundColor Green
}
catch {
    Write-Host "  ❌ npm NÃO instalado" -ForegroundColor Red
}

# ============================================
# 6. VERIFICAR FIREBASE PROJECT
# ============================================
Write-Host "`n🎯 6. PROJETO FIREBASE" -ForegroundColor Yellow
Write-Host "-" * 60 -ForegroundColor Gray

if (Test-Path ".firebaserc") {
    $firebaserc = Get-Content ".firebaserc" -Raw | ConvertFrom-Json
    $projectId = $firebaserc.projects.default
    
    if ($projectId -and $projectId -ne "your-project-id") {
        Write-Host "  ✅ Projeto configurado: $projectId" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠️  Projeto não configurado em .firebaserc" -ForegroundColor Yellow
    }
}
else {
    Write-Host "  ❌ Arquivo .firebaserc não encontrado" -ForegroundColor Red
}

# ============================================
# 7. RESUMO E RECOMENDAÇÕES
# ============================================
Write-Host "`n📊 RESUMO" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray

$issues = @()
$warnings = @()

if (-not $filesOk) {
    $issues += "Arquivos de configuração faltando"
}

if (-not $stripeOk) {
    $issues += "Stripe não configurado corretamente"
}

if (-not $firebaseOk) {
    $issues += "Firebase não configurado corretamente"
}

if ($issues.Count -eq 0) {
    Write-Host "`n✅ TUDO OK! Sistema pronto para uso." -ForegroundColor Green
}
else {
    Write-Host "`n⚠️  PROBLEMAS ENCONTRADOS:" -ForegroundColor Yellow
    foreach ($issue in $issues) {
        Write-Host "  • $issue" -ForegroundColor Red
    }
}

# ============================================
# 8. PRÓXIMOS PASSOS
# ============================================
Write-Host "`n🚀 PRÓXIMOS PASSOS" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray

if (-not $stripeOk) {
    Write-Host "`n1. Configurar Stripe:" -ForegroundColor Yellow
    Write-Host "   • Acesse: https://dashboard.stripe.com/test/apikeys" -ForegroundColor Gray
    Write-Host "   • Copie a Secret Key (sk_test_...)" -ForegroundColor Gray
    Write-Host "   • Edite: functions\.env" -ForegroundColor Gray
    Write-Host "   • Adicione: STRIPE_SECRET_KEY=sk_test_sua_chave" -ForegroundColor Gray
}

if (-not $firebaseOk) {
    Write-Host "`n2. Configurar Firebase:" -ForegroundColor Yellow
    Write-Host "   • Acesse: https://console.firebase.google.com" -ForegroundColor Gray
    Write-Host "   • Vá em: Project Settings > Your apps > Config" -ForegroundColor Gray
    Write-Host "   • Copie as credenciais" -ForegroundColor Gray
    Write-Host "   • Edite: frontend\.env" -ForegroundColor Gray
}

if (-not (Test-Path "frontend\node_modules") -or -not (Test-Path "functions\node_modules")) {
    Write-Host "`n3. Instalar dependências:" -ForegroundColor Yellow
    Write-Host "   cd frontend && npm install" -ForegroundColor Gray
    Write-Host "   cd ..\functions && npm install" -ForegroundColor Gray
}

Write-Host "`n4. Testar localmente:" -ForegroundColor Yellow
Write-Host "   cd frontend && npm run dev" -ForegroundColor Gray

Write-Host "`n5. Deploy:" -ForegroundColor Yellow
Write-Host "   firebase deploy --only functions" -ForegroundColor Gray
Write-Host "   firebase deploy --only hosting" -ForegroundColor Gray

Write-Host "`n" -ForegroundColor Gray
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host "Diagnóstico completo! ✨" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Gray
Write-Host ""
