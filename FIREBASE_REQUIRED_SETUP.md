# ⚠️ Configuração Necessária no Firebase Console

O deploy falhou porque alguns serviços precisam ser ativados manualmente no Firebase Console.

## 🔧 Passos Obrigatórios

### 1. Ativar Firestore Database

1. Acesse: https://console.firebase.google.com/project/mnemosyne-echoes/firestore
2. Clique em **"Create database"**
3. Escolha **"Start in production mode"**
4. Selecione a região: **europe-west1** (ou mais próxima de você)
5. Clique em **"Enable"**

### 2. Ativar Authentication

1. Acesse: https://console.firebase.google.com/project/mnemosyne-echoes/authentication
2. Clique em **"Get started"**
3. Ative **"Email/Password"**:
   - Clique na aba "Sign-in method"
   - Clique em "Email/Password"
   - Ative o toggle
   - Salve

### 3. Ativar Storage

1. Acesse: https://console.firebase.google.com/project/mnemosyne-echoes/storage
2. Clique em **"Get started"**
3. Escolha **"Start in production mode"**
4. Use a **mesma região** do Firestore
5. Clique em **"Done"**

### 4. Ativar Blaze Plan (Para Cloud Functions)

⚠️ **IMPORTANTE**: Cloud Functions requer o Blaze Plan (pay-as-you-go)

**NÃO SE PREOCUPE COM CUSTOS:**
- ✅ 2 milhões de invocações/mês **GRÁTIS**
- ✅ Você só paga se exceder o limite gratuito
- ✅ Para MVP: ~$0-0.10/mês

**Como ativar:**
1. Acesse: https://console.firebase.google.com/project/mnemosyne-echoes/usage
2. Clique em **"Modify plan"** ou **"Upgrade"**
3. Selecione **"Blaze Plan"**
4. **Configure um alerta de budget**:
   - Vá em: https://console.cloud.google.com/billing
   - Clique em "Budgets & alerts"
   - Crie alerta para **$5/mês**

### 5. Ativar APIs Necessárias

1. Acesse: https://console.cloud.google.com/apis/library?project=mnemosyne-echoes
2. Procure e ative:
   - ✅ **Cloud Functions API**
   - ✅ **Cloud Build API**
   - ✅ **Cloud Firestore API**

---

## ✅ Depois de Configurar

Execute novamente:

```bash
# 1. Deploy das regras de segurança
firebase deploy --only firestore:rules,storage:rules

# 2. Deploy das Cloud Functions
firebase deploy --only functions

# 3. Deploy do frontend (hosting)
firebase deploy --only hosting
```

Ou tudo de uma vez:

```bash
firebase deploy
```

---

## 🚀 Alternativa: Testar Localmente Primeiro

Se quiser testar antes de fazer deploy:

```bash
# Terminal 1: Frontend
cd frontend
npm run dev

# Terminal 2: Emuladores Firebase (opcional)
firebase emulators:start
```

Acesse: http://localhost:5173

---

## 📊 Verificar Status

Após ativar os serviços, verifique:

```bash
firebase projects:list
```

---

## 💡 Dica

Você pode usar o app **SEM Cloud Functions** inicialmente:
- ✅ Tema dark/light funciona
- ✅ Busca e filtros funcionam
- ✅ Compartilhamento funciona
- ⚠️ Knowledge Graph usará fallback regex (sem LLM)

Para isso, apenas faça:
```bash
firebase deploy --only hosting
```

E adicione as Functions depois quando ativar o Blaze Plan.
