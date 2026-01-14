# 💳 Guia de Configuração Stripe - Mnemosyne

## Passo 1: Criar Conta Stripe

1. Acesse [stripe.com](https://stripe.com)
2. Clique em "Sign up"
3. Preencha os dados da sua empresa
4. Ative sua conta (pode levar alguns minutos)

## Passo 2: Criar Produtos e Preços

### Produto 1: Mnemosyne Pro

1. Acesse [Dashboard → Products](https://dashboard.stripe.com/products)
2. Clique em "+ Add product"
3. Preencha:
   - **Name**: Mnemosyne Pro
   - **Description**: Memórias ilimitadas, 50GB storage, Knowledge Graph avançado
   - **Pricing model**: Standard pricing
   - **Price**: €9.99
   - **Billing period**: Monthly
4. Clique em "Save product"
5. **COPIE O PRICE ID** (formato: `price_xxxxx`) - você vai precisar dele!

6. Adicionar preço anual:
   - Na página do produto, clique em "+ Add another price"
   - **Price**: €99
   - **Billing period**: Yearly
   - Salve e **COPIE O PRICE ID**

### Produto 2: Mnemosyne Business

1. Clique em "+ Add product"
2. Preencha:
   - **Name**: Mnemosyne Business
   - **Description**: Tudo do Pro + 500GB storage, API access, até 10 membros
   - **Price**: €29.99
   - **Billing period**: Monthly
3. Salve e **COPIE O PRICE ID**

4. Adicionar preço anual:
   - **Price**: €299
   - **Billing period**: Yearly
   - Salve e **COPIE O PRICE ID**

## Passo 3: Obter API Keys

1. Acesse [Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys)
2. Você verá duas chaves:
   - **Publishable key** (pk_test_...) - Segura para frontend
   - **Secret key** (sk_test_...) - NUNCA exponha no frontend!
3. **COPIE AMBAS AS CHAVES**

> **⚠️ Importante**: Use chaves de TESTE (pk_test_, sk_test_) durante desenvolvimento!

## Passo 4: Configurar Webhook

1. Acesse [Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Clique em "+ Add endpoint"
3. Preencha:
   - **Endpoint URL**: `https://us-central1-mnemosyne-one.cloudfunctions.net/handleStripeWebhook`
     - ⚠️ Substitua `mnemosyne-one` pelo seu PROJECT_ID do Firebase
   - **Description**: Mnemosyne Subscription Events
4. Em "Events to send", selecione:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Clique em "Add endpoint"
6. **COPIE O SIGNING SECRET** (whsec_...)

## Passo 5: Configurar Variáveis de Ambiente

### Frontend (.env)

1. Copie o arquivo `.env.example` para `.env`:
   ```bash
   cd frontend
   cp .env.example .env
   ```

2. Edite `frontend/.env` e preencha:
   ```env
   # Suas credenciais Firebase (já devem estar configuradas)
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...

   # Stripe - Cole suas chaves aqui
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...

   # Stripe Price IDs - Cole os IDs que você copiou
   VITE_STRIPE_PRICE_PRO_MONTHLY=price_...
   VITE_STRIPE_PRICE_PRO_YEARLY=price_...
   VITE_STRIPE_PRICE_BUSINESS_MONTHLY=price_...
   VITE_STRIPE_PRICE_BUSINESS_YEARLY=price_...
   ```

### Backend (.env)

1. Copie o arquivo `.env.example` para `.env`:
   ```bash
   cd functions
   cp .env.example .env
   ```

2. Edite `functions/.env` e preencha:
   ```env
   # LLM (já deve estar configurado)
   GEMINI_API_KEY=...
   OPENAI_API_KEY=...

   # Stripe - Cole suas chaves SECRETAS aqui
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...

   # Stripe Price IDs (mesmos do frontend)
   STRIPE_PRICE_PRO_MONTHLY=price_...
   STRIPE_PRICE_PRO_YEARLY=price_...
   STRIPE_PRICE_BUSINESS_MONTHLY=price_...
   STRIPE_PRICE_BUSINESS_YEARLY=price_...
   ```

## Passo 6: Deploy e Teste

### Deploy das Functions

```bash
cd functions
npm run build
firebase deploy --only functions
```

### Testar Localmente

```bash
cd frontend
npm run dev
```

1. Acesse http://localhost:5173
2. Faça login
3. Acesse http://localhost:5173/pricing
4. Clique em "Upgrade para Pro"
5. Use cartão de teste: `4242 4242 4242 4242`
   - Data: qualquer data futura
   - CVC: qualquer 3 dígitos
   - CEP: qualquer CEP

### Verificar Webhook

1. Após completar o checkout de teste
2. Acesse [Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
3. Clique no seu endpoint
4. Verifique se há eventos recebidos com sucesso (status 200)

## Passo 7: Ativar Modo Produção

Quando estiver pronto para produção:

1. Ative sua conta Stripe (forneça informações da empresa)
2. Obtenha chaves de PRODUÇÃO (pk_live_, sk_live_)
3. Atualize os arquivos `.env` com chaves live
4. Reconfigure o webhook com a URL de produção
5. Redeploy:
   ```bash
   firebase deploy --only functions
   npm run build
   firebase deploy --only hosting
   ```

## Troubleshooting

### Erro: "No such price"
- Verifique se os Price IDs estão corretos nos arquivos `.env`
- Certifique-se de usar IDs de teste com chaves de teste

### Webhook não funciona
- Verifique se a URL do webhook está correta
- Confirme que o PROJECT_ID está correto
- Verifique logs: `firebase functions:log`

### Checkout não abre
- Verifique se a chave pública está correta no `.env`
- Abra o console do navegador para ver erros
- Confirme que as functions foram deployadas

## Recursos Úteis

- [Stripe Dashboard](https://dashboard.stripe.com)
- [Stripe Testing](https://stripe.com/docs/testing)
- [Cartões de Teste](https://stripe.com/docs/testing#cards)
- [Webhook Testing](https://stripe.com/docs/webhooks/test)

---

**Pronto! Seu sistema de pagamentos Stripe está configurado! 🎉**
