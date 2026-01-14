# 🔧 Configuração do Webhook Stripe

## Passo a Passo

### 1. Deploy das Functions

Primeiro, precisamos fazer deploy das Cloud Functions:

```bash
cd functions
npm run build
firebase deploy --only functions
```

### 2. Obter URL do Webhook

Após o deploy, a URL do webhook será:
```
https://us-central1-SEU-PROJECT-ID.cloudfunctions.net/handleStripeWebhook
```

Substitua `SEU-PROJECT-ID` pelo ID do seu projeto Firebase.

### 3. Configurar no Stripe Dashboard

1. Acesse: [Stripe → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Clique em **"Add endpoint"**
3. **Endpoint URL**: Cole a URL acima
4. **Events to send**: Selecione:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Clique em **"Add endpoint"**

### 4. Copiar Webhook Secret

1. Após criar o endpoint, clique nele
2. Copie o **Signing secret** (começa com `whsec_...`)
3. Adicione ao `functions/.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### 5. Redeploy Functions

```bash
firebase deploy --only functions
```

---

## ✅ Teste

Faça um novo checkout e verifique:
1. No Stripe Dashboard → Webhooks → veja se o evento foi recebido (status 200)
2. No Firestore → `users/{uid}/subscription` deve ser atualizado automaticamente

---

## 🎯 Adicionar Subscription Manualmente (Temporário)

Enquanto configura o webhook, adicione manualmente:

1. Firestore Console
2. `users/{seu-uid}/subscription`
3. Edite para:

```json
{
  "stripeCustomerId": "cus_Tg2MSJXyhRX7tc",
  "stripeSubscriptionId": "sub_...",
  "tier": "pro",
  "status": "active",
  "currentPeriodEnd": {
    "_seconds": 1738281600,
    "_nanoseconds": 0
  },
  "cancelAtPeriodEnd": false
}
```

**Recarregue a página** e deve aparecer "Pro"!
