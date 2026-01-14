# Configuração de Deploy Automático

Este guia explica como configurar o deploy automático para Firebase usando GitHub Actions.

## 📋 Pré-requisitos

1. Repositório Git inicializado
2. Repositório no GitHub
3. Conta Firebase com projeto configurado

## 🚀 Passos para Configuração

### 1. Criar Service Account do Firebase

```bash
# No terminal, execute:
firebase login
firebase projects:list

# Gerar a chave de service account
# Vá para: https://console.firebase.google.com/
# Project Settings > Service Accounts > Generate New Private Key
```

Isso vai baixar um arquivo JSON. **Guarde-o com segurança!**

### 2. Adicionar Secrets no GitHub

Vá para o seu repositório no GitHub:
- Settings → Secrets and variables → Actions → New repository secret

Adicione os seguintes secrets:

#### `FIREBASE_SERVICE_ACCOUNT`
Cole o **conteúdo completo** do arquivo JSON baixado no passo 1.

#### `VITE_STRIPE_PRICE_PRO_MONTHLY` (opcional)
O Price ID do Stripe para o plano Pro mensal.

#### `VITE_STRIPE_PRICE_BUSINESS_MONTHLY` (opcional)
O Price ID do Stripe para o plano Business mensal.

### 3. Verificar o Workflow

O arquivo `.github/workflows/deploy.yml` já foi criado. Ele fará deploy automático quando você:
- Fizer push para a branch `main`
- Executar manualmente via GitHub Actions

### 4. Primeiro Deploy

```bash
# Adicione os arquivos ao Git
git add .
git commit -m "feat: configuração de deploy automático"
git push origin main
```

### 5. Acompanhar o Deploy

1. Vá para o seu repositório no GitHub
2. Clique na aba **Actions**
3. Você verá o workflow "Deploy to Firebase" em execução
4. Clique nele para ver os logs em tempo real

## ✅ Verificação

Após o primeiro deploy bem-sucedido:
- ✅ Cada push para `main` fará deploy automático
- ✅ Você pode ver o status na aba Actions
- ✅ Notificações de sucesso/falha via email do GitHub

## 🔧 Troubleshooting

### Erro: "Firebase service account not found"
- Verifique se o secret `FIREBASE_SERVICE_ACCOUNT` foi adicionado corretamente
- Certifique-se de que copiou o JSON completo

### Erro: "Build failed"
- Verifique os logs na aba Actions
- Certifique-se de que o build funciona localmente: `npm run build`

### Deploy manual
Se precisar fazer deploy manualmente:
```bash
npm run build
firebase deploy --only hosting
```

## 📝 Notas

- O workflow também pode ser executado manualmente via GitHub Actions
- Você pode adicionar mais steps, como testes automatizados
- Para deploy de regras do Firestore, adicione `--only firestore:rules` ao comando de deploy
