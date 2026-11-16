# Compactação de vetores de equipa: núcleo recuperável — 16 de novembro de 2026

## Problema, opções e decisão

As novas escritas já persistem embeddings numéricos como JSON, mas os arrays históricos continuam a ocupar espaço na cache. O percurso pessoal de compactação não autoriza documentos de equipa. Estender esse percurso sem verificar membros, wraps e época ativa deixaria a operação desligada da revogação e da rotação existentes.

Foi preferido acrescentar os comandos estritos `change:{kind:'compact'}` e `change:{kind:'rollback',versionId}` ao protocolo de revisão de equipa. As revisões de conteúdo conservam o seu contrato anterior, sem novo discriminante obrigatório. Evita-se criar outros endpoints, recibos ou journals com regras de eliminação/recuperação divergentes. Uma edição de conteúdo com reencriptação apenas para converter o vetor teria alterado o ciphertext e a época histórica sem necessidade; a operação de armazenamento deriva o valor atual no servidor.

Este incremento implementa e valida o contrato, a transação e o serviço cliente. **Ainda não acrescenta a revisão/confirmar por lotes na interface das equipas. A compactação de equipas não está concluída para lançamento.** Os exports do cliente ficam atrás do gate de equipa já existente, fechado. Não há conversão de dados de produção.

## Contrato e autorização

O novo pedido contém somente nonce, baseline e comando. Rejeita vetor, modelo, ciphertext, UID adicional, versão de outro protocolo e propriedades extra. A baseline continua a ligar sessão, equipa, autor, owner, revisão/hash do documento, hash da equipa, hash da época ativa e identificadores das épocas atual/histórica. Pedidos de revisão de conteúdo continuam a ter `enc`, `priorEnc` e metadata e não podem misturar os dois formatos.

O executor usa as verificações existentes de conta viva, membership, wraps da época ativa e estado sem rotação pendente. Owner, admin e member mantêm a autoridade de revisão existente; um ex-membro não ganha autoridade para novas operações. Antes da escrita, confere novamente as versões do documento, equipa e época dentro da mesma transação. Uma alteração seguida da reposição dos valores anteriores continua a falhar pelo updateTime. O switch operacional `config/teamSecurity.writesEnabled` e o gate de release `TEAM_WRITES_ENABLED` mantêm-se.

A operação recusa tombstones, escopo ambíguo, campos legados de conteúdo em claro e partilha adicional. O servidor lê o vetor e modelo atuais, valida os limites do parser comum e permite compactar apenas um array finito e não vazio. Marcadores de modelo ausentes, null ou desconhecidos são conservados. Não se gera um embedding, não se rotula um modelo e não se reencripta a nota.

## Commit, quotas e rollback

A compactação muda apenas `embedding`, `updatedAt` e `lastVersionId`. `enc`, autoria, timestamp original, chave/época, relações, learning e os restantes metadados conservam-se. O arquivo em `sessions/<id>/versions/team-revision-<nonce>` contém a representação anterior exata e um marcador `teamEmbeddingIndex:{v,kind,operationId,contentDigest}`. O digest liga o arquivo ao mesmo autor, equipa, ciphertext e identificadores históricos da chave. Um rollback de outro conteúdo ou escopo é recusado.

O rollback lê somente os campos do índice no arquivo validado e repõe presença, ausência, null, array ou JSON conforme a before-image. Não restaura conteúdo, chave, relações ou metadados alheios. Arquiva o estado anterior ao rollback, pelo mesmo protocolo. São aceites somente marcadores de compactação/rollback deste percurso e o nonce tem de corresponder ao ID da versão.

Arquivo, alteração atual, recibo, auditoria e budgets são escritos atomicamente. Um nonce repetido devolve o mesmo recibo sem novo consumo de quota. Recibos terminais do próprio actor podem ser confirmados após remoção ou rotação, sem nova leitura/escrita de conteúdo. Com recibo ausente e revogação permanente, o executor não recria referências. Cancelamento conserva o comportamento de revisão existente e não modifica conteúdo ou cria auditoria de alteração.

Reutilizam-se os limites de 200 revisões por actor/equipa/dia e 1.000 por equipa/dia, com 20 MiB/100 MiB nos buckets de bytes existentes. Para comandos de armazenamento, o campo histórico `cipherBytes` recebe uma cobrança conservadora: pelo menos as duas cópias de ciphertext e os bytes canónicos do arquivo completo mais o índice substituto. Assim, o comando pequeno não contorna o orçamento dos dados escritos. Revisões de conteúdo mantêm o cálculo anterior; os comandos concorrem nos mesmos contadores. Não se aumentaram limites para acelerar a migração.

A auditoria usa `embedding_storage_compacted` ou `embedding_storage_rolled_back`, sem vetor ou ciphertext. Não se regista um evento de supersede/index semântico para uma mudança de representação. O histórico completo pode aproximar-se do limite de documento Firestore; uma rejeição do serviço permanece atómica e o journal permite confirmar/cancelar sem fingir sucesso.

## Recuperação no cliente

`compactTeamStoredEmbedding` e `rollbackTeamStoredEmbedding` usam o journal cifrado de revisão de equipa, nonce único e confirmação independente por status. Capturam a baseline e o comando por valor antes de aguardar. Não chamam preparação de IA, não obtêm a chave para reencriptar e não enviam conteúdo decifrado. O envelope é relido e comparado com o pedido exato antes de persistir ou admitir a operação; esta verificação protege também as revisões de conteúdo.

O journal bloqueia uma nova operação até confirmação/cancelamento. Uma resposta perdida conserva o pedido. A recuperação terminal funciona com admissão fechada, sem novo nonce ou `apply`. Mudança de conta, cofre, geração de chave da equipa, storage ou vista retira a operação e impede um sucesso tardio; não apaga o pedido pendente. A recuperação existente pode encerrar um pedido revogado, conservando o rascunho local.

Clientes antigos não reconhecem o novo formato do journal. O rollout deve manter os writers fechados até que o cliente compatível esteja distribuído; não iniciar novos comandos com um cliente antigo e não remover um journal desconhecido. A eliminação de contas/equipas continua a abranger recibos, budgets e auditoria nas coleções já existentes.

## Verificações e limites

Os testes focados verificam comandos positivos owner/admin/member, preservação de coordenadas/época/modelo, before-images, rollback e recibos idempotentes. Casos negativos cobrem remoção, rotação, wraps ausentes, marcadores de eliminação, shared/tombstone/escopo ambíguo, ABA de documento/equipa/época, vetores inválidos, quotas e colisões de arquivo/auditoria. O cliente verifica zero preparação/reencriptação na compactação, ACK perdido, recuperação fechada, referência de rollback estrita, scope ABA e divergência do journal cifrado.

A primeira execução focada falhou porque o teste de vetor não finito esperava a rejeição apenas no apply. A preparação já o recusava ao calcular o digest canónico. A asserção passou a incluir preparação e apply, mantendo a exigência de zero escritas. Fonte inicial e logs foram conservados; não houve alteração do produto para aceitar esse vetor.

Passaram 2.481 testes frontend/254 ficheiros, 34 focados/1, 644 testes backend (um teste de Rules omitido no comando sem emulador), build TypeScript/backend/frontend e identidade, lint zero erros/21 avisos anteriores, 51 testes Node de recuperação e 23 contratos de release. Todos os oito comandos formais terminaram com saída zero. O ensaio local confirmou quatro compactações, um rollback e um cancelamento, cinco recibos committed/um cancelled e cinco auditorias; o total dos contadores era cinco antes de semear o cap sintético de quota. As Rules recusaram leituras de ex-membro/estranho, leitura de recibo e escritas diretas em documento/histórico. Foram confirmados três aborts ABA, nota partilhada excluída e preservação de todos os modelos/ciphertexts/épocas. Os cinco ports ficaram livres.

Resultados finais das suítes, ensaio local e hashes ficam na prova `team-embedding-storage-local-validation-20261116.json`. O ensaio usa dados sintéticos, Auth/Firestore/Rules locais e o executor após verificação do token. Não testa a callable HTTP, App Check ou o rate limiter desse transporte; não abre gates das fontes. Os testes de UI por lotes, disponibilidade de produção, 100.000 notas e aplicação/dispositivos completos continuam pendentes.

## Schema, rollout e reversão

Não há coleções, endpoints, índices, Rules, TTL ou dependências novos. Há novos valores de comando no contrato existente, o marcador `teamEmbeddingIndex` nos arquivos e dois tipos de auditoria. O campo `cipherBytes` do budget existente passa a poder incluir o custo conservador do arquivo de um comando de armazenamento. Nenhuma configuração de produção foi alterada.

Rollback de código: repor as fontes preservadas e recompilar frontend/functions, mantendo o gate fechado. Resolver os journals do novo formato com um cliente compatível antes de regressar a um cliente antigo. Rollback de dados: confirmar uma versão de índice validada pelo executor; não restaurar em massa ciphertext ou metadados através de cópias manuais. Não se executou nenhuma destas operações em produção.

Continuam a interface de revisão/confirmar por lotes de equipa e o ensaio integrado desse percurso; qualidade independente por idioma/modelo; heap/latência e SDK online de 100.000 notas; churn, falhas e dispositivos completos; instaladores finais e rollout/migrações/índices/TTL/alertas/bindings. Inferência paga e CI remota aguardam a ação já combinada com o operador. Fases 0–6 incompletas, 49 gates falsos, PR em rascunho, sem merge/deploy.

## Comandos

~~~powershell
node functions/node_modules/typescript/bin/tsc --project functions/tsconfig.json
node frontend/node_modules/typescript/bin/tsc -b frontend/tsconfig.json
node --test functions/test/teamEmbeddingStorage.test.js functions/test/teamRevisions.test.js
node frontend/node_modules/vitest/vitest.mjs run --root frontend src/services/teamRevisionRecovery.test.ts --maxWorkers=1
npm --prefix functions test
npm --prefix frontend run lint
npm --prefix frontend run build
node scripts/check-build-version-identity.cjs
node frontend/node_modules/vitest/vitest.mjs run --root frontend --maxWorkers=1
node --test scripts/retrieval-eval.test.cjs scripts/retrieval-coevidence.test.cjs scripts/retrieval-evidence-graph.test.cjs scripts/retrieval-answerability.test.cjs
node --test scripts/desktop-release-entrypoints.test.cjs scripts/release-gates-preflight.test.js scripts/secret-scan-policy.test.cjs
node W:/real/mnemosyne-launch-tools/run-team-storage-emulator-20261116.cjs attempt-transactions
~~~

Os helpers recusam nomes de tentativa já usados; a reprodução exige um diretório privado novo e outro nome `attempt-`. O relatório de validação distingue a falha inicial das execuções aprovadas e conserva os comandos exatos.
