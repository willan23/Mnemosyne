# Corte local das mutações SDK de memórias — 19 de outubro de 2026

## Contrato e âmbito

As regras locais recusam create/update/delete de `sessions`, `sessions/{id}/versions`, `relationSuggestions`, `users/{uid}/memories` e `mobileSyncEnvelopes`. A recusa inclui escritas sem diferença, batches de memória/histórico, propostas aceites pelo cliente, conversão de plaintext e expiração terminal de envelopes. As leituras autorizadas mantêm-se. `notifications` conserva o seu contrato separado de leitura, estado e remoção pelo destinatário; este incremento não declara todas as escritas Firestore proibidas.

Foram retirados `memoryDeletion.ts`, `teamSessionPersistence.ts` e `teamConnectionsLegacy.ts`. O contexto de manutenção do histórico já não depende do escritor retirado. `teamsService` usa o import estático existente para leituras de servidor. O controlo AST `scripts/sdk-mutation-boundary.js` recusa imports/reexports de mutações modulares, imports opacos, compat e carregamento dinâmico do SDK no runtime TS/JS de `frontend/src`. Está integrado no job frontend de CI. É um controlo estático com âmbito explícito; as regras e a autorização nos executores continuam a decidir os pedidos.

O primeiro controlo encontrou uma quarta admissão que o inventário anterior, limitado ao grafo estático, não detetara: `SettingsModal` importava `deleteDoc` dinamicamente. O fluxo de identidade passou a usar leituras paginadas e o protocolo existente `memoryEditRecovery`, com preparação, cifra/journal local, recibo e histórico no servidor.

## Reinício da identidade

Há duas ações explícitas. O reinício local conserva as memórias e requer confirmação de que as palavras antigas serão guardadas. A remoção seguida de reinício exige o gate de revisões pessoais e cofre aberto. Consulta páginas de 20, constrói em memória um plano de IDs/digests e confirma a contagem antes da primeira mutação. Recusa âmbito estrangeiro, misto ou ambíguo, cursor repetido e fontes com campos legados não suportados. Limita cada varrimento a 10.000 registos e o manifesto a 8 MiB.

Cada fonte é relida e comparada com o plano, decifrada apenas localmente e removida pelo protocolo de recibo por documento. Há pausa entre documentos. Mudanças de conta/cofre, vista fechada, fonte alterada, gate fechado, operação pendente ou confirmação incerta interrompem o lote. A interface apresenta só remoções confirmadas e conserva a chave atual. Fechar o painel ou premir Escape resolve a confirmação como cancelamento. Não há retoma automática ao montar/recarregar nem novo nonce para contornar uma operação desconhecida; usa-se a recuperação existente.

Antes do reinício, uma nova consulta deve encontrar apenas tombstones no conjunto pessoal canónico. Uma memória nova impede a conclusão e não é acrescentada silenciosamente ao plano aprovado. O conjunto não é uma transação global: remoções já confirmadas permanecem se uma etapa posterior falhar. Outros dispositivos podem escrever depois da consulta final. O plano cobre `uid` próprio e `teamId:null` explícito; documentos ainda por classificar, equipa, histórico, ficheiros e cópias externas permanecem. Não é eliminação física nem recuperação integral de chaves. As palavras antigas continuam necessárias para dados antigos; backfill, retenção global e pilotos permanecem requisitos do lançamento.

## Transferência das garantias dos testes retirados

Os dois ficheiros de testes dos escritores SDK retirados continham **11 casos**. Não representavam os protocolos atuais. As before images e os títulos originais ficam preservados na evidência privada. A correspondência é a seguinte:

| Caso retirado | Verificação pelo protocolo atual |
| --- | --- |
| Sessões: preservar autor e arquivar cifra/época atomicamente | `memoryEdits.test.js`, `teamRevisions.test.js`, `memoryEditRecovery.test.ts` e integração real memória/histórico em `frontend/rules-tests/firestore.rules.test.ts` |
| Sessões: criar no UID do ator sem versão anterior | criação de equipa em `functions/test/rules.test.js` (`server learned creation` e `server team creation and revision`), contrato/executor de criação e `learningService.generationScope.test.ts` |
| Sessões: remoção pelo owner e recusa de membros/tombstones forjados | `memoryEdits.test.js` (`personal owner and team owner tombstones`), `memoryEditRecovery.test.ts` e integração real com tombstone e recusa SDK |
| Sessões: CAS, âmbito e rotação entre preparação e commit | `teamRevisions.test.js`/`memoryEdits.test.js` (versões completas e ABA), `memoryEditRecovery.test.ts` e concorrência/rotação no emulador |
| Sessões: ignorar preparação/ACK após mudança de conta/cofre/cache | `memoryEditRecovery.test.ts`, `learningService.generationScope.test.ts`, `CognitiveInput.generation.test.tsx`, `useUniverseMemories.test.tsx` |
| Sessões: gate fechado, membro removido e contexto cifrado incompatível | `teamRevisions.test.js`, contratos de criação, `memoryEditRecovery.test.ts` e matriz owner/editor/membro/ex-membro/estrangeiro/anónimo no emulador |
| Ligações: ambas as pontas e arquivos exatos sem mudar autor | `teamConnections.test.js`, `teamConnectionRecovery.test.ts` e integração real de ligações no emulador |
| Ligações: reparação unilateral, unlink e no-op | `teamConnections.test.js` (`unlink ... repairs a one-sided legacy pair`, `no-op commits a receipt`) e `teamConnectionRecovery.test.ts` |
| Ligações: âmbito, inexistência, tombstone, duplicados/self e grau | contrato/executor `teamConnections.test.js`, `teamConnectionRecovery.test.ts` e recusas de âmbito no emulador |
| Ligações: revisão/cifra, rotação, wrap e membro mudados | `teamConnections.test.js` (baseline completo e ABA), `teamConnectionRecovery.test.ts` e CAS/rotação no emulador |
| Ligações: gate/conta/cofre/cache e ACK retirado | `teamConnectionRecovery.test.ts`, incluindo perda de ACK, nonce exato, checkpoint conservado e recuperação com admissão fechada |

Os testes positivos de leitura legada usam Admin exclusivamente para preparar a origem. As escritas de produto são ensaiadas com os executores compilados e o Firestore emulado. A conversão de history/plaintext, as propostas e a expiração por SDK passam a ser recusas explícitas; os protocolos autorizados de revisão/migração/relações/sync têm as suas próprias suites. A matriz nova confirma que as tentativas SDK não alteram os dados nem os updateTimes originais.

## Verificação e limites de lançamento

Evidência: `W:/real/mnemosyne-launch-evidence/core-memory-sdk-cutover-validation-20261018/`. A primeira passagem focada encontrou uma fixture de criação aprendida sem `learning.batchId` obrigatório; foi corrigida para `null`, preservando o log da falha. A compilação encontrou também uma referência de tipo ao módulo retirado, substituída pelo contrato próprio da manutenção.

Resultados finais: **1.531 testes frontend/193 ficheiros**, **489 unitários Functions/uma omissão prevista**, **277 cenários Functions +23 frontend** na suite completa de regras, **24 testes focados de identidade**, cinco do controlo SDK e 15 de pipeline. Build/TypeScript, quatro smokes públicos locais e novas auditorias npm de produção dos dois packages passaram; zero vulnerabilidades conhecidas reportadas e lockfiles inalterados. Lint final: zero erros/23 avisos anteriores. O controlo AST cobre 298 fontes, sem ocorrências. O componente de identidade foi ensaiado em jsdom, sem certificar hardware/WebViews/leitor de ecrã.

A primeira passagem geral das regras aprovou 274 de 277 cenários Functions e não iniciou a etapa frontend. As três falhas eram expectativas positivas do SDK em fixtures de purge de referências, congelamento de escritores durante eliminação de conta e resolução de conflito. As verificações foram transferidas para os executores atuais, mantendo a recusa SDK: revisão stale após purge é abortada, revisão fresca conserva apenas referências restantes; revisão preparada antes da eliminação é recusada durante a remoção de membership; resolução cifra/arquiva/tombstone no servidor recusa plaintext, dono estrangeiro e eliminação tardia. A primeira transferência de duas fixtures omitia os seis campos obrigatórios de metadata da revisão; foi corrigida para o contrato atual. Depois passaram 19 casos focados do servidor e os 23 de integração do cliente, e a repetição completa terminou com **277 +23 aprovados, zero falhas/omissões**. Todos os logs anteriores permanecem na evidência. Os emuladores encerraram normalmente.

Os 545 inputs do ensaio final — fontes de runtime, contratos, executores compilados, fixtures, regras e locks — ficam ligados por hash. A prova `W:/real/mnemosyne-launch-evidence/core-memory-sdk-cutover-local-validation-20261018.json` liga este incremento à configuração autorizada das credenciais, com 802 fontes atuais, cinco retirements ligados às before images e artefactos reconstruídos da web. Os executores compilados Functions mantiveram os hashes anteriores. O verificador independente confere fontes, evidência, artefactos e a continuidade; isto não cobre o checkout inteiro.

Nenhuma regra, Function, gate ou cliente deste incremento foi aplicado em produção. O rollout exige Functions/índices/dados/clientes/regras coordenados; os clientes antigos perdem a escrita pelo SDK retirado. Uma falha deve fechar admissões e conservar leitura/recuperação. Reabrir os caminhos SDK antigos reintroduziria o bypass de recibos/quotas. Todos os requisitos das fases 0–6 permanecem exigidos, incluindo os 253 candidatos do dry-run de backfill, segredos/bindings, alertas, aceitação de plataformas e CI protegida.
