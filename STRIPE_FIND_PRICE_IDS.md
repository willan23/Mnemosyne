# 🔍 Como Encontrar os Price IDs (não Product IDs)

## Você me enviou Product IDs, mas preciso de Price IDs!

### O que você enviou (Product IDs):
```
❌ prod_TfiZaDPA7mkmW5  - Pro mensal
❌ prod_TfigpFZVmqkjAc  - Pro anual
❌ prod_Tfii8kebmZgezY  - Business mensal
❌ prod_TfijRvmprzznjQ  - Business anual
```

### O que eu preciso (Price IDs):
```
✅ price_xxxxxxxxxxxxx  - Pro mensal
✅ price_xxxxxxxxxxxxx  - Pro anual
✅ price_xxxxxxxxxxxxx  - Business mensal
✅ price_xxxxxxxxxxxxx  - Business anual
```

---

## 📋 Passo a Passo para Encontrar Price IDs:

### 1. Acesse seus produtos
[Stripe Dashboard → Products](https://dashboard.stripe.com/test/products)

### 2. Para cada produto:

1. **Clique no produto** (ex: "Mnemosyne Pro")
2. Você verá uma seção **"Pricing"**
3. Lá terá os preços listados:
   - `€9.99/month` → Ao lado tem o **Price ID**: `price_xxxxx`
   - `€99/year` → Ao lado tem o **Price ID**: `price_xxxxx`

### 3. Copie os Price IDs

**Exemplo visual**:
```
Mnemosyne Pro
├─ Pricing
│  ├─ €9.99 / month    → price_1AbCdEfGhIjKlMnO  ← COPIE ESTE
│  └─ €99 / year       → price_2XyZaBcDeFgHiJkL  ← COPIE ESTE
```

---

## ✅ Template para me enviar:

Copie e cole assim:

```
Pro mensal: price_________________
Pro anual: price_________________
Business mensal: price_________________
Business anual: price_________________
```

---

## 🎯 Alternativa Rápida

Se preferir, tire um **screenshot** da página de cada produto mostrando os Price IDs e me mande!

---

**Encontre os 4 Price IDs e me mande aqui!** 🚀
