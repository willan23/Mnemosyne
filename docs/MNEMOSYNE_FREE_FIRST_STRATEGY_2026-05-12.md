# Mnemosyne Free-First Strategy

Data: 2026-05-12
Decisao: tornar o Mnemosyne 100% gratuito na fase de entrada no mercado e introduzir planos pagos apenas depois de haver reconhecimento, tracao e confianca.

## Posicao

O Mnemosyne deve entrar no mercado como uma experiencia gratuita, completa e memoravel. A prioridade agora e distribuicao, prova de valor, comunidade e reputacao. Monetizacao imediata pode travar o produto antes de o mercado entender a categoria.

Isto nao deve ser comunicado como "gratuito para sempre". A comunicacao correta e:

- Founder Preview gratuito.
- Sovereign Beta gratuita.
- Early users com acesso gratuito durante a fase de construcao de mercado.
- Planos pagos futuros para capacidades avancadas, equipas, uso intensivo de cloud, compliance e suporte.

## Regra central

Gratis para o utilizador nao significa sem limites tecnicos. O produto deve ser gratuito, mas a infraestrutura deve continuar protegida contra abuso.

Abrir:

- Criacao de memorias.
- Grafo/Universe.
- Embeddings locais.
- AI local/Ollama.
- Time Travel local.
- Insights locais.
- Transmissao cifrada basica.
- Mobile Sync basico.

Manter limites de protecao:

- Tamanho e tipo de anexos.
- Retencao de relay.
- Retencao de envelopes P2P/Mobile Sync.
- Rate limiting em web research e endpoints cloud.
- App Check e abuso por UID/IP quando aplicavel.

## O que acontece aos planos pagos

Nao apagar Stripe, Billing, planos ou limites. Colocar em modo latente.

Razao:

- O trabalho ja existe e sera util depois.
- Remover agora criaria custo futuro.
- O melhor caminho e esconder/desativar bloqueios comerciais, preservando a arquitetura.

Futuro pago deve monetizar valor que tem custo real ou valor empresarial:

- Equipas e espacos partilhados.
- Retencao prolongada de relay.
- Sync multi-dispositivo intensivo.
- Backup gerido.
- Storage cloud ampliado.
- Admin/compliance/exportacao empresarial.
- AI cloud gerida com quotas.
- Suporte prioritario.
- Deploy dedicado/self-hosted assistido.

## Mudanca tecnica recomendada

Criar um modo global de monetizacao:

```ts
type MonetizationMode = 'free-first' | 'paid';
```

Em `free-first`:

- Paywalls nao bloqueiam fluxos core.
- `PricingPage` vira pagina de Founder Preview, nao checkout principal.
- O checkout continua disponivel apenas por flag/admin/teste.
- Contadores de uso continuam a existir, mas servem para telemetria e fair-use, nao para bloqueio comercial.
- Mensagens deixam de dizer "upgrade para continuar" e passam a dizer "limite tecnico/fair-use" apenas quando houver custo real.

Em `paid`:

- Os mesmos pontos de gating voltam a usar entitlements server-owned.
- Stripe volta a controlar planos e unlocks.

## Correcao importante antes do pago

As regras atuais leem `users/{uid}.subscription` para algumas permissoes, mas a colecao `users/{userId}` permite `create/update` pelo proprio utilizador. Antes de voltar a cobrar, entitlements pagos nao podem depender de campos que o cliente consiga alterar.

Recomendacao:

- Mover subscricao/entitlements para documento server-managed, por exemplo `entitlements/{uid}`.
- Ou usar custom claims de Firebase Auth para flags criticas.
- Restringir updates em `users/{uid}` para impedir alteracao de `subscription`, `usage`, `reviewerAccess` e campos de billing.

Este ponto fica menos urgente enquanto tudo e gratuito, mas e obrigatorio antes de reativar planos pagos.

## Plano de execucao

### Fase 1: Pivot publico

- Atualizar textos e docs para Founder Preview gratuito.
- Esconder CTAs de upgrade/checkout em fluxos principais.
- Manter pagina de pricing como transparencia: "planos pagos serao introduzidos depois".

### Fase 2: Free-first no codigo

- Adicionar `monetizationMode`.
- Remover bloqueios comerciais de criacao de memorias.
- Remover bloqueios comerciais de anexos, mantendo validacao de tipo/tamanho.
- Ajustar Firestore Rules para nao depender de plano pago durante beta ou criar entitlement beta server-owned.

### Fase 3: Protecao de custo

- Rate limit para web research/backend.
- Retencao curta para relay/transmissoes.
- Quotas tecnicas por abuso, nao por monetizacao.
- Observabilidade privada: erros e custos sem conteudo de memoria.

### Fase 4: Reintroducao paga

So depois de tracao real:

- Definir quais features continuam gratuitas para sempre.
- Criar plano pago sem retirar o core que criou confianca.
- Grandfather early users quando possivel.
- Migrar entitlements para server-owned antes de qualquer cobranca.

## Principio de confianca

O Mnemosyne vende soberania cognitiva. Por isso, o modelo comercial tambem tem de parecer soberano: generoso, claro e sem armadilhas.

O core deve conquistar o mercado primeiro. A monetizacao deve chegar como expansao natural, nao como muro tardio em cima da confianca criada.

## Referencias de mercado

- Stripe descreve freemium como estrategia com desafios claros: conversao baixa e necessidade de gerir expectativas de utilizadores gratuitos e pagos: https://stripe.com/au/resources/more/freemium-pricing-explained
- ProductLed reporta que freemium tende a converter mais visitantes que free trials, mas a conversao free-to-paid media continua limitada: https://productled.com/blog/product-led-growth-benchmarks
- Paddle defende freemium quando o produto consegue entregar valor real gratuito e criar caminho claro para expansao paga: https://www.paddle.com/resources/freemium
