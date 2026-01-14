# 🔐 GitHub Secrets Configuration

Para o deploy automático funcionar, você precisa configurar os seguintes secrets no GitHub:

## Como Adicionar Secrets

1. Vá para seu repositório no GitHub
2. **Settings** → **Secrets and variables** → **Actions**
3. Clique em **New repository secret**

---

## Secrets Necessários

### 1. FIREBASE_SERVICE_ACCOUNT
**Obter**: Firebase Console → Project Settings → Service Accounts → Generate New Private Key

Cole o **conteúdo completo do arquivo JSON** baixado.

### 2. FIREBASE_TOKEN
**Obter via terminal**:
```bash
firebase login:ci
```

Cole o token gerado.

### 3. FIREBASE_PROJECT_ID
Seu Firebase Project ID (ex: `mnemosyne-one`)

---

## Firebase Config (Frontend)

### 4. VITE_FIREBASE_API_KEY
### 5. VITE_FIREBASE_AUTH_DOMAIN
### 6. VITE_FIREBASE_PROJECT_ID
### 7. VITE_FIREBASE_STORAGE_BUCKET
### 8. VITE_FIREBASE_MESSAGING_SENDER_ID
### 9. VITE_FIREBASE_APP_ID

**Obter**: Firebase Console → Project Settings → Your apps → Config

---

## Stripe Config

### 10. VITE_STRIPE_PUBLISHABLE_KEY
**Obter**: Stripe Dashboard → Developers → API keys → Publishable key

Use `pk_test_...` para teste ou `pk_live_...` para produção.

### 11. VITE_STRIPE_PRICE_PRO_MONTHLY
### 12. VITE_STRIPE_PRICE_PRO_YEARLY
### 13. VITE_STRIPE_PRICE_BUSINESS_MONTHLY
### 14. VITE_STRIPE_PRICE_BUSINESS_YEARLY

**Obter**: Stripe Dashboard → Products → Selecione produto → Copie Price ID

Formato: `price_xxxxxxxxxxxxx`

---

## Checklist de Configuração

- [ ] FIREBASE_SERVICE_ACCOUNT
- [ ] FIREBASE_TOKEN
- [ ] FIREBASE_PROJECT_ID
- [ ] VITE_FIREBASE_API_KEY
- [ ] VITE_FIREBASE_AUTH_DOMAIN
- [ ] VITE_FIREBASE_PROJECT_ID
- [ ] VITE_FIREBASE_STORAGE_BUCKET
- [ ] VITE_FIREBASE_MESSAGING_SENDER_ID
- [ ] VITE_FIREBASE_APP_ID
- [ ] VITE_STRIPE_PUBLISHABLE_KEY
- [ ] VITE_STRIPE_PRICE_PRO_MONTHLY
- [ ] VITE_STRIPE_PRICE_PRO_YEARLY
- [ ] VITE_STRIPE_PRICE_BUSINESS_MONTHLY
- [ ] VITE_STRIPE_PRICE_BUSINESS_YEARLY

---

## Testar Deploy

Após configurar todos os secrets:

```bash
git add .
git commit -m "chore: configure GitHub Actions"
git push origin main
```

Acompanhe em: **GitHub → Actions tab**
