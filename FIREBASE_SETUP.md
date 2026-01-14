# 🔥 Guia de Configuração do Firebase

## Passo 1: Obter Credenciais do Firebase

1. Acesse o [Firebase Console](https://console.firebase.google.com)
2. Selecione seu projeto
3. Clique no ícone de engrenagem ⚙️ > **Project Settings**
4. Role até **Your apps** > **SDK setup and configuration**
5. Selecione **Config** (não npm)
6. Copie os valores do objeto `firebaseConfig`

## Passo 2: Configurar Frontend

### Criar arquivo .env

```bash
cd frontend
cp .env.example .env
```

### Editar frontend/.env

Substitua os valores com suas credenciais:

```env
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seu-projeto
VITE_FIREBASE_STORAGE_BUCKET=seu-projeto.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

## Passo 3: Configurar Cloud Functions

### Criar arquivo .env

```bash
cd functions
cp .env.example .env
```

### Editar functions/.env

```env
# OpenAI API Key (opcional - funciona sem ela usando fallback)
OPENAI_API_KEY=sk-proj-sua-key-aqui
OPENAI_MODEL=gpt-4o-mini
RATE_LIMIT_PER_DAY=100
```

## Passo 4: Atualizar .firebaserc

Edite o arquivo `.firebaserc` na raiz do projeto:

```json
{
  "projects": {
    "default": "seu-projeto-id"
  }
}
```

Substitua `seu-projeto-id` pelo ID do seu projeto Firebase.

## Passo 5: Ativar Serviços no Firebase

### Firestore Database
1. Firebase Console > **Firestore Database**
2. Clique em **Create database**
3. Escolha **Start in production mode**
4. Selecione a região (ex: `europe-west1`)

### Authentication
1. Firebase Console > **Authentication**
2. Clique em **Get started**
3. Ative os métodos desejados:
   - **Email/Password** (recomendado)
   - **Google** (opcional)

### Storage
1. Firebase Console > **Storage**
2. Clique em **Get started**
3. Escolha **Start in production mode**
4. Selecione a mesma região do Firestore

### Cloud Functions
1. Firebase Console > **Functions**
2. Clique em **Get started**
3. Siga as instruções para ativar o Blaze Plan (pay-as-you-go)
   - **Não se preocupe**: O plano gratuito cobre 2M de invocações/mês
   - Configure um alerta de budget para $5-10/mês

## Passo 6: Deploy

### Deploy das Security Rules

```bash
firebase deploy --only firestore:rules,storage:rules
```

### Deploy das Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

### Deploy do Frontend (Hosting)

```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

## Verificação

### Testar Frontend Localmente

```bash
cd frontend
npm run dev
```

Acesse: http://localhost:5173

### Testar Functions Localmente

```bash
firebase emulators:start
```

## Troubleshooting

### Erro: "Firebase config is invalid"
- Verifique se o arquivo `.env` existe em `frontend/`
- Confirme que todas as variáveis começam com `VITE_`
- Reinicie o servidor de desenvolvimento

### Erro: "Permission denied" no Firestore
- Faça deploy das rules: `firebase deploy --only firestore:rules`
- Verifique se o usuário está autenticado

### Functions não aparecem no console
- Verifique se o Blaze Plan está ativo
- Confirme o deploy: `firebase deploy --only functions`
- Veja os logs: `firebase functions:log`

## Segurança

✅ **Arquivos .env estão no .gitignore** - Não serão commitados
✅ **Variáveis VITE_* são seguras** - Podem ser expostas no frontend
⚠️ **NUNCA commite** o arquivo `functions/.env` com a API key do OpenAI

## Próximos Passos

Após configurar:
1. ✅ Teste criar uma memória
2. ✅ Verifique o Knowledge Graph no Firestore
3. ✅ Teste busca e filtros
4. ✅ Teste tema dark/light
5. 🔑 Adicione API key do OpenAI quando quiser ativar o LLM

## Recursos

- [Firebase Console](https://console.firebase.google.com)
- [Documentação Firebase](https://firebase.google.com/docs)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
