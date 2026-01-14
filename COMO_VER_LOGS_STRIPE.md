# 🔍 Como Verificar os Logs do Stripe

## Passo 1: Fazer Login no Stripe

1. Abra: https://dashboard.stripe.com/login
2. Faça login com sua conta
3. Resolva o CAPTCHA se aparecer

## Passo 2: Acessar os Logs

1. Vá para: https://dashboard.stripe.com/test/logs
2. Ou clique em "Developers" → "Logs" no menu

## Passo 3: Procurar Erros Recentes

Procure por requisições com:
- ❌ Status vermelho (erro)
- 🔴 Código 400 ou 500
- ⏱️ Timestamp recente (últimos minutos)

## Passo 4: Clicar no Erro

Clique na requisição com erro para ver detalhes:
- **Endpoint**: Qual API foi chamada
- **Error message**: Mensagem de erro do Stripe
- **Request body**: O que foi enviado
- **Response**: O que o Stripe retornou

## 🔍 Erros Comuns

### "No such price: price_xxx"
**Causa**: O Price ID não existe no Stripe
**Solução**: Criar o produto ou corrigir o Price ID

### "Invalid API Key"
**Causa**: A chave está incorreta ou expirou
**Solução**: Gerar nova chave em https://dashboard.stripe.com/test/apikeys

### "This value must be greater than or equal to 1"
**Causa**: Preço configurado como 0 ou negativo
**Solução**: Verificar configuração do produto

## 📋 O Que Reportar

Se encontrar um erro, me diga:
1. O código do erro (ex: 400, 404, 500)
2. A mensagem de erro completa
3. Qual endpoint foi chamado (ex: /v1/checkout/sessions)

---

**Dica**: Se não houver erros nos logs, o problema pode estar nas Firebase Functions.
