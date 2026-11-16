# Snapshots e publicação incremental — 27 de outubro de 2026

Os hooks `useSessions` e `useUniverseMemories` passam a preparar apenas os documentos indicados por `docChanges()` depois do primeiro snapshot. O primeiro carregamento, um novo âmbito ou a recuperação após erro continuam a ler `snapshot.docs`. Uma lease só confirma alterações quando ainda pertence à revisão atual; resoluções antigas não confirmam nem apagam trabalho de callbacks mais recentes. A remoção de um documento pendente deixa de depender da sua decifra. O reset elimina a cache e invalida leases na mudança de conta, chave, equipa ou subscrição.

O serviço partilhado `IncrementalMemoryPublication` mantém os valores e a ordem por origem, conciliando apenas os IDs alterados. Substitui o merge de todos os buckets e a ordenação completa a cada callback. Conserva a semântica anterior: a última origem visível fornece o valor; a primeira origem visível e a posição no snapshot desempatam timestamps iguais. No Universo, a prioridade continua legado, pessoal, equipas; os tombstones pessoais continuam a suprimir as cópias legadas durante erros e novas tentativas. A ordenação é descendente nas sessões e ascendente no Universo. Os objetos inalterados conservam a identidade.

As vistas atuais ainda recebem arrays completos. A materialização percorre todos os resultados, mas cede a execução a cada 256 elementos e verifica se a revisão/âmbito continuam atuais antes de entregar. Uma nova alteração, limpeza, mudança de conta ou revogação retira a publicação pendente. A cache reutiliza o mesmo array quando não houve alterações. Não há persistência, envio a Workers ou rede neste serviço; os objetos decifrados permanecem no âmbito local já autorizado.

## Integração e regressões

Nas sessões, a autorização é verificada antes da decifra e antes da publicação. O corpus de pesquisa recebe o delta dos valores efetivamente visíveis, incluindo a substituição entre origens. Uma recusa da subscrição limpa imediatamente a vista e a pesquisa enquanto a lista restante é materializada. O novo teste com 300 memórias pessoais e uma de equipa falhou antes desta correção: a memória recusada permanecia visível até à tarefa seguinte. Passou depois da limpeza síncrona.

No Universo, cada listener mantém a sua cache; alterações de histórico de chaves usam apenas os documentos modificados. A contagem de documentos legados em claro é atualizada por delta. Os mapas necessários ao percurso de gravação mantêm-se; a enumeração de candidatos ao gravar não foi eliminada neste incremento. Erros de subscrição e retirada de equipas limpam a vista antes de qualquer entrega assíncrona.

Passaram **127 testes focados em quatro ficheiros**: 32 da cache, 36 do publicador, 23 de sessões e 36 do Universo. Incluem mil estados aleatórios comparados ao merge/ordenação anteriores, desempates, sobreposição entre origens, tombstones, erros, concorrência, callbacks antigos, mudança de conta e cancelamento. Um teste de 100.000 documentos distingue o reset inicial do limite de 20.000 movimentos ainda não confirmados. O limite provoca reconstrução posterior; não reduz silenciosamente o conjunto.

A suíte completa passou **2.025 testes em 220 ficheiros**, sem falhas ou omissões: mais 92 casos do que a prova anterior. TypeScript e o build de produção passaram; mantém-se o aviso de chunks grandes. As execuções focada, geral, de tipos, lint e build registam hashes das fontes no início e verificam que estas e os downloads públicos não mudaram durante os comandos.

A verificação inicial de tipos encontrou propriedades declaradas nos parâmetros do construtor, incompatíveis com `erasableSyntaxOnly`; foram substituídas por campos explícitos. TypeScript e lint final dos oito ficheiros passaram, sem erros ou avisos. A primeira tentativa de controlar a tarefa de publicação interceptava globalmente temporizadores e bloqueou o harness; o processo foi terminado e essa tentativa ficou conservada. O teste corrigido controla uma promessa na fronteira de publicação e executa o método real após a libertação. O ensaio de Chromium abaixo verifica separadamente a cedência real de tarefas.

## Browser e limites de desempenho

O Chromium executou os dois serviços reais compilados com esbuild, sob a CSP nativa, com 10.000 documentos sintéticos. Não montou os hooks React, Auth, cofre, SDK Firestore ou aplicação nativa instalada. As integrações dos hooks foram exercitadas em jsdom com callbacks Firestore simulados e índices reais locais. Este ensaio não substitui um piloto operacional.

O carregamento inicial mapeou 10.000 documentos; o callback sem alterações mapeou zero e reutilizou o array. Uma edição mapeou um documento, conservou as referências dos restantes e atualizou corretamente a ordem. Nenhum callback incremental acedeu a `snapshot.docs`. A remoção, limpeza durante uma tarefa pendente, lease obsoleta e reset passaram; nenhuma publicação retirada voltou a entregar dados. Não houve pedidos externos.

A amostra registou cerca de 84 ms de preparação inicial síncrona e 258 ms até ao primeiro array, com 45 avanços do temporizador durante a publicação. Uma edição levou cerca de 0,5 ms a conciliar e 192 ms a materializar/entregar os 10.000 resultados. Correu em simultâneo com testes; não é um benchmark isolado nem prova fluidez de todas as vistas. Os intervalos entre tarefas explicam parte da latência total. O custo inicial continua síncrono, e a materialização mantém complexidade linear.

## Trabalho ainda necessário e lançamento

A fase 5 continua aberta. Permanecem percursos completos no filtro de tombstones e nas facetas de sessões, nos candidatos do motor de gravação, na preparação de pesquisas e nas vistas paginadas/3D. A eliminação destes percursos, carregamento inicial progressivo, medições da aplicação completa e testes com o SDK real ainda são necessários. A avaliação de relevância anterior continua recusada; não se integra o classificador nem se alteram limiares neste incremento.

Não há migração Firestore nem mudança de formato persistido. O rollback destes serviços e hooks requer recompilar o frontend; conserva dados, cifra e ranking. Functions/Rules não foram alteradas nem repetidas: 594 Functions e 322/23 Rules mantêm o âmbito anterior. Os instaladores e downloads públicos não são substituídos por este build web. A política cloud permanece exclusivamente gratuita, sem novos pedidos de geração ou downloads de modelos.

As fases 0–6 não estão concluídas e os **49 gates permanecem fechados**. Não houve deploy nem mutações de produção. A prova privada desta etapa é `W:/real/mnemosyne-launch-evidence/incremental-snapshot-local-validation-20261027.json`; as tentativas e resultados ficam em `incremental-snapshot-validation-20261027/`. A prova cobre o incremento identificado, não certifica todo o checkout nem o lançamento.
