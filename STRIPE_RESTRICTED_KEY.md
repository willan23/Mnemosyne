# 🔑 Como Criar Stripe Restricted API Key

## Passo a Passo

### 1. Acesse a página de API Keys

Vá para: [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/test/apikeys)

**Certifique-se de estar em modo TESTE** (toggle no canto superior direito deve mostrar "Test mode")

---

### 2. Criar Restricted Key

1. Clique em **"Create restricted key"** ou **"+ Create restricted key"**

2. **Nome da chave**: `Firebase Extension - Mnemosyne`

---

### 3. Configurar Permissões

Configure as permissões **EXATAMENTE** assim:

#### ✅ Write Access (Acesso de Escrita)
- **Customers** → Write
- **Checkout Sessions** → Write  
- **Customer Portal** → Write

#### 📖 Read Access (Acesso de Leitura)
- **Subscriptions** → Read
- **Prices** → Read

#### ❌ Todas as outras → None (Nenhum acesso)

---

### 4. Configuração Visual

```
Resource                Permission
────────────────────────────────────
Customers              Write ✓
Checkout Sessions      Write ✓
Customer Portal        Write ✓
Subscriptions          Read  ✓
Prices                 Read  ✓
────────────────────────────────────
(Todos os outros)      None
```

---

### 5. Criar e Copiar

1. Clique em **"Create key"**
2. A chave será exibida **UMA ÚNICA VEZ**
3. **COPIE IMEDIATAMENTE** - começa com `rk_test_...` (restricted key test)
4. Cole no campo da extensão Firebase

---

## 🎯 Resposta Rápida

**Selecione a opção**: 
> **"Como criar sua própria integração"**
> 
> Você está usando esta chave em um projeto que está em fase de criação.

Depois crie a restricted key com as permissões acima.

---

## ⚠️ Importante

- **Restricted key** é mais segura que a Secret key normal
- Ela tem **apenas** as permissões necessárias
- Se comprometida, o dano é limitado
- É a **melhor prática** recomendada pelo Stripe

---

## 🔄 Alternativa Rápida (Menos Segura)

Se quiser testar rapidamente primeiro:

1. Use a **Secret key** normal (`sk_test_...`)
2. Teste tudo
3. Depois crie a restricted key e substitua

**Mas recomendo criar a restricted key desde o início!** 🔒

---

## Próximo Passo

Após criar e colar a chave:
1. Configure o webhook secret (opcional)
2. Deixe "Minimum instances" em 0
3. Clique em "Install extension"
4. Aguarde instalação (2-5 minutos)
