# Pesquisa híbrida incremental num Worker local

## Problema e decisão

O hook `useSessions` já enviava vetores para um Worker, mas ainda normalizava texto, aplicava filtros estruturados e fundia/ordenava os resultados na interface a cada consulta ou snapshot. Esse percurso foi substituído por `HybridSearchClient` e `hybridSearchWorker`. A seleção do perfil, os modelos fixados, o limiar semântico 0,38, os espaços de embedding e as regras de scoring permanecem iguais.

O cliente faz uma comparação leve de IDs e referências imutáveis dos documentos. Envia apenas documentos alterados e IDs removidos; a ordem completa acompanha a mudança do array de origem. No Worker existem postings lexicais, tags, categorias e entidades, um índice temporal e preparação textual por documento. A seleção lexical é um conjunto superior de candidatos; o scorer existente decide os matches e scores. Isso conserva os matches literais, normalização de diacríticos, prefixos próximos e desempates pela ordem original.

## Autorização e protocolo

1. O hook confirma conta, cofre desbloqueado, época criptográfica e pertença atual às equipas antes de construir a origem autorizada.
2. O cliente exclui documentos bloqueados e tombstones antes da projeção. O Worker recebe apenas ID, título/texto, tags, categoria/tipo, datas e rótulos de entidades. UID, teamId, envelope, anexos e vetores não fazem parte desse payload. Texto e rótulos decifrados são conteúdo privado, mesmo dentro deste Worker local.
3. `prepare` aplica filtros antes de devolver IDs elegíveis e resultados lexicais. Só esses IDs seguem para o percurso vetorial existente, no espaço de embedding original ou no perfil escolhido explicitamente.
4. `rank` aceita os scores da mesma revisão/lease e funde os resultados no Worker. O hook reconstrói os hits pelo ID da origem capturada e só apresenta resultados ligados à conta, consulta, filtros, origem e seleção atuais.
5. Bloqueio, mudança de chave, conta, membership ou perfil terminam o índice e retiram os resultados. Abort, erro de transporte/clone ou deadline de 30 segundos destroem a cache. Respostas tardias e leases antigas não repõem resultados nem cancelam a consulta nova.

O Worker não usa rede, armazenamento ou logs. Não existe persistência desse índice. Terminar o Worker e retirar referências não constitui garantia de sobrescrita física da heap pelo browser. A recifragem original, controlo cloud e políticas de fornecedores continuam nos percursos existentes.

Uma falha do Worker apresenta “Pesquisa indisponível” na pesquisa rápida; não se apresenta uma pesquisa falhada como resultado vazio válido. Falhar apenas a inferência semântica conserva os resultados lexicais e o aviso operacional fixo, sem conteúdo. Consultas vazias com filtros ativos também passam pelo Worker; sem consulta nem filtros, a lista geral mantém o seu percurso existente.

## Limites e riscos residuais

- Até 100.000 registos de origem, 500 hits, consulta de 8.192 caracteres e campos limitados. O orçamento indexado é de `64 × 1024²` unidades de texto, incluindo metadados. É um limite lógico; cópias, strings normalizadas e postings aumentam o RSS. Exceder limites falha de forma explícita, sem truncar silenciosamente.
- A interface ainda percorre IDs/referências para montar o delta, reconstruir mapas e reunir snapshots/recursos disponíveis. A clonagem inicial do payload também ocupa tempo na interface. O trabalho textual e de ranking pesado foi movido; não se declara a eliminação de todo o O(N) da aplicação.
- O percurso de checkpoints do perfil selecionado continua a fazer leituras assíncronas no cliente. A busca vetorial é exata O(N × dimensões), não ANN. Mudança de âmbito ou cancelamento de um pedido em execução requer reconstrução do índice.
- A cache exige documentos imutáveis: os snapshots já preservam referências de documentos inalterados e substituem os alterados. Mutar um objeto em lugar não é um contrato suportado.
- O ensaio de 10.000 registos não carrega o Universo 3D, Auth, E2EE publicado ou modelos reais dentro desse browser. Não certifica telemóveis, dispositivos nativos, 100.000 registos ou disponibilidade de produção.
- O problema de abstenção factual medido anteriormente permanece aberto. A equivalência do ranking não aprova a qualidade global nem ativa o perfil multilíngue.

## Validação e reprodução

- **76 testes frontend em oito ficheiros**: paridade dos filtros/ranking/cache, protocolos inválidos, limites, deltas, remoção, timeout, abort, lease antiga, composição hook/palette, bloqueio, conta e pertença a equipa. Os transportes de Worker nesses unitários são simulados; executam o índice e cliente reais.
- **152 consultas com os dois modelos reais fixados**, 76 por modelo, sobre 112 documentos sintéticos: comparação exata do índice novo com a fonte anterior do scorer. Ordem, scores, tipo de match, snippets e tags coincidiram, com zero rede. Não foi repetida a calibração nem aprovada nova qualidade.
- Build TypeScript/Vite e lint de 13 ficheiros TS/TSX, zero erros e os mesmos dois avisos anteriores da CommandPalette. O aviso de chunks acima de 1.000 kB permanece.
- `node scripts/hybrid-search-worker-browser.cjs`: cliente real e Worker compilado em Chromium, 10.000 documentos sintéticos, atualização de um registo, remoção, filtragem de entidade/data/tags/categoria, fusão de score sintético, cancelamento e reconstrução. O primeiro índice normaliza 10.000, a consulta seguinte zero, a alteração um e a remoção zero. Três Workers são criados e terminados. Sem rede externa nem persistência.
- O teste Chromium foi acrescentado depois da instalação do browser no job obrigatório frontend do CI. A execução remota continua pendente. Suites gerais e regras não foram repetidas neste incremento.

Na passagem final desta máquina, os tempos de ida/volta foram:

| Operação sintética | Tempo observado |
| --- | ---: |
| Primeiro índice, 10.000 documentos | 272 ms |
| Nova consulta, preparação reutilizada | 10,3 ms |
| Fusão com um score semântico sintético | 2,0 ms |
| Alteração de um documento | 9,8 ms |
| Remoção de um documento | 10,7 ms |
| Filtros de entidade/data/tags/categoria | 3,9 ms |
| Reconstrução depois de abort | 202,7 ms |

O timer de acompanhamento da interface avançou 46 vezes, com intervalo máximo observado de 57,4 ms. Inclui a instrumentação e clonagem dos pedidos; não é medição de frames, garantia de ausência de long tasks ou um SLO. O Worker compilado tem 12.302 bytes. A passagem inicial, conservada separadamente, mediu tempos diferentes; estes resultados não são generalizados a outras máquinas.

As saídas exatas, hashes, primeiras falhas e tempos desta máquina ficam em `W:/real/mnemosyne-launch-evidence/hybrid-search-worker-validation-20261023/`. A primeira passagem unitária teve uma expectativa errada: um documento criado um segundo antes do meio-dia pertence ao intervalo iniciado à meia-noite desse dia. A expectativa foi corrigida para a fronteira UTC; não foram alterados filtros ou timeouts. O primeiro lint apontou uma interface vazia equivalente ao tipo base, substituída por alias sem desativar regras.

## Migração e rollback

Não há migração de schema, Rules, índices Firestore, secrets ou modelos. O build passa a incluir `hybridSearchWorker-*.js`, que deve acompanhar a publicação dos assets. O rollback deve usar um build coerente do cliente e Workers e conservar as proteções anteriores de âmbito/consulta. Não se reutiliza a cache entre versões ou cofres.

Zero mutações de produção, payloads de secrets, pedidos generativos ou deploys neste incremento. Os 49 gates permanecem fechados. Este incremento conclui este percurso local do índice; as fases 0–6 conservam os restantes critérios antes do deploy completo autorizado.
