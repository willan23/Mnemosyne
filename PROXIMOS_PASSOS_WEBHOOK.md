# ✅ Próximos Passos: Configurar Webhook Automático

## 🎉 Sucesso Até Agora

- ✅ Stripe configurado
- ✅ Checkout funcionando
- ✅ Cloud Functions deployed
- ✅ Status "Pro" aparecendo no app

---

## 🔧 Configurar Webhook (Automático)

### 1. Obter URL da Function

A URL do webhook é:
```
https://us-central1-mnemosyne-one.cloudfunctions.net/handleStripeWebhook
```

### 2. Configurar no Stripe Dashboard

1. **Acesse**: [Stripe → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks)

2. **Clique em "Add endpoint"**

3. **Preencha**:
   - **Endpoint URL**: `https://us-central1-mnemosyne-one.cloudfunctions.net/handleStripeWebhook`
   - **Description**: `Mnemosyne Webhook`
   - **Events to send**: Selecione:
     - ✅ `checkout.session.completed`
     - ✅ `customer.subscription.created`
     - ✅ `customer.subscription.updated`
     - ✅ `customer.subscription.deleted`
     - ✅ `invoice.payment_succeeded`
     - ✅ `invoice.payment_failed`

4. **Clique em "Add endpoint"**

### 3. Copiar Webhook Secret

1. Após criar, **clique no endpoint**
2. **Copie o "Signing secret"** (começa com `whsec_...`)
3. **Adicione ao `functions/.env`**:
   ```env
   STRIPE_WEBHOOK_SECRET=whsec_seu_secret_aqui
   ```

### 4. Redeploy Functions

```bash
cd functions
firebase deploy --only functions:handleStripeWebhook
```

---

## ✅ Testar

1. Faça um **novo checkout** (pode usar outro email de teste)
2. Complete o pagamento
3. Verifique:
   - ✅ Stripe Dashboard → Webhooks → deve mostrar evento recebido (status 200)
   - ✅ Firestore → `users/{uid}/subscription` deve ser criado automaticamente
   - ✅ App deve mostrar "Pro" automaticamente

---

## 🎯 Resumo

**Agora**: Funciona manualmente (você adicionou no Firestore)
**Depois do webhook**: Funciona automaticamente para todos os usuários!

**Quer que eu configure o webhook agora ou prefere fazer depois?**

Se quiser, posso te guiar passo a passo! 🚀
