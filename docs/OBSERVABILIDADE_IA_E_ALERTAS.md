# Observabilidade de IA e alertas — 3 de outubro de 2026

## Estado e decisão

Incremento local da fase 2. Foi feita uma consulta real, somente de leitura, ao projeto explícito `mnemosyne-one`: canais de notificação, métricas de logs e políticas de alerta estavam acessíveis e as três listagens estavam vazias. A evidência privada conserva a ligação verificada ao projeto e `productionMutations=0`. Uma listagem inacessível seria marcada como indisponível, sem a interpretar como vazia.

O utilizador indicou um email operacional. O endereço fica no plano privado fora do repositório. Foram preparados um plano de canal e um plano com cinco métricas/cinco políticas, sem aplicar nenhum. As políticas do plano atual estão desativadas porque ainda não existe um canal associado. A criação/ativação pertence ao rollout autorizado depois de concluir todas as áreas; este incremento não executou deploy ou alteração de produção.

## Eventos e fronteira de privacidade

`aiOperationalEvents.ts` projeta um schema fechado de campos escalares. O servidor cria um UUID aleatório por operação e liga os eventos de reserva, tentativa de fornecedor e resultado. Modelo, fornecedor e tipo de âmbito vêm de allowlists do servidor; os motivos de resultado e estados HTTP são categorias fixas. Reserva inclui bytes UTF-8, unidades técnicas de entrada, máximo de saída, imagens e custo relativo derivados da política de admissão. Circuitos registam somente tipo/fornecedor e categoria de abertura/falha de gravação.

O schema recusa campos adicionais: UID, equipa, prompt, resposta, objeto de erro, token, URL, email, IP ou request. Nenhum deles é passado pelo chamador. O logger recebe mensagem constante e severidade, sem stack de erro. O contador não atribui custo a uma recusa antes da reserva. OPTIONS não cria eventos de geração; um erro imprevisto do handler termina com categoria constante e conserva a semântica da exceção.

Telemetria é best effort. Falha ao escrever o evento não repete uma reserva/chamada e não faz falhar o serviço. Cada observador emite no máximo um evento de cada categoria; isso não garante entrega única pelo transporte de logs. O ledger transacional continua a ser a autoridade do orçamento.

`provider_attempt` indica entrada no adapter aprovado, que ainda pode falhar antes do pedido externo, por exemplo por indisponibilidade de secrets. `success` indica construção do resultado após revalidação, sem comprovar receção pelo cliente. As unidades de entrada/custo são reservas técnicas; não são faturação, tokens efetivos ou um teto monetário. O UUID não é uma identidade do utilizador, mas permite correlacionar eventos e merece retenção limitada. Logs HTTP/metadata adicionados pela plataforma têm configuração e retenção próprias; a projeção destes eventos não prova que toda a telemetria da infraestrutura esteja sem identificadores.

## Métricas e políticas preparadas

As métricas filtram o projeto explícito, componente e versão dos eventos, em `cloud_function` ou `cloud_run_revision`. Os labels ficam limitados a tipo, fornecedor, tipo de âmbito e categoria fixa. UID, equipa e UUID de operação não são labels de métricas.

| Métrica | Conteúdo |
|---|---|
| reservations | Quantidade de reservas admitidas |
| reserved_cost_units | Distribuição de unidades relativas reservadas, com buckets explícitos |
| outcomes | Quantidade de resultados por categoria |
| provider_attempts | Entradas no adapter depois da admissão |
| circuits | Aberturas e falhas de gravação do circuito |

| Alerta | Limiar inicial numa janela de cinco minutos |
|---|---|
| Pico de custo relativo reservado | 100 unidades |
| Pico de recusas | 20 recusas de autenticação/contrato/rate limit/orçamento/admissão |
| Falhas de fornecedor | 5 falhas |
| Circuito aberto | 1 abertura |
| Infraestrutura de admissão indisponível | 3 falhas de orçamento/handler/gravação de circuito |

Os limiares são parâmetros de partida para calibração no piloto. Recusas não comprovam abuso. PromQL usa selectors com nomes UTF-8 citados, janela de cinco minutos e intervalo de avaliação de 60 segundos. O somatório da distribuição usa `_sum`. Os contratos seguem a documentação de [distribuições de métricas de logs](https://docs.cloud.google.com/logging/docs/logs-based-metrics/distribution-metrics), [PromQL no Monitoring](https://docs.cloud.google.com/monitoring/promql) e [alertas PromQL](https://docs.cloud.google.com/monitoring/promql/create-promql-alerts). Não se desativa a validação de métricas.

## Ferramenta operacional e recuperação

`scripts/ai-monitoring.js` exige Node 22 e projeto explícito. A ligação real verifica o identificador/número no Resource Manager, usa endpoints Google fixos e quota project somente no cliente efémero. Não altera o projeto global do gcloud. Os erros impressos são códigos fixos, sem resposta remota ou credenciais. As listagens têm paginação limitada e rejeitam ciclos de cursor. `audit` projeta resultados sem endereços dos canais ou conteúdos das políticas.

Preparação/consulta sem mutações:

```powershell
node scripts/ai-monitoring.js audit --project mnemosyne-one --out W:\real\mnemosyne-launch-evidence\monitoring-audit-NOVO.json
node scripts/ai-monitoring.js plan --project mnemosyne-one --out W:\real\mnemosyne-launch-evidence\monitoring-plan-NOVO.json
# channel-plan recebe --email com o endereço autorizado e grava somente o plano privado.
```

Os outputs são criados com `wx`, sem substituir evidência existente. Não guardar o plano de canal com endereço no Git.

No rollout, a aplicação é sequencial, por um único operador:

1. Rever o plano privado e executar `channel-apply --project mnemosyne-one --plan <plano-privado> --confirm-project mnemosyne-one`.
2. Relê o canal e usa a sua identidade. Se estiver UNVERIFIED, concluir a verificação exigida; o aplicador das políticas recusa um canal UNVERIFIED ou desativado.
3. Gerar um novo `plan` com `--channel projects/mnemosyne-one/notificationChannels/<ID>` e rever os limiares.
4. Executar `apply --project mnemosyne-one --plan <novo-plano> --confirm-project mnemosyne-one`. Verificar métricas/políticas relidas e configuração efetiva.
5. Executar piloto autorizado de emissão/avaliação e receção no destinatário, conservar comprovativo e calibrar os limiares. Confirmar o runtime publicado e todas as operações abrangidas.

O bootstrap do canal reutiliza somente um canal do mesmo email e proprietário de gestão. Canal de outra gestão, duplicados ou binding incompatível são recusados. Um canal desativado não é reativado silenciosamente. Após ACK perdido, a repetição lista novamente antes de criar. Não existe lock distribuído entre operadores: aplicações concorrentes ficam fora do protocolo.

O aplicador reconstrói o plano canónico e recusa alterações arbitrárias ou um plano sem canal. Antes das mutações, verifica propriedade/schema/duplicados de todas as métricas e políticas. Cria/atualiza recursos da própria gestão e relê cada um; a repetição ignora recursos já iguais e permite continuar depois de falha parcial. Não apaga recursos. A readback rigorosa pode exigir adaptação a normalizações reais da API durante o piloto, que ainda não foi executado.

O estado de verificação de um canal não comprova entrega ao destinatário; o resultado conserva `deliveryVerified=false`. A API distingue canais [UNVERIFIED e verificados](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.notificationChannels). Criações/alterações devem respeitar a aplicação sequencial dos contratos de [canais](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.notificationChannels/create) e [políticas](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies/create).

## Validação

O build TypeScript e os **168 unitários Functions** passaram em Node **22.23.3**, com um teste de rules omitido fora do emulador. Há seis casos unitários de eventos e nove de planos/aplicadores: schema/privacidade, correlação única, reservas, erros de logger, handlers inesperados, ownership/binding, tampering, paginação, readback, repetição após ACK perdido e verificação do canal. Os adapters da API Google desses testes são sintéticos; não comprovam aceitação das queries pela API real, recursos criados ou entrega de alertas.

Os dois novos testes HTTP em Firestore/Storage Emulator passaram: reserva/tentativa/resultado, autenticação, contrato inválido, erro 422/503 do fornecedor, revogação tardia, quota/rate limit e ausência de conteúdo/identidades nos eventos capturados. Os fornecedores são simulados, sem enviar conteúdo real.

A suite completa final passou **114 Functions +22 frontend de rules**, em `demo-mnemosyne-rules`, Node **22.23.3**, JBR **21**, com saída zero e emuladores terminados. Não houve falhas nesta passagem. Nenhum ficheiro frontend mudou neste incremento; os resultados gerais frontend do [incremento anterior](ORCAMENTOS_IA_E_AMBITO_GERACAO.md) conservam a cronologia e não são apresentados como nova execução.

Comandos finais: `npm --prefix functions test` (inclui build TypeScript), `node scripts/run-rules-tests.js` e a passagem focada `emulators:exec` com `node --test --test-name-pattern=ai-monitoring functions/test/rules.test.js`, sempre com Node 22/JBR 21 e projeto demo. O CLI `audit`, `channel-plan` e `plan` foi executado para o projeto explícito; somente `audit` fez pedidos externos GET. Aplicadores não foram executados contra APIs reais.

A prova `W:\real\mnemosyne-launch-evidence\ai-monitoring-local-validation-20261003.json` conserva resultados, hashes de fontes/logs e das consultas/planos privados. Assinala `releaseReady=false`, `allPhasesComplete=false`, gates fechados, zero mutações de produção e nenhum deploy. A primeira inspeção de secrets encontrou HTTP 404 nos nomes esperados; confirmou-se depois com o catálogo completo e guardou-se a primeira passagem como diagnóstico, sem tratar zeros de contadores indisponíveis como um inventário concluído.

## Pendências e rollback

Faltam aplicação e readback reais, piloto de receção, calibração, custo efetivo por fornecedor, retenção do Logging/ledgers, secrets e cobertura de operações além dos endpoints de geração. Este incremento não conclui a fase 2 nem qualquer outra fase.

Uma consulta adicional de metadata real verificou o catálogo completo de Secret Manager e sete Functions publicadas em `europe-west1`. Os cinco nomes esperados pelo código (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `NVIDIA_API_KEY`, `HUGGINGFACE_API_KEY`) não existem nesse catálogo; os dois outros secrets foram preservados sem publicar os seus nomes. As sete Functions consultadas estão ACTIVE em Node 22, sem `secretEnvironmentVariables`. Não se consultaram valores de ambiente nem payloads de secrets. Isto prova a falta da ligação pretendida para esses nomes, sem provar ausência de outras formas de configuração ou revogação nos fornecedores.

No código, `params.ts` contém placeholders e `readSecret` lê `process.env`; as exports de geração/Stripe ainda não fazem o bind previsto. O script antigo de sincronização também precisa de revisão do contexto de projeto e formato PowerShell antes de qualquer execução. Não foi executado. A próxima correção deve preparar a ligação e o preflight de migração, com valores novos/revogados provenientes do procedimento autorizado, preservando a condição de publicar apenas depois de concluir todas as áreas. A inspeção usou somente os contratos de [metadata de versões](https://docs.cloud.google.com/secret-manager/docs/view-secret-version) e [configuração de Functions](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions); nunca o endpoint `:access`.

Rollback da configuração exige plano revisto com os identificadores criados: desativar as próprias políticas, preservar métricas/evidência e canais partilhados, verificar readback. Não há eliminação automática no CLI. Rollback de código usa a revisão anterior e mantém os ledgers transacionais; logs já emitidos permanecem sujeitos à retenção da infraestrutura. Falha parcial conserva os recursos já aplicados e é retomada após inspeção, sem apagar counters ou abrir gates para recuperar disponibilidade.
