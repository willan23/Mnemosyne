# 🔍 Verificar Subscription no Firestore

## URGENTE: Precisamos verificar se a subscription foi criada!

### Opção 1: Firebase Console (MAIS RÁPIDO)

1. **Abra**: [Firebase Console → Firestore](https://console.firebase.google.com/project/_/firestore)

2. **Procure pela collection** `customers`

3. **Dentro de `customers`**, procure um documento com seu **UID**
   - Para saber seu UID, abra o Console do navegador (F12) e digite:
   ```javascript
   firebase.auth().currentUser.uid
   ```
   - Copie o UID que aparecer

4. **Dentro do documento do seu UID**, procure por:
   - Subcollection `subscriptions`
   - Deve ter um documento lá dentro

5. **Me diga**:
   - ✅ Existe a collection `customers`?
   - ✅ Existe um documento com seu UID?
   - ✅ Existe a subcollection `subscriptions`?
   - ✅ Tem algum documento dentro de `subscriptions`?
   - ✅ Se sim, qual o valor do campo `status`?

---

### Opção 2: Via Console do Navegador

Cole este código no Console (F12):

```javascript
// Importar Firestore
import('firebase/firestore').then(async ({ getFirestore, collection, getDocs }) => {
  const db = getFirestore();
  const uid = firebase.auth().currentUser.uid;
  
  console.log('🔍 Verificando UID:', uid);
  
  const subsRef = collection(db, 'customers', uid, 'subscriptions');
  const snapshot = await getDocs(subsRef);
  
  console.log('📊 Total de subscriptions:', snapshot.size);
  
  snapshot.forEach(doc => {
    console.log('📄 Subscription ID:', doc.id);
    console.log('📄 Dados:', doc.data());
  });
});
```

---

## 🎯 O que estamos procurando

Se a subscription foi criada corretamente, deve existir:

```
Firestore/
└─ customers/
    └─ {seu-uid}/
        └─ subscriptions/
            └─ {subscription-id}/
                ├─ status: "active"
                ├─ price: { id: "price_1SiN8n..." }
                ├─ current_period_end: Timestamp
                └─ ...
```

---

## Possíveis Resultados

### ✅ Se a subscription EXISTE:
→ O problema é no código do `useSubscription`
→ Vou arrumar o código

### ❌ Se a subscription NÃO EXISTE:
→ A extensão Stripe não criou a subscription
→ Precisamos verificar:
  - Webhook configurado?
  - Extensão instalada corretamente?
  - Logs da extensão no Firebase

---

**Por favor, verifique no Firebase Console e me diga o que encontrou!** 🔍
