# 🔍 Debug: Stripe Status Não Atualiza

## ✅ O que funcionou:
- Checkout Stripe completado com sucesso
- Pagamento processado

## ❌ Problema:
- Status continua "Free" no app
- Não atualizou para "Pro"

---

## 🔧 Possíveis Causas

### 1. Extensão Stripe usa collections diferentes

A extensão Stripe Firebase cria as collections:
- `customers/{uid}/checkout_sessions`
- `customers/{uid}/subscriptions`
- `customers/{uid}/payments`

Mas o código do `useSubscription.ts` está buscando em:
- `users/{uid}/subscription`

**Solução**: Precisamos adaptar o código para ler da collection correta.

---

## 📋 Verificações Rápidas

### 1. Verificar Firestore

Vá para: [Firebase Console → Firestore](https://console.firebase.google.com/project/_/firestore)

Procure por:
- Collection `customers` → Seu UID → `subscriptions`
- Deve ter um documento com a subscription ativa

### 2. Verificar Stripe Dashboard

Vá para: [Stripe → Customers](https://dashboard.stripe.com/test/customers)

- Deve ter um customer criado
- Com subscription ativa

### 3. Verificar Webhooks

Vá para: [Stripe → Webhooks](https://dashboard.stripe.com/test/webhooks)

- Veja se há eventos recebidos
- Status deve ser 200 (sucesso)

---

## 🛠️ Solução: Adaptar useSubscription

Precisamos modificar `useSubscription.ts` para ler da collection `customers` criada pela extensão Stripe.

### Opção 1: Usar a extensão completamente (Recomendado)

Modificar o hook para ler de `customers/{uid}/subscriptions`

### Opção 2: Manter código custom

Configurar webhook para atualizar `users/{uid}/subscription`

---

## 🎯 Próximo Passo

Vou adaptar o código para funcionar com a extensão Stripe Firebase.

Você quer que eu:
1. **Adapte o useSubscription** para ler da collection `customers`? (Mais rápido)
2. **Configure webhook** para sincronizar com `users`? (Mais trabalho)

**Recomendo opção 1!** É mais simples e usa a extensão corretamente.
