# Catálogo Stripe do Mnemosyne — 22 de outubro de 2026

## Decisão do operador e resultado confirmado

O operador autorizou configurar os preços na conta **WGF Technologies**, em **produção**, e definiu Pro a **7,99 €/mês** e Sovereign a **29,99 €/mês**, como preços finais com IVA incluído quando aplicável. A ligação Stripe foi reautenticada e a conta foi confirmada antes das operações.

| Plano | Produto reutilizado | Novo preço mensal | Valor em cêntimos |
|---|---|---|---|
| Pro | `prod_VRQup9MBktJ6O0` | `price_1UTRBUGT8PzxsiroB6XS3Uyj` | 799 |
| Sovereign | `prod_VRQuCooZyMotiZ` | `price_1UTRBeGT8Pzxsiro507V5HKj` | 2999 |

Ambos os preços estão ativos, em EUR, com `recurring.interval=month`, `interval_count=1`, `usage_type=licensed` e `tax_behavior=inclusive`. São os preços por omissão dos respetivos produtos. O produto Business foi renomeado para **Mnemosyne Sovereign**, com descrição alinhada; o seu ID foi conservado.

Foram cinco pedidos de mutação Stripe: dois novos preços, duas atualizações de preço por omissão/metadata/nome e uma atualização da descrição Sovereign. Não foram criados produtos duplicados, cobranças, invoices, sessões Checkout ou migrações de subscrições. Uma nova leitura dos dois produtos e preços confirmou os valores e a associação. A releitura dos preços de cada produto confirmou que os quatro preços anteriores continuam ativos e conservam valor, moeda, recorrência e comportamento fiscal.

Os valores anuais ficaram pedidos ao operador, ainda sem resposta. Não foi criado preço anual nem escolhido um desconto. Os valores anuais antigos não são apresentados como a nova oferta aprovada; a opção anual fica indisponível na configuração candidata até haver valores e bindings próprios.

## Código e configuração candidatos

- `frontend/src/config/billingPrices.ts` centraliza os valores mensais em cêntimos, moeda e comportamento fiscal. A página de preços e o modal usam a mesma fonte; os anteriores 9,99 €/12 € e 29 € deixaram de divergir.
- O frontend apresenta a indicação de IVA incluído quando aplicável. A alteração não modifica as flags de monetização/checkout.
- `functions/.env.mnemosyne-one` contém apenas quatro entradas públicas: os dois novos IDs mensais e duas listas de IDs históricos para preservar os respetivos tiers. O ficheiro foi criado para o rollout; não contém chaves ou webhook secrets. Os ficheiros dotenv antigos não foram copiados nem alterados.
- O backend continua a escolher o preço Checkout a partir do plano e intervalo definidos pelo servidor. Os IDs históricos só participam no reconhecimento de subscrições; não são opções de novas compras. Uma atribuição do mesmo preço a dois tiers resulta em `free`, sem promover permissões. As listas históricas são JSON, limitadas a 100 IDs por plano/16 KiB e recusadas integralmente se inválidas.

A configuração conserva os quatro IDs históricos da conta confirmada. Não certifica subscrições noutros projetos/contas ou preços que não foram inventariados. Não foi executado deploy nem alterada a configuração remota de Firebase.

## Validação

- **23 testes Functions**: tiers atuais/históricos, conflitos entre tiers, parsing limitado, reconciliação por configuração, webhooks, redirects e política de secrets; zero falhas/omissões na passagem final.
- **3 testes frontend**: preços apresentados na página/modal, indicação fiscal e conservação da indisponibilidade de checkout no cenário Founder Preview simulado.
- Builds Functions e frontend/TypeScript aprovados. Lint dos quatro ficheiros frontend afetados: zero erros/avisos.
- A primeira passagem frontend teve duas aprovações/uma falha de visibilidade durante a animação faseada dos cartões. O teste passou a aguardar também o cartão Sovereign visível, conservando o assert de visibilidade e o timeout. O log inicial foi guardado; a passagem final aprovou os três casos.
- As suites gerais e de regras anteriores são baseline histórico; não foram repetidas para esta alteração. Não foi ensaiada uma compra real ou sandbox, nem recebida uma entrega real de webhook.

Evidência: `W:/real/mnemosyne-launch-evidence/stripe-catalog-preparation-20261022/`. O plano aprovado e o readback registam só catálogo/configuração pública; não contêm credenciais.

A conferência de continuidade encontrou uma alteração não planeada em `docs/AUDITORIA_CHAVES_FIREBASE.md`, de origem não estabelecida. O ficheiro foi conservado e ficou fora das fontes certificadas deste incremento, com os hashes esperado/observado registados. Não foi reconstruído um before-image nem promovida essa alteração a conclusão da auditoria de chaves. As restantes fontes abrangidas pela prova anterior foram comparadas; isto não certifica o checkout completo.

## Pré-requisitos restantes

O catálogo está configurado na Stripe. O checkout completo continua a exigir os novos secrets `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` em Secret Manager, bindings/IAM, validação do webhook e rollout coordenado depois das restantes fases. Preferir uma chave restrita com as permissões necessárias, conservada diretamente em Secret Manager.

`tax_behavior=inclusive` define como interpretar o preço; não ativa por si só Stripe Tax ou registos fiscais. Não se alterou `automatic_tax` nem se criou um registo. Antes de ativar cálculo/recolha automática, verificar a configuração fiscal aplicável e os registos ativos, conforme a [documentação Stripe Tax](https://docs.stripe.com/billing/taxes/collect-taxes).

Rollback de catálogo: os preços por omissão anteriores estão no plano guardado. Repor esses IDs nos produtos não migra subscrições; conservar os recibos/IDs históricos no backend durante qualquer rollback. Não apagar os preços novos que já tenham sido usados em subscrições e não retirar o reconhecimento dos preços anteriores.

**Todas as fases 0–6 continuam exigidas. Os 49 gates permanecem fechados. Catálogo configurado não significa checkout publicado ou lançamento concluído.**
