# Script para configurar CORS no Firebase Storage
# Execute este script para corrigir o erro de CORS ao fazer upload de imagens

Write-Host "🔧 Configurando CORS do Firebase Storage..." -ForegroundColor Cyan

# Verificar se gcloud está instalado
$gcloudInstalled = Get-Command gcloud -ErrorAction SilentlyContinue

if (-not $gcloudInstalled) {
    Write-Host "❌ Google Cloud SDK não está instalado!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Por favor, instale o Google Cloud SDK:" -ForegroundColor Yellow
    Write-Host "1. Acesse: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    Write-Host "2. Baixe e instale o SDK para Windows" -ForegroundColor Yellow
    Write-Host "3. Execute 'gcloud init' para configurar" -ForegroundColor Yellow
    Write-Host "4. Execute este script novamente" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Google Cloud SDK encontrado" -ForegroundColor Green

# Obter o projeto Firebase do .firebaserc
$firebaserc = Get-Content .firebaserc | ConvertFrom-Json
$projectId = $firebaserc.projects.default

if (-not $projectId) {
    Write-Host "❌ Não foi possível encontrar o ID do projeto no .firebaserc" -ForegroundColor Red
    exit 1
}

Write-Host "📦 Projeto: $projectId" -ForegroundColor Cyan

# Aplicar configuração CORS
Write-Host "🚀 Aplicando configuração CORS..." -ForegroundColor Cyan

try {
    $bucket = "$projectId.appspot.com"
    
    # Aplicar CORS
    gsutil cors set cors.json gs://$bucket
    
    Write-Host ""
    Write-Host "✅ CORS configurado com sucesso!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Agora você pode fazer upload de imagens sem erros de CORS." -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  Nota: Pode levar alguns minutos para as mudanças propagarem." -ForegroundColor Yellow
    
} catch {
    Write-Host ""
    Write-Host "❌ Erro ao aplicar CORS:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Tente executar manualmente:" -ForegroundColor Yellow
    Write-Host "gsutil cors set cors.json gs://$bucket" -ForegroundColor Cyan
}
