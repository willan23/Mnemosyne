# 🔐 Adicionar Webhook Secret

## Passo a Passo

### 1. Copiar Webhook Secret do Stripe

1. No Stripe Dashboard, **clique no endpoint** `mnemosyne-one`
2. Procure por **"Signing secret"**
3. **Clique em "Reveal"** ou copie o valor (começa com `whsec_...`)

### 2. Adicionar ao functions/.env

Abra o arquivo `w:\SaaS\functions\.env` e adicione:

```env
STRIPE_WEBHOOK_SECRET=whsec_seu_secret_aqui
```

**Substitua** `whsec_seu_secret_aqui` pelo secret que você copiou!

### 3. Redeploy da Function

Execute:

```bash
cd functions
firebase deploy --only functions:handleStripeWebhook
```

---

## ✅ Testar

Depois do redeploy:

1. Faça um **novo checkout** (pode usar email diferente)
2. Complete o pagamento
3. Verifique:
   - ✅ Stripe Dashboard → Webhooks → evento com status **200** (sucesso)
   - ✅ Firestore → `users/{novo-uid}/subscription` criado automaticamente
   - ✅ App mostra "Pro" automaticamente

---

**Me avise quando adicionar o secret e eu faço o redeploy!** 🚀
