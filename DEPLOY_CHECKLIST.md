# 🚀 Deploy Checklist - Mnemosyne

## ✅ Pré-Deploy (Concluído)

- [x] Build do frontend sem erros
- [x] PWA configurado (manifest + service worker)
- [x] Ícones gerados (192px, 512px)
- [x] Meta tags PWA adicionadas
- [x] .env.example documentados

## 📋 Próximos Passos para Deploy

### 1. Configurar Credenciais (15 min)

**Frontend:**
```bash
cd frontend
cp .env.example .env
# Editar .env com credenciais Firebase reais
```

**Functions:**
```bash
cd functions
cp .env.example .env
# Adicionar GEMINI_API_KEY ou OPENAI_API_KEY
```

### 2. Build Functions (2 min)

```bash
cd functions
npm run build
```

### 3. Deploy Firebase (5 min)

```bash
# Deploy tudo de uma vez
firebase deploy

# Ou deploy seletivo:
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
firebase deploy --only functions
firebase deploy --only hosting
```

### 4. Verificação Pós-Deploy (5 min)

- [ ] Acessar URL do hosting
- [ ] Testar login/registro
- [ ] Criar uma memória
- [ ] Verificar knowledge graph
- [ ] Testar PWA (instalar no mobile/desktop)
- [ ] Verificar logs: `firebase functions:log`

## 🎯 URLs Importantes

- **Hosting:** https://mnemosyne-one.web.app
- **Console:** https://console.firebase.google.com/project/mnemosyne-one
- **Analytics:** https://console.firebase.google.com/project/mnemosyne-one/analytics

## 🔧 Comandos Úteis

```bash
# Ver logs das functions
firebase functions:log

# Testar localmente
cd frontend && npm run dev
cd functions && npm run serve

# Rebuild
cd frontend && npm run build
cd functions && npm run build

# Deploy específico
firebase deploy --only hosting
firebase deploy --only functions:processMemoryKG
```

## ⚠️ Troubleshooting

### Build falha
- Verificar erros TypeScript
- Limpar cache: `rm -rf node_modules && npm install`

### Deploy falha
- Verificar se está logado: `firebase login`
- Verificar projeto: `firebase use mnemosyne-one`
- Verificar Blaze Plan ativo

### Functions não funcionam
- Verificar .env configurado
- Verificar logs: `firebase functions:log`
- Verificar Blaze Plan

---

**Status Atual:** ✅ Pronto para deploy após configurar credenciais
