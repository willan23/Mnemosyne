# Associação recuperável de anexos — 1 de outubro de 2026

Atualização posterior: journal e recuperação do envio, download local e criação inicial durável implementados em [RECUPERACAO_ENVIOS_E_CRIACAO_ANEXOS.md](RECUPERACAO_ENVIOS_E_CRIACAO_ANEXOS.md). As pendências/evidências abaixo descrevem o estado do bloco de associação antes dessa atualização. Purge, plataformas, piloto real e demais gates continuam necessários.

## Âmbito e estado

Implementação local para adicionar/retirar objetos cifrados `ready` de uma **memória existente**, com comparação da revisão, histórico exato e confirmação recuperável. A barra lateral CognitiveSidebar usada pelo App e o componente MemoryDetail oferecem confirmação explícita, recuperação e cancelamento. Ficheiros enviados são apresentados como ainda por associar até ao ACK.

`ATTACHMENT_ASSOCIATIONS_ENABLED=false`, `ATTACHMENT_WRITES_ENABLED=false` e `TEAM_WRITES_ENABLED=false`. Não ocorreu deploy nem mudança de dados, regras, configuração ou objetos de produção. Este bloco não conclui todas as fases nem permite abrir uploads: criação inicial com anexos, recuperação de upload e ciclo de eliminação continuam por fechar.

## Contrato, privacidade e autorização

`mutateSessionAttachments` recebe exclusivamente `operationId`, `sessionId`, `action:add|remove`, `ids`, `expectedRevision` e `expectedStateDigest`. IDs são UUID v4 canónicos, únicos, no máximo vinte; campos adicionais são rejeitados. O parser ordena os IDs e os campos do pedido antes do digest do recibo.

O digest SHA-256 do estado liga sessão, UID, âmbito, época/keyId, cifra, revisão e lista completa de anexos. Ordenação de chaves é lexical binária, igual em Node e browser. A revisão aceita números ou Timestamp do Firestore. Uma lista alterada sem atualizar cifra/revisão invalida o pedido anterior. O pedido não contém texto, título, ficheiro, nome original ou chave.

A transação verifica conta viva, sessão viva e pertença atual. Pessoal exige autor/caller/cofre iguais e `teamId:null`; partilha não fornece a chave pessoal. Equipa exige wrap atual, gate de escrita, época ativa consistente, ausência de rotação pendente e cifra v2 da época ativa. Todos os registos envolvidos, incluindo referências cifradas conservadas, têm de estar `ready`, no bucket configurado e no mesmo âmbito. Novas associações de equipa exigem a época/keyId da memória; referências históricas já presentes podem ser conservadas. A leitura continua a exigir o wrap histórico específico.

Novas associações em modo pago exigem `canUploadAttachments=true`; repetir uma referência existente ou retirá-la não consome novo upload nem exige esse entitlement. A operação não soma bytes às quotas, pois estes foram cobrados na publicação do objeto. Referências legadas existentes são conservadas sem conversão. A API não permite adicionar referências legadas arbitrárias.

O cliente exige consentimento antes de qualquer leitura remota, chamada ou preparação do pedido. `never-cloud`, políticas desconhecidas e confirmação recusada fazem zero pedidos. Conta, cofre, política e geração das chaves de equipa são capturados e verificados depois de cada espera. Um pedido já enviado pode terminar no servidor depois da perda de contexto; o cliente não anuncia esse ACK tardio como sucesso. Não se declara revogação retroativa de uma operação de rede.

## Histórico, recibos e concorrência

Uma transação lê ACL, recibo, revisão/digest e registos de objetos antes de escrever. Ao mudar a lista, cria `sessions/{sessionId}/versions/{operationId}` com a cifra e metadados anteriores exatos, atualiza anexos/revisão/pointers do parent e cria o recibo. UID, timestamp, texto/cifra e ligações do parent não são substituídos. Colisão de versão aborta todos os writes.

`attachmentMutations/{operationId}` é server-only, sem TTL, com `v:1`, UID, sessão, digest do pedido, estado e `createdAt`. Um recibo `committed` inclui `updatedAt`, `versionId` e `changed`; `versionId` é o UUID da operação quando houve mudança e null quando foi no-op. Repetir o mesmo pedido devolve o mesmo resultado sem criar outra versão. Outro payload com esse UUID falha. Recibos nunca são a autoridade de leitura: recuperação verifica novamente conta/sessão/pertença atuais.

`getAttachmentMutationStatus` funciona com o gate de escrita fechado e devolve `committed`, `cancelled` ou `unknown`. **Unknown não prova cancelamento nem que um pedido em trânsito não irá gravar.** O cliente conserva o pedido e pode repetir exatamente o mesmo UUID/CAS quando o gate permite.

`cancelSessionAttachmentMutation` também funciona com o gate fechado. A transação cria um recibo permanente `cancelled` ou devolve o `committed` já existente. A disputa com o commit serializa no mesmo documento: cancelamento vencedor impede retries tardios mesmo depois de reabrir gates; commit vencedor é apresentado como confirmado. Não há remoção local silenciosa de um pedido ambíguo.

## Journal e interface

O journal local usa o cofre pessoal para cifrar `{v,uid,sessionId,request}` e é separado por UID/sessão. Não contém chave de equipa, bytes, texto da memória ou URL de leitura. Os IDs/digest do pedido ficam dentro da cifra. Na leitura verifica envelope, limites, schema, UID/sessão e pedido estrito. Transplantes ou corrupção deixam a operação fechada e conservam o journal.

Web Locks serializa o journal por conta/memória entre tabs. Browser sem suporte ou lock ocupado falha antes de gravar. `setItem` e leitura de confirmação precedem a chamada remota. Falha/quota de storage não permite enviar um pedido sem checkpoint. Recuperação consulta o recibo primeiro; uma confirmação exata permite limpar o journal, um estado unknown exige retry/cancelamento. Um novo intento diferente não substitui o pendente. Remoção local só ocorre depois de resultado terminal válido e com o contexto atual.

O painel do detalhe da memória mostra ficheiros enviados como ainda por associar e não altera otimisticamente o documento. Um pedido pendente substitui os controlos de novas alterações por recuperar/cancelar. Estes controlos permanecem disponíveis quando o gate de novas escritas fecha; cofre bloqueado impede a operação. Retirar uma referência pede confirmação e conserva o histórico; não afirma eliminar o objeto. Respostas de outra vista, de uma vista desmontada ou de contexto invalidado não geram toast de sucesso.

## Schema, regras, migração e rollback

Coleção nova `attachmentMutations`, proibida aos clientes em leitura/escrita; operações consultam documentos por ID, sem índice composto novo. Pointers `lastVersionId`/`lastAttachmentMutationId` no parent são auxiliares e não autorizam acesso. O recibo Admin e a transação são a autoridade. As regras atuais continuam a congelar novos anexos e só permitem creates sem anexos; esta API não reabre writes diretos.

Não há backfill nem conversão implícita de referências existentes. Publicação futura coordena código do cliente, Functions de associação/status/cancelamento, regras server-only e gates com o pipeline completo. Rollback fecha novas mutações e conserva status/cancelamento, recibos, journals e histórico. Não se apagam recibos para permitir reutilizar um UUID nem se remove um journal ambíguo para esconder um conflito.

## Evidência local

Exclusivamente identidades, documentos e bytes sintéticos. Em Node 22.23.3/JDK 21, a suite completa do emulador passou **41 testes Functions + 22 frontend** após a associação pessoal/equipa. Depois da adição de cancelamento, o run focado passou **7 testes de anexos** em Firestore real do emulador, incluindo disputa commit/cancelamento e tombstone permanente. Adaptadores GCS permanecem simulados.

Functions `npm test` compilou e passou **107 testes**, com uma suite de regras ignorada fora do emulador. Os testes focados frontend passaram **14 testes**: oito do journal com cifra AES-GCM real, quatro do painel e dois do detalhe existente. Exercitam zero pedidos com privacidade negativa, persistência anterior à rede, perda de ACK, retry exato, gates fechados, corrupção/transplante, contexto perdido e feedback sem falso cancelamento. TypeScript encontrou uso de parameter property incompatível com `erasableSyntaxOnly`; foi corrigido para propriedade explícita.

A suite completa frontend passou **424 testes em 94 ficheiros**, em Node 22, 69,50 segundos. Na verificação de integração identificou-se que MemoryDetail não era o detalhe usado pelo App: o painel foi ligado também a CognitiveSidebar. Depois dessa ligação, os **14 testes focados** e lint do escopo passaram novamente. O build final TypeScript/Vite passou com **3231 módulos** e o JS produzido contém os controlos de cancelamento/journal. Lint completo final: **zero erros e 23 avisos preexistentes**. Um aviso novo de ref no cleanup foi corrigido antes dessa execução final. Permanecem os avisos de imports mistos/chunks grandes do build. `git diff --check` do escopo rastreado passou; isto não declara o diff inteiro do repositório limpo.

## Próximos gates obrigatórios

- Criação inicial durável da memória e associação sem duplicar a memória depois de reload/ACK perdido; adaptar CognitiveInput e persistLearnedMemory antes de abrir anexos.
- Journal do próprio upload, estado verifying e recuperação de reservas/objetos ready depois de reload; este journal cobre apenas a associação.
- Referências históricas, eliminação publicada, órfãos ready, quotas e purge de conta/equipa. Conservar objetos não substitui implementar esse ciclo.
- Piloto GCS real, CORS/IAM/plataformas/App Check, backup dos bytes/metadados e restauração isolada, migração de tokens/referências legados.
- Auditoria dos restantes endpoints e conclusão dos gates de todas as fases do prompt mestre antes do deploy completo autorizado.
