# Publicação recuperável de sincronização — 4 de outubro de 2026

**Atualização posterior:** [RECONCILIACAO_METADADOS_SYNC.md](RECONCILIACAO_METADADOS_SYNC.md) corrige equivalência/remoção de metadados na importação. Os resultados abaixo conservam a evidência da etapa de publicação; as alterações posteriores têm prova própria.

## Âmbito e estado

Implementados envio pessoal com ID/cifra estáveis, journal cifrado, quota transacional e confirmação independente dos gates de escrita, integrados com a [importação por lotes](IMPORTACAO_CIFRADA_SYNC.md). O lançamento completo permanece condicionado às fases 0–6, migrações, pilotos e artefactos finais. Não houve deploy, escrita de produção ou chamada real a fornecedor.

`MOBILE_SYNC_WRITES_ENABLED` e `MOBILE_SYNC_IMPORT_ENABLED` continuam fechados. Publicação/importação partilham o gate backend; não há novo switch. Consulta/cancelamento recuperam pedidos existentes com gates fechados, verificando conta/cofre/recibo. A interface não faz pedidos automáticos.

## Pedido e admissão atómicos

Callables em `europe-west1`, sem secrets: `publishMobileSyncEnvelope`, `getMobileSyncPublicationStatus`, `cancelMobileSyncPublication`. O pedido contém exatamente ID, dispositivo, direção, tipo, chave pública ECDH, cifra AES-GCM, contagem, IDs tombstonados, expiração e hash esperado do dispositivo. UID, conteúdo pessoal, chave privada e campos arbitrários são recusados. Limites: 2500 memórias, 900 mil caracteres de cifra e expiração até sete dias. Mobile publica deltas com a chave pública registada; desktop usa um par efémero para enviar ao dispositivo.

A transação verifica perfil ativo/marcador permanente de eliminação, dispositivo ativo/pertencente à conta/chaves atuais e quota. Cria juntos:

- `mobileSyncEnvelopes/{envelopeId}`: cifra e metadata restrita.
- `mobileSyncPublications/{envelopeId}`: recibo imutável ligado a UID/dispositivo/direção/ID/hash do pedido.
- `mobileSyncBudgets/{uid_YYYY-MM-DD}`: admissão diária UTC por conta.

A política operacional local permite **100 envelopes e 20 MiB do JSON da cifra por dia/conta**, independentemente do plano; rate limit de **20 chamadas por minuto por UID/modo**. Replays confirmados não consomem quota, não recriam envelopes ausentes e não aceitam outro pedido com o mesmo ID. Os limites exigem calibração no piloto; não são medições de faturação real.

As regras recusam toda a criação direta pelo cliente. Receipts de publicação/cancelamento, budgets e receipts de importação são privados ao servidor. A leitura do envelope exige o proprietário. Conserva-se a transição terminal de expiração existente, sem alterar payload e apenas antes da primeira importação. ACK/delete/recriação continuam recusados.

## Publicação, importação e cancelamento

Publicação confirma a admissão do envelope. O remetente conserva o journal até consultar o recibo agregado de importação `complete`, ou confirmar cancelamento antes da primeira importação. A interface apresenta contadores reais, incluindo conflitos; publicar não significa que as memórias foram importadas.

`mobileSyncPublicationCancellations/{envelopeId}` impede publicação tardia de um pedido desconhecido. Cancelamento e primeiro lote serializam nas mesmas leituras transacionais. Existindo qualquer progresso, cancelar devolve esse progresso sem apagar/cancelar o envelope ou devolver quota. Cancelamento anterior à importação conserva recibo/cifra no servidor e não atualiza o índice confirmado.

`queued`, `pending`, `expired` e `unavailable` conservam o journal. Expiração não demonstra importação. Cifra desaparecida sem recibo de importação não é recriada automaticamente: exige reconciliação/restauração. Retenção/expiração/purge geral ainda não estão concluídos.

## Journal e índice cifrados

O cliente usa Web Locks e localStorage:

```
mnemosyne:sync-outbox:v1:<UID codificado>:<deviceId codificado>:<direção>
mnemosyne:sync-index:v1:<UID codificado>:<deviceId codificado>:<direção>
```

Ambos guardam apenas envelopes cifrados pela chave do cofre. O journal conserva pedido imutável, fingerprints por ID e hash da versão cifrada do índice anterior. O índice liga UID/dispositivo/direção e conserva até dez mil IDs/fingerprints e o último recibo aplicado. Máximos locais: dois milhões de caracteres decifrados/quatro milhões serializados. Falha de storage/cifra/readback impede publicação.

Builders excluem memórias estrangeiras, de equipa, partilhadas e ambíguas antes da serialização. Conteúdo pessoal bloqueado impede envio. O payload inteiro é validado e copiado antes de cifra/journal/rede; último registo malformado impede o primeiro envio. Timestamps ausentes não são substituídos pela hora de publicação. Deltas exigem revisões positivas; dados legados sem revisão válida precisam de migração.

O cursor global de datas foi substituído por fingerprints de conteúdo/metadata de cada memória. Edições na mesma data, timestamps iguais e memórias antigas que aparecem depois continuam selecionáveis. O cursor wire é uma propriedade validada do conjunto (`since:0`, máximo das revisões), sem servir de prova de entrega.

Há um envio pendente por conta/dispositivo/direção. Edições durante esse envio ficam no cofre e serão selecionadas depois da confirmação. ACK perdido retoma o mesmo ID/cifra, sem nova captura. O índice só avança depois de duas confirmações concordantes de importação completa e comparação da versão anterior. Se a atualização terminar mas a remoção do journal falhar, o último recibo do índice permite confirmar a remoção sem reaplicar fingerprints.

Guardas de Auth/cofre permanecem latched em todos os awaits, mesmo após regresso ao estado inicial. Eventos de revogação/troca de chaves ficam latched durante nova publicação. Substituições do journal/índice não são sobrescritas por respostas tardias. Confirmação histórica completa recupera sem exigir dispositivo ainda ativo.

## Interface e eliminação de conta

Settings desktop e página mobile oferecem retomar/cancelar envio e confirmar importação pendente. A confirmação de importação só consulta o recibo: não decifra payload de origem nem inicia lote com gate fechado. O cofre precisa de estar desbloqueado; ações ficam desativadas durante a operação e feedback tardio é descartado após troca de conta/cofre/vista. Erros privados não são apresentados.

Eliminação de conta inclui as três coleções novas por UID e os dois prefixes locais com fronteira exata. Receipts/journals de outras contas e IDs com prefixo semelhante são preservados. Piloto real de Auth/Stripe/Storage/restauração permanece necessário.

## Evidência e limites

Unitários exercitam contratos e falhas com dependências sintéticas. O emulador testa transações concorrentes/regras reais exclusivamente em `demo-mnemosyne-rules`. Chromium executa clientes de publicação **e** importação, ECDH/AES-GCM nas duas direções, cofre, storage e Web Locks reais contra RPC sintética localhost. Cobre ACK de publicação perdido/nova aba, lotes, confirmação com gate fechado/dispositivo revogado, índice cifrado, mesma revisão conservada como conflito, texto Unicode grande e isolamento conta/cofre. Não prova Firebase Auth/App Check/RPC de produção, transporte nativo ou todos os dispositivos. Foi acrescentado à CI; execução remota continua sem prova.

A primeira suite completa de regras teve 129 casos aprovados e uma falha no fixture novo: Timestamp Admin passado ao SDK cliente, recusado antes das regras. O fixture foi corrigido sem abrir a criação. O parser da publicação teve uma comparação de campos ordenados incorreta, corrigida antes dos sete unitários backend aprovados. Logs anteriores são conservados na evidência privada.

Resultados finais: **625 testes gerais frontend /117 ficheiros**, **194 unitários Functions /uma suite ignorada fora do emulador**, **130 Functions +22 frontend na repetição completa do emulador**, dois ensaios Chromium, builds Functions/web, lint **zero erros/23 avisos anteriores** e quatro testes de scripts de deploy. A passagem geral frontend antecede apenas o ajuste final de representação do feedback; **51 testes focados /seis ficheiros**, build/lint e Chromium finais passaram depois. O segundo ensaio Chromium comprova a confirmação de importação com gate fechado sem nova decifragem da origem/dispositivo ativo. Sintaxe/YAML/diff e correspondência do bootstrap gerado passaram. O preflight real verificou **17 gates/dez ficheiros fechados** e recusou publicação com exit 2.

Fontes/logs/artefactos com hashes ficam em `W:\real\mnemosyne-launch-evidence\mobile-sync-publication-local-validation-20261004.json`, mantendo `releaseReady=false` e `allPhasesComplete=false`. Provas anteriores são históricas e não foram sobrescritas. O [estado de lançamento](ESTADO_LANCAMENTO_COMPLETO.md) mantém os critérios de todas as fases.

## Trabalho restante para concluir sincronização

Retenção/expiração/limites de retoma; migração de envelopes/instalações antigos sem recibo; dispositivo perdido/descoberta noutro dispositivo; múltiplos envios/background/push/quotas calibradas; metadata sem mudar texto/conexões/tombstones em todos os escritores; grandes cofres/matriz web/Tauri/Capacitor/Android; store nativo/pairing e pilotos de Auth/App Check/rede/offline/revogação/restauração. O índice é local à instalação: outra instalação pode reenviar dados, reconciliados pelo importador. Obsidian, escritores semânticos e demais fases continuam em execução.

Reversão fecha novas escritas e conserva journals/receipts/cifra. Não restabelecer criação direta/ACK fabricado, apagar receipts ou gerar novos IDs/cifras para ocultar confirmação perdida. O deploy completo já autorizado só ocorrerá depois de comprovar todos os critérios e artefactos finais.
