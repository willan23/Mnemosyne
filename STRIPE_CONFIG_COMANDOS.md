# Configuração Stripe - Comandos para Copiar e Colar

## Passo 1: Obter suas chaves do Stripe

Abra estes links no navegador:
1. **Secret Key**: https://dashboard.stripe.com/test/apikeys
2. **Webhook Secret**: https://dashboard.stripe.com/test/webhooks (clique no seu endpoint)
3. **Price IDs**: https://dashboard.stripe.com/test/products

## Passo 2: Execute estes comandos UM POR VEZ

Copie e cole cada comando abaixo, substituindo os valores entre aspas:

### 1. Stripe Secret Key
```powershell
firebase functions:config:set stripe.secret_key="COLE_SUA_CHAVE_AQUI"
```
Exemplo: `firebase functions:config:set stripe.secret_key="sk_test_51AbCdEf..."`

### 2. Stripe Webhook Secret
```powershell
firebase functions:config:set stripe.webhook_secret="COLE_SEU_SECRET_AQUI"
```
Exemplo: `firebase functions:config:set stripe.webhook_secret="whsec_abc123..."`

### 3. Price ID - Pro Monthly
```powershell
firebase functions:config:set stripe.price_pro_monthly="COLE_O_PRICE_ID_AQUI"
```
Exemplo: `firebase functions:config:set stripe.price_pro_monthly="price_1AbCdEf..."`

### 4. Price ID - Pro Yearly
```powershell
firebase functions:config:set stripe.price_pro_yearly="COLE_O_PRICE_ID_AQUI"
```

### 5. Price ID - Business Monthly
```powershell
firebase functions:config:set stripe.price_business_monthly="COLE_O_PRICE_ID_AQUI"
```

### 6. Price ID - Business Yearly
```powershell
firebase functions:config:set stripe.price_business_yearly="COLE_O_PRICE_ID_AQUI"
```

## Passo 3: Verificar configuração

```powershell
firebase functions:config:get
```

Você deve ver todas as chaves configuradas.

## Passo 4: Redeploy

```powershell
firebase deploy --only functions
```

## Passo 5: Testar!

1. Acesse: http://localhost:5173/pricing
2. Clique em "Upgrade para Pro"
3. Use cartão de teste: `4242 4242 4242 4242`

---

**Dica**: Se não tiver criado os produtos no Stripe ainda, siga o guia em `STRIPE_SETUP.md`
