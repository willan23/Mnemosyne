# 🎯 Solução Rápida: Adicionar Subscription Manualmente

## Passo a Passo

### 1. Abra o Firestore Console

[Firebase Console → Firestore](https://console.firebase.google.com/project/_/firestore)

### 2. Navegue até seu usuário

1. Clique na collection `users`
2. Clique no documento `cWcz7oT4mVOChOP3M32oaJGp3c2`

### 3. Edite o campo `subscription`

Clique em **"Adicionar campo"** ou edite o campo `subscription` existente:

**Nome do campo**: `subscription`
**Tipo**: `map`

**Adicione os seguintes campos dentro do map**:

| Campo | Tipo | Valor |
|-------|------|-------|
| `stripeCustomerId` | string | `cus_Tg2MSJXyhRX7tc` |
| `stripeSubscriptionId` | string | `sub_1SiNOxPOfX00FmXdZvVcQqYt` |
| `tier` | string | `pro` |
| `status` | string | `active` |
| `cancelAtPeriodEnd` | boolean | `false` |
| `currentPeriodEnd` | timestamp | **Clique em "timestamp" e adicione uma data futura** (ex: 30/01/2025) |

### 4. Salvar

Clique em **"Atualizar"** ou **"Salvar"**

### 5. Recarregar a Página

1. Volte para http://localhost:5173
2. **Recarregue a página** (F5)
3. **Deve aparecer "Pro"** no sidebar!

---

## 📸 Exemplo Visual

O campo `subscription` deve ficar assim:

```
subscription (map)
├─ stripeCustomerId: "cus_Tg2MSJXyhRX7tc"
├─ stripeSubscriptionId: "sub_1SiNOxPOfX00FmXdZvVcQqYt"
├─ tier: "pro"
├─ status: "active"
├─ cancelAtPeriodEnd: false
└─ currentPeriodEnd: Timestamp (Jan 30, 2025)
```

---

## ✅ Verificar

Após salvar e recarregar:
- ✅ Sidebar deve mostrar "Pro" em vez de "Free"
- ✅ Deve mostrar "Memórias ilimitadas"
- ✅ Console do navegador deve mostrar logs de debug

---

**Faça isso agora e me avise se funcionou!** 🚀
