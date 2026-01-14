# 🔧 Corrigir Erro 500 no Checkout

## Problema Identificado

Erro ao chamar `createCheckoutSession`:
```
POST https://us-central1-mnemosyne-one.cloudfunctions.net/createCheckoutSession
500 (Internal Server Error)
```

## Causa

A função `createCheckoutSession` está falhando porque falta configurar o **Stripe Secret Key** no `functions/.env`.

## Solução

### 1. Adicionar Stripe Secret Key

Abra `w:\SaaS\functions\.env` e adicione:

```env
STRIPE_SECRET_KEY=sk_test_sua_chave_aqui
STRIPE_WEBHOOK_SECRET=whsec_w4AItE6SopMH27jIqCizCLoq2JyQAeW3
```

**Onde encontrar a Secret Key:**
1. [Stripe Dashboard → API Keys](https://dashboard.stripe.com/test/apikeys)
2. Copie a **Secret key** (começa com `sk_test_...`)

### 2. Redeploy Functions

```bash
cd functions
firebase deploy --only functions
```

### 3. Testar Novamente

Após o deploy, teste o checkout novamente!

---

**Me envie a Stripe Secret Key ou adicione você mesmo ao `.env`!**
