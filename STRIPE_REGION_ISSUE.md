# ⚠️ Importante: Região da Extensão Stripe

## Situação Atual

Você instalou a extensão Stripe em **Belgium (europe-west1)**, mas suas Firebase Functions não têm região configurada, então estão na região padrão **us-central1** (Iowa, EUA).

---

## Por que isso importa?

1. **Latência**: Chamadas entre regiões diferentes são mais lentas
2. **Custos**: Transferência de dados entre regiões tem custo adicional
3. **Consistência**: Melhor ter tudo na mesma região

---

## ✅ Opções de Solução

### Opção 1: Reinstalar Stripe em us-central1 (Mais Simples)

**Recomendado se a instalação ainda não terminou**:

1. Cancele a instalação atual da extensão
2. Reinstale escolhendo **us-central1 (Iowa)**
3. Suas Functions já estão lá, então tudo fica alinhado

**Vantagens**:
- Sem mudanças no código
- Região padrão do Firebase (mais documentação)
- Geralmente mais barata

---

### Opção 2: Mover Functions para europe-west1 (Mais Trabalho)

**Se você quer manter tudo na Europa**:

1. Mantenha a extensão Stripe em Belgium
2. Configure suas Functions para `europe-west1`
3. Redeploy todas as Functions

**Como fazer**:
- Modificar `functions/src/stripe.ts` e `functions/src/index.ts`
- Adicionar `.region('europe-west1')` em cada function
- Redeploy: `firebase deploy --only functions`

**Vantagens**:
- Dados ficam na Europa (GDPR compliance)
- Menor latência para usuários europeus

---

## 🎯 Minha Recomendação

**Se a instalação ainda não terminou**: 
→ Cancele e reinstale em **us-central1**

**Se já terminou**: 
→ Pode deixar assim, vai funcionar (só terá um pouco mais de latência)

---

## Como Verificar Status da Instalação

1. Firebase Console → Extensions
2. Veja se a extensão Stripe está "Installing" ou "Installed"
3. Se ainda estiver "Installing", pode cancelar

---

## Próximos Passos

**Depois que a extensão estiver instalada** (em qualquer região):

1. ✅ Copiar Price IDs dos produtos Stripe
2. ✅ Configurar `frontend/.env` com:
   - `VITE_STRIPE_PUBLISHABLE_KEY`
   - `VITE_STRIPE_PRICE_PRO_MONTHLY`
   - `VITE_STRIPE_PRICE_PRO_YEARLY`
   - `VITE_STRIPE_PRICE_BUSINESS_MONTHLY`
   - `VITE_STRIPE_PRICE_BUSINESS_YEARLY`
3. ✅ Testar checkout

---

**Qual opção você prefere? A instalação já terminou ou ainda está em andamento?**
