# Mnemosyne - Guia de Deploy e Configuração

## ✅ O Que Foi Implementado

### Fase 1: Cloud Functions para Knowledge Graph
- ✅ Estrutura completa de Cloud Functions
- ✅ Integração com OpenAI GPT (pronta para API key)
- ✅ Extração automática de entidades e relações
- ✅ Fallback para regex quando API key não configurada
- ✅ Analytics tracking (views e conversões)
- ✅ Sistema de notificações

### Fase 2: Melhorias de UX
- ✅ Sistema de temas (dark/light) com transições suaves
- ✅ Busca em tempo real com debounce
- ✅ Filtros por data, tags e categorias
- ✅ Tag Manager com cores automáticas
- ✅ Integração completa no App.tsx

### Infraestrutura
- ✅ Firestore Security Rules
- ✅ Firebase Storage Rules
- ✅ Firebase Configuration (firebase.json)
- ✅ TypeScript configurado

## 🚀 Como Fazer Deploy

### 1. Instalar Dependências

#### Frontend
```bash
cd frontend
npm install
```

#### Cloud Functions
```bash
cd functions
npm install
```

### 2. Configurar Firebase

#### a) Atualizar credenciais do Firebase
Edite `frontend/src/firebase.ts` com suas credenciais:
```typescript
const firebaseConfig = {
    apiKey: "SUA_API_KEY",
    authDomain: "seu-projeto.firebaseapp.com",
    projectId: "seu-projeto",
    storageBucket: "seu-projeto.firebasestorage.app",
    messagingSenderId: "SEU_SENDER_ID",
    appId: "SEU_APP_ID"
};
```

#### b) Atualizar projeto no .firebaserc
Edite `.firebaserc`:
```json
{
  "projects": {
    "default": "seu-projeto-id"
  }
}
```

### 3. Configurar API Key do OpenAI (Opcional)

Quando você obtiver a API key:

```bash
cd functions
cp .env.example .env
```

Edite `functions/.env`:
```
OPENAI_API_KEY=sk-proj-sua-key-aqui
OPENAI_MODEL=gpt-4o-mini
RATE_LIMIT_PER_DAY=100
```

**IMPORTANTE**: Adicione `.env` ao `.gitignore` para não commitar a key!

### 4. Deploy

#### Deploy das Security Rules
```bash
firebase deploy --only firestore:rules,storage:rules
```

#### Deploy das Cloud Functions
```bash
firebase deploy --only functions
```

#### Build e Deploy do Frontend
```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

## 🧪 Testar Localmente

### Frontend
```bash
cd frontend
npm run dev
```
Acesse: http://localhost:5173

### Cloud Functions (Emulador)
```bash
cd functions
npm run serve
```

## 📝 Próximos Passos (Fases 3-5)

### Fase 3: Sistema de Anexos
**Arquivos a criar:**
- `frontend/src/components/AttachmentUploader.tsx`
- `frontend/src/hooks/useAudioRecorder.ts`
- `frontend/src/utils/storage.ts`

**Modificar:**
- `frontend/src/firebase.ts` - adicionar `getStorage`
- `frontend/src/components/MemoryEditorModal.tsx` - integrar uploader

### Fase 4: Compartilhamento entre Usuários
**Arquivos a criar:**
- `frontend/src/components/UserShareModal.tsx`
- `frontend/src/components/NotificationCenter.tsx`

**Modificar:**
- `frontend/src/App.tsx` - adicionar NotificationCenter no header
- `frontend/src/components/ShareModal.tsx` - adicionar aba de compartilhamento

### Fase 5: Analytics Dashboard
**Arquivos a criar:**
- `frontend/src/pages/AnalyticsDashboard.tsx`
- `frontend/src/utils/analytics.ts`

**Modificar:**
- `frontend/src/App.tsx` - adicionar rota `/analytics`
- `frontend/src/pages/ShareView.tsx` - chamar tracking

## 💰 Controle de Custos

### Monitorar Uso
1. Firebase Console: https://console.firebase.google.com
2. OpenAI Dashboard: https://platform.openai.com/usage

### Configurar Alertas
1. Google Cloud Console > Billing > Budgets & Alerts
2. Criar alerta para $5/mês
3. OpenAI: Configure "Monthly budget" em https://platform.openai.com/account/limits

### Limites Recomendados
- **Início**: $5-10/mês
- **Produção**: $20-50/mês
- **Rate limiting**: Já implementado nas functions

## 🔧 Troubleshooting

### Erro: "Cannot find module 'openai'"
```bash
cd functions
npm install
```

### Erro: "Firebase not configured"
Verifique se atualizou `frontend/src/firebase.ts` com suas credenciais.

### Functions não estão sendo chamadas
1. Verifique deploy: `firebase deploy --only functions`
2. Veja logs: `firebase functions:log`

### Tema não está mudando
Limpe o cache do navegador e recarregue.

## 📚 Recursos

- [Firebase Documentation](https://firebase.google.com/docs)
- [OpenAI API Docs](https://platform.openai.com/docs)
- [React Documentation](https://react.dev)

## 🎯 Features Prontas para Usar

### Busca
Digite na barra de busca no topo da página.

### Filtros
Clique no botão "Filtros" e selecione:
- Período (hoje, semana, mês, ano)
- Tags (multi-select)
- Categoria

### Temas
Clique no ícone de Sol/Lua no header.

### Compartilhamento
1. Clique em uma memória
2. Clique em "Compartilhar"
3. Escolha: Link Público, Copiar Texto, ou Exportar Arquivo

## 🔐 Segurança

- ✅ Firestore Rules implementadas
- ✅ Storage Rules com validação de tipo/tamanho
- ✅ API Keys em variáveis de ambiente
- ✅ Autenticação Firebase
- ⚠️ Lembre-se de não commitar `.env`!

## 📞 Suporte

Se encontrar problemas:
1. Verifique os logs: `firebase functions:log`
2. Inspecione o console do navegador (F12)
3. Verifique se todas as dependências foram instaladas
