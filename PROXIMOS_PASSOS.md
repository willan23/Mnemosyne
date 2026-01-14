# 🚀 Próximos Passos - Mnemosyne

## ✅ O que já está pronto

### GitHub Actions & CI/CD
- ✅ Workflow completo de deploy automático
- ✅ Deploy de Functions, Hosting, e Rules
- ✅ Guia de configuração de secrets: `GITHUB_SECRETS.md`

### Mobile (Capacitor)
- ✅ Plataforma Android adicionada
- ✅ Ícone e splash screen gerados
- ✅ Assets do Capacitor configurados
- ✅ Frontend buildado e sincronizado

### Documentação
- ✅ `KEYSTORE_GUIDE.md` - Como gerar keystore
- ✅ `PLAY_STORE_LISTING.md` - Textos para Play Store
- ✅ `GITHUB_SECRETS.md` - Configuração de secrets
- ✅ `.gitignore` atualizado para proteger keystore

---

## 🎯 O que você precisa fazer agora

### 1. Finalizar Instalação Stripe (em andamento)

Você está instalando a extensão Stripe no Firebase. Após completar:

1. **Copie os Price IDs** dos produtos criados no Stripe
2. **Configure as variáveis** no arquivo `frontend/.env`:
   ```env
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
   VITE_STRIPE_PRICE_PRO_MONTHLY=price_...
   VITE_STRIPE_PRICE_PRO_YEARLY=price_...
   VITE_STRIPE_PRICE_BUSINESS_MONTHLY=price_...
   VITE_STRIPE_PRICE_BUSINESS_YEARLY=price_...
   ```

3. **Teste o checkout**:
   ```bash
   cd frontend
   npm run dev
   ```
   - Acesse http://localhost:5173/pricing
   - Teste com cartão: `4242 4242 4242 4242`

---

### 2. Configurar GitHub Secrets

Siga o guia em `GITHUB_SECRETS.md` para adicionar todos os secrets necessários:

**Essenciais**:
- `FIREBASE_SERVICE_ACCOUNT`
- `FIREBASE_TOKEN`
- `FIREBASE_PROJECT_ID`

**Firebase Config** (9 secrets):
- `VITE_FIREBASE_*` (API key, Auth Domain, etc.)

**Stripe** (5 secrets):
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_STRIPE_PRICE_*` (4 price IDs)

**Como obter FIREBASE_TOKEN**:
```bash
firebase login:ci
```

---

### 3. Gerar Keystore para Android

**IMPORTANTE**: Leia `KEYSTORE_GUIDE.md` completamente antes de começar!

```powershell
keytool -genkey -v -keystore w:\SaaS\mnemosyne-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias mnemosyne
```

**GUARDE A SENHA COM SEGURANÇA!** Você vai precisar dela para sempre.

Depois, crie `android/keystore.properties`:
```properties
storePassword=SUA_SENHA
keyPassword=SUA_SENHA
keyAlias=mnemosyne
storeFile=../mnemosyne-release-key.jks
```

---

### 4. Configurar build.gradle

Abra `android/app/build.gradle` e adicione a configuração de assinatura (instruções detalhadas em `KEYSTORE_GUIDE.md`).

---

### 5. Gerar AAB (Android App Bundle)

1. Abra Android Studio:
   ```bash
   cd frontend
   npx cap open android
   ```

2. No Android Studio:
   - **Build** → **Generate Signed Bundle / APK**
   - Selecione **Android App Bundle**
   - Escolha sua keystore
   - Build type: **release**

3. O AAB será gerado em: `android/app/release/app-release.aab`

---

### 6. Criar Assets para Play Store

Você precisa de screenshots do app. Opções:

**Opção A**: Usar emulador Android Studio
1. Abra o emulador
2. Tire screenshots das telas principais
3. Redimensione para 1080x1920

**Opção B**: Usar dispositivo real
1. Instale o APK no seu celular
2. Tire screenshots
3. Transfira para o PC

**Telas necessárias** (veja `PLAY_STORE_LISTING.md`):
- Dashboard
- Knowledge Graph
- Editor de memórias
- Pricing
- Analytics

---

### 7. Publicar na Play Store

1. Acesse [Google Play Console](https://play.google.com/console)
2. Crie novo app
3. Preencha informações (use textos de `PLAY_STORE_LISTING.md`)
4. Upload screenshots e assets
5. Upload do AAB
6. Submeta para revisão

**Tempo de aprovação**: 1-7 dias

---

## 📋 Checklist Rápido

- [ ] Stripe extension instalada e testada
- [ ] GitHub secrets configurados (15 secrets)
- [ ] Keystore gerada e guardada com segurança
- [ ] build.gradle configurado
- [ ] AAB gerado no Android Studio
- [ ] Screenshots tirados (mínimo 2)
- [ ] App criado na Play Console
- [ ] AAB enviado para revisão

---

## 🆘 Precisa de Ajuda?

### Stripe não funciona
- Verifique logs: `COMO_VER_LOGS_STRIPE.md`
- Confirme Price IDs corretos
- Teste webhook no Stripe Dashboard

### Build Android falha
- Limpe projeto: Build → Clean Project
- Rebuild: Build → Rebuild Project
- Verifique logs no Logcat

### GitHub Actions falha
- Verifique se todos os secrets estão configurados
- Veja logs na aba Actions do GitHub
- Confirme que FIREBASE_TOKEN está válido

---

## 🎉 Quando Estiver Tudo Pronto

Após publicar na Play Store:

1. **Commit e push** para ativar GitHub Actions:
   ```bash
   git add .
   git commit -m "feat: app ready for production"
   git push origin main
   ```

2. **Monitore deploy** na aba Actions do GitHub

3. **Aguarde aprovação** da Play Store (1-7 dias)

4. **Celebre!** 🎊 Seu app está no ar!

---

**Você está quase lá! Falta pouco para o Mnemosyne estar na Play Store! 🚀**
