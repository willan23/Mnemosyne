# 🔧 Guia de Configuração - Mnemosyne

## 📋 Pré-requisitos

- Node.js 20+
- Conta Firebase (Blaze Plan para Functions)
- API Key do Gemini ou OpenAI (opcional, mas recomendado)

---

## 🚀 Setup Rápido (5 minutos)

### 1. Clone e Instale Dependências

```bash
# Frontend
cd frontend
npm install

# Functions
cd ../functions
npm install
```

### 2. Configure Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com)
2. Crie um novo projeto ou use existente
3. Ative os serviços:
   - ✅ Authentication (Email/Password + Anonymous)
   - ✅ Firestore Database
   - ✅ Storage
   - ✅ Functions (Blaze Plan)
   - ✅ Hosting

### 3. Configure Variáveis de Ambiente

#### Frontend (.env)

Copie o arquivo `.env.example` para `.env`:

```bash
cd frontend
cp .env.example .env
```

Edite `frontend/.env` com suas credenciais Firebase:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=mnemosyne-one.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=mnemosyne-one
VITE_FIREBASE_STORAGE_BUCKET=mnemosyne-one.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

**Como obter:**
1. Firebase Console → ⚙️ Project Settings
2. Your apps → Web app → Config
3. Copie os valores

#### Functions (.env)

Copie o arquivo `.env.example` para `.env`:

```bash
cd functions
cp .env.example .env
```

Edite `functions/.env`:

```env
# LLM Configuration (escolha um)

# Opção 1: Google Gemini (RECOMENDADO - Gratuito)
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash

# Opção 2: OpenAI (Pago)
OPENAI_API_KEY=sk-proj-...

# Nota: Se nenhuma API key for fornecida, o sistema usa fallback regex (básico)
```

**Como obter API Keys:**

- **Gemini (Gratuito):** https://aistudio.google.com/app/apikey
- **OpenAI (Pago):** https://platform.openai.com/api-keys

### 4. Configure Firebase CLI

```bash
# Login
firebase login

# Selecione o projeto
firebase use mnemosyne-one
```

Edite `.firebaserc` na raiz:

```json
{
  "projects": {
    "default": "mnemosyne-one"
  }
}
```

---

## 🏗️ Build e Deploy

### Desenvolvimento Local

```bash
# Frontend (http://localhost:5173)
cd frontend
npm run dev

# Functions (emulator)
cd functions
npm run serve
```

### Deploy para Produção

```bash
# 1. Build do frontend
cd frontend
npm run build

# 2. Deploy completo
cd ..
firebase deploy

# Ou deploy seletivo:
firebase deploy --only firestore:rules  # Apenas regras Firestore
firebase deploy --only storage:rules    # Apenas regras Storage
firebase deploy --only functions        # Apenas Cloud Functions
firebase deploy --only hosting          # Apenas Frontend
```

---

## 🔐 Segurança

### Firestore Rules

As regras já estão em `firestore.rules`. Deploy com:

```bash
firebase deploy --only firestore:rules
```

### Storage Rules

As regras já estão em `storage.rules`. Deploy com:

```bash
firebase deploy --only storage:rules
```

---

## 🧪 Testes

### Testar PWA

1. Build de produção: `npm run build`
2. Preview: `npm run preview`
3. Abra DevTools → Application → Service Workers
4. Verifique se o SW está registrado

### Testar Functions Localmente

```bash
cd functions
npm run serve
```

Acesse: http://localhost:5001/mnemosyne-one/us-central1/processMemoryKG

---

## 📊 Monitoramento

### Logs das Functions

```bash
firebase functions:log
```

### Analytics

Acesse: https://console.firebase.google.com/project/mnemosyne-one/analytics

---

## 🆘 Troubleshooting

### "Firebase config is invalid"
- Verifique se editou `frontend/.env` corretamente
- Reinicie o dev server: `npm run dev`

### "Permission denied" no Firestore
- Deploy das rules: `firebase deploy --only firestore:rules`

### Functions não aparecem
- Verifique se está no Blaze Plan
- Logs: `firebase functions:log`

### PWA não instala
- Verifique se está em HTTPS (produção)
- DevTools → Application → Manifest
- Verifique erros no console

---

## 💰 Custos Estimados

### Firebase (Blaze Plan)

- **Firestore:** ~$0.01/mês (uso pessoal)
- **Functions:** Gratuito até 2M invocações/mês
- **Hosting:** Gratuito até 10GB/mês
- **Storage:** Gratuito até 5GB

### LLM APIs

- **Gemini:** Gratuito (15 req/min, 1500/dia)
- **OpenAI:** ~$0.15/1M tokens

**Total MVP:** ~$0.01-0.10/mês

---

## 📚 Próximos Passos

1. ✅ Configure as variáveis de ambiente
2. ✅ Teste localmente
3. ✅ Deploy para produção
4. ✅ Configure domínio customizado (opcional)
5. ✅ Ative Analytics
6. ✅ Configure Stripe (monetização)

---

**Pronto para começar!** 🚀

Se tiver dúvidas, consulte a [documentação completa](./MNEMOSYNE_COMPLETE_DOCUMENTATION.md).
