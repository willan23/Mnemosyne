# 🔍 Debug: Verificar Dados da Subscription

## Problema
Após o checkout, a página fica carregando mas não mostra os dados da subscription.

## Verificações Necessárias

### 1. Verificar Firestore Console

Vá para: [Firebase Console → Firestore](https://console.firebase.google.com/project/_/firestore)

**Procure por**:
1. Collection `customers`
2. Dentro dela, procure um documento com seu **User ID** (UID)
3. Dentro desse documento, deve ter uma subcollection `subscriptions`
4. Dentro de `subscriptions`, deve ter um documento com a subscription ativa

**Estrutura esperada**:
```
customers/
  └─ {seu-uid}/
      ├─ checkout_sessions/
      │   └─ {session-id}
      └─ subscriptions/
          └─ {subscription-id}  ← DEVE EXISTIR
              ├─ status: "active"
              ├─ price: { id: "price_..." }
              ├─ current_period_end: Timestamp
              └─ ...
```

---

### 2. Verificar Stripe Dashboard

Vá para: [Stripe → Customers](https://dashboard.stripe.com/test/customers)

1. Deve ter um customer criado
2. Clique nele
3. Verifique se tem uma **subscription ativa**
4. Status deve ser "Active"

---

### 3. Verificar Logs do Navegador

Abra o **Console do navegador** (F12):

1. Veja se há erros em vermelho
2. Procure por logs do tipo:
   - `Error fetching subscription`
   - Erros de permissão do Firestore

---

## 🛠️ Solução Temporária: Adicionar Logs

Vou adicionar logs de debug no código para ver o que está acontecendo.

**Abra o Console do navegador (F12) e me diga o que aparece!**

---

## Possíveis Causas

### Causa 1: Subscription não foi criada
- Webhook não configurado
- Extensão não processou o checkout

### Causa 2: Permissões do Firestore
- Regras de segurança bloqueando leitura de `customers`

### Causa 3: UID diferente
- Usuário logado com UID diferente do que fez a compra

---

## Próximo Passo

**Me diga**:
1. O que aparece no Console do navegador (F12)?
2. Existe a collection `customers/{seu-uid}/subscriptions` no Firestore?
3. Tem algum erro vermelho no console?
