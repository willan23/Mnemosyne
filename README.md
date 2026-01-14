# 🚀 Mnemosyne - Quick Start

## Configuração Rápida (5 minutos)

### 1. Execute o script de setup

```powershell
.\setup.ps1
```

Este script irá:
- ✅ Criar arquivos `.env` a partir dos templates
- ✅ Instalar todas as dependências
- ✅ Mostrar próximos passos

### 2. Configure suas credenciais

#### Obter credenciais Firebase:
1. Acesse [Firebase Console](https://console.firebase.google.com)
2. Selecione seu projeto
3. ⚙️ Project Settings > Your apps > Config
4. Copie os valores

#### Editar `frontend/.env`:
```env
VITE_FIREBASE_API_KEY=sua-api-key
VITE_FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seu-projeto-id
VITE_FIREBASE_STORAGE_BUCKET=seu-projeto.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

#### Editar `.firebaserc`:
```json
{
  "projects": {
    "default": "seu-projeto-id"
  }
}
```

### 3. Ativar serviços no Firebase Console

- ✅ **Firestore Database** (production mode)
- ✅ **Authentication** (Email/Password)
- ✅ **Storage** (production mode)
- ✅ **Functions** (Blaze Plan - gratuito até 2M invocações/mês)

### 4. Deploy

```bash
# Login
firebase login

# Deploy regras
firebase deploy --only firestore:rules,storage:rules

# Deploy functions
firebase deploy --only functions

# Deploy frontend (opcional)
firebase deploy --only hosting
```

### 5. Testar

```bash
cd frontend
npm run dev
```

Acesse: http://localhost:5173

## ✨ Features Disponíveis

- 🎨 **Tema Dark/Light** - Clique no ícone Sol/Lua
- 🔍 **Busca em tempo real** - Digite na barra de busca
- 🏷️ **Filtros** - Data, Tags, Categorias
- 🧠 **Knowledge Graph** - Automático (com ou sem LLM)
- 🔗 **Compartilhamento** - Links públicos
- 💳 **Monetização Stripe** - Sistema completo de assinaturas
- 📱 **Mobile Ready** - PWA + Capacitor para Android

## 💳 Monetização com Stripe

O Mnemosyne inclui sistema completo de monetização com 3 tiers:

- **Free**: 50 memórias/mês, 1GB storage
- **Pro** (€9.99/mês): Ilimitado, 50GB, features avançadas
- **Business** (€29.99/mês): 500GB, API, equipes

### Setup Rápido Stripe

```powershell
# 1. Execute o script de setup
.\quick-setup.ps1

# 2. Siga o guia completo
# Leia: STRIPE_SETUP.md
```

**Documentação**: [STRIPE_SETUP.md](STRIPE_SETUP.md)

## 📱 Publicação na Play Store

Transforme o Mnemosyne em app Android nativo!

### Setup Capacitor

```bash
# 1. Instalar dependências (já incluído em quick-setup.ps1)
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Inicializar
npx cap init

# 3. Adicionar Android
npx cap add android
```

**Documentação Completa**: [CAPACITOR_PLAYSTORE_GUIDE.md](CAPACITOR_PLAYSTORE_GUIDE.md)

## 📖 Documentação Completa

- **STRIPE_SETUP.md** - Configuração Stripe passo-a-passo
- **CAPACITOR_PLAYSTORE_GUIDE.md** - Build Android e publicação
- **FIREBASE_SETUP.md** - Guia detalhado de configuração Firebase
- **DEPLOY_GUIDE.md** - Instruções de deploy
- **MONETIZATION_STRATEGY.md** - Estratégia de monetização
- **walkthrough.md** - Detalhes técnicos

## 🆘 Problemas?

### "Firebase config is invalid"
- Verifique se editou `frontend/.env`
- Reinicie o dev server

### "Permission denied"
- Deploy das rules: `firebase deploy --only firestore:rules`

### Functions não aparecem
- Ative o Blaze Plan no Firebase Console
- Veja logs: `firebase functions:log`

## 💰 Custos

- **MVP**: ~$0.01/mês
- **1000 memórias/mês**: ~$0.10/mês
- **Plano gratuito Firebase**: Suficiente para começar!

## 🤖 LLM Configuration

Mnemosyne suporta dois provedores de IA para extração inteligente de entidades:

### Google Gemini (Recomendado - Gratuito)
- **Custo**: Gratuito (15 req/min, 1500/dia)
- **Modelo**: gemini-1.5-flash
- **Qualidade**: Excelente para português

**Setup**:
1. Obtenha key em: https://aistudio.google.com/app/apikey
2. Edite `functions/.env`:
   ```env
   GEMINI_API_KEY=sua-key-aqui
   GEMINI_MODEL=gemini-1.5-flash
   ```
3. Redeploy: `firebase deploy --only functions`

### OpenAI (Alternativa - Pago)
- **Custo**: ~$0.15/1M tokens
- **Modelo**: gpt-4o-mini
- **Qualidade**: Excelente

**Setup**:
1. Obtenha key em: https://platform.openai.com/api-keys
2. Edite `functions/.env`:
   ```env
   OPENAI_API_KEY=sk-proj-sua-key
   ```
3. Redeploy: `firebase deploy --only functions`

### Fallback Automático
**Funciona SEM API key** usando extração regex (básica)!

**Prioridade**: Gemini → OpenAI → Regex

---

**Pronto para começar!** 🚀
