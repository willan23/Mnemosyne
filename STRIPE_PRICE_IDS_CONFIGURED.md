# 🎯 Configuração Final do Stripe - Price IDs

## ✅ Price IDs Recebidos e Organizados:

```env
# Pro
VITE_STRIPE_PRICE_PRO_MONTHLY=price_1SiN8nPOfX00FmXdekXeO1Gu
VITE_STRIPE_PRICE_PRO_YEARLY=price_1SiNEmPOfX00FmXdl5wNHgQz

# Business  
VITE_STRIPE_PRICE_BUSINESS_MONTHLY=price_1SiNHHPOfX00FmXdC36rjbD9
VITE_STRIPE_PRICE_BUSINESS_YEARLY=price_1SiNICPOfX00FmXdLCaQeLSl
```

---

## 📝 Próximo Passo: Configurar frontend/.env

### 1. Obter Stripe Publishable Key

Acesse: [Stripe API Keys](https://dashboard.stripe.com/test/apikeys)

Copie a **Publishable key** (começa com `pk_test_...`)

### 2. Editar w:\SaaS\frontend\.env

Abra o arquivo `w:\SaaS\frontend\.env` e adicione/atualize:

```env
# Stripe Publishable Key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_SUA_CHAVE_AQUI

# Stripe Price IDs
VITE_STRIPE_PRICE_PRO_MONTHLY=price_1SiN8nPOfX00FmXdekXeO1Gu
VITE_STRIPE_PRICE_PRO_YEARLY=price_1SiNEmPOfX00FmXdl5wNHgQz
VITE_STRIPE_PRICE_BUSINESS_MONTHLY=price_1SiNHHPOfX00FmXdC36rjbD9
VITE_STRIPE_PRICE_BUSINESS_YEARLY=price_1SiNICPOfX00FmXdLCaQeLSl

# Firebase (já deve estar configurado)
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

---

## 🧪 Testar Stripe Checkout

Após configurar o `.env`:

```bash
cd frontend
npm run dev
```

1. Acesse http://localhost:5173
2. Faça login
3. Vá para `/pricing`
4. Clique em "Upgrade para Pro"
5. Use cartão de teste: `4242 4242 4242 4242`
   - Data: qualquer futura
   - CVC: 123
   - CEP: 12345

---

## ✅ Checklist

- [x] Price IDs copiados
- [ ] Publishable Key adicionada ao `.env`
- [ ] Teste de checkout realizado
- [ ] Webhook funcionando (verificar no Stripe Dashboard)

---

**Copie sua Publishable Key e adicione ao arquivo `.env`!**

Depois teste o checkout e me avise se funcionou! 🚀
