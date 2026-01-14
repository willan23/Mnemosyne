# 🐛 Problemas Identificados

## 1. Erro no Checkout para Novas Contas

**Sintoma**: "Erro ao iniciar checkout. Tente novamente"

**Possíveis Causas**:
- Cloud Function `createCheckoutSession` não está configurada corretamente
- Falta de permissões
- Stripe API key incorreta no backend

**Solução**: Verificar logs da function e configuração

---

## 2. Após Deletar Conta, Não Mostra Key Ceremony

**Sintoma**: Depois de deletar conta, vai direto para dashboard em vez de mostrar tela de geração de mnemonic

**Causa**: Após deletar conta, o `localStorage` não é limpo e o mnemonic antigo ainda existe

**Solução**: Limpar `localStorage` após deletar conta

---

## 🔧 Correções Necessárias

1. Verificar logs do Firebase Functions
2. Corrigir fluxo de deleção de conta
3. Testar checkout novamente
