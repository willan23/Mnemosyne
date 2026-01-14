# 💳 Como Criar Produtos no Stripe Dashboard

## Passo a Passo Rápido

### 1. Acessar Products

Vá para: [Stripe Dashboard → Products](https://dashboard.stripe.com/test/products)

**Certifique-se de estar em modo TESTE** (toggle superior direito)

---

## Produto 1: Mnemosyne Pro

### Criar Produto

1. Clique em **"+ Add product"** ou **"Create product"**
2. Preencha:

**Product information**:
- **Name**: `Mnemosyne Pro`
- **Description**: `Memórias ilimitadas, 50GB storage, Knowledge Graph avançado com IA`
- **Image**: (opcional, pode adicionar depois)

**Pricing**:
- **Pricing model**: `Standard pricing`
- **Price**: `9.99`
- **Currency**: `EUR` (€)
- **Billing period**: `Monthly` (Recurring)

3. Clique em **"Save product"**

### ⚠️ IMPORTANTE: Copiar Price ID

Após salvar, você verá o produto criado. 

**COPIE O PRICE ID** - está no formato: `price_xxxxxxxxxxxxx`

Exemplo: `price_1AbCdEfGhIjKlMnO`

**Anote**: 
```
Pro Monthly: price_________________
```

---

### Adicionar Preço Anual

1. Na página do produto Mnemosyne Pro, clique em **"+ Add another price"**
2. Preencha:
   - **Price**: `99`
   - **Currency**: `EUR`
   - **Billing period**: `Yearly`
3. Salve

**COPIE O PRICE ID do plano anual**

**Anote**:
```
Pro Yearly: price_________________
```

---

## Produto 2: Mnemosyne Business

### Criar Produto

1. Volte para Products e clique em **"+ Add product"**
2. Preencha:

**Product information**:
- **Name**: `Mnemosyne Business`
- **Description**: `Tudo do Pro + 500GB storage, API access, até 10 membros`

**Pricing**:
- **Price**: `29.99`
- **Currency**: `EUR`
- **Billing period**: `Monthly`

3. Salve e **COPIE O PRICE ID**

**Anote**:
```
Business Monthly: price_________________
```

---

### Adicionar Preço Anual

1. Na página do produto Business, clique em **"+ Add another price"**
2. Preencha:
   - **Price**: `299`
   - **Currency**: `EUR`
   - **Billing period**: `Yearly`
3. Salve e **COPIE O PRICE ID**

**Anote**:
```
Business Yearly: price_________________
```

---

## ✅ Checklist

Ao final, você deve ter **4 Price IDs**:

- [ ] `price_xxxxx` - Pro Monthly (€9.99/mês)
- [ ] `price_xxxxx` - Pro Yearly (€99/ano)
- [ ] `price_xxxxx` - Business Monthly (€29.99/mês)
- [ ] `price_xxxxx` - Business Yearly (€299/ano)

---

## 📝 Próximo Passo

Depois de copiar os 4 Price IDs, vamos configurar o arquivo `frontend/.env`:

```env
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_STRIPE_PRICE_PRO_MONTHLY=price_...
VITE_STRIPE_PRICE_PRO_YEARLY=price_...
VITE_STRIPE_PRICE_BUSINESS_MONTHLY=price_...
VITE_STRIPE_PRICE_BUSINESS_YEARLY=price_...
```

---

**Crie os produtos agora e me mande os 4 Price IDs quando estiver pronto!** 🚀
