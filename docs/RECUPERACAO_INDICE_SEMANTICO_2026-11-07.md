# Recuperação do índice semântico com estado persistente — 7 de novembro de 2026

O índice de escrita deixou de encerrar permanentemente por acumular histórico antes da primeira consulta ou durante um ACK lento. Conserva o estado atual dos listeners e reconstrói a réplica num Worker novo quando a fila excede o orçamento. Esta alteração conclui esse mecanismo dentro dos limites de estado declarados; a fase 5 e o lançamento completo mantêm os critérios restantes.

## Estado e consistência

Cada origem conserva referências atuais, posições persistentes de listener e uma árvore por ID. Outra árvore persistente guarda as versões das origens por ordem de criação, e uma árvore separada guarda supressões. A captura de todas as raízes para a reconstrução é constante: não copia uma coleção nem exige uma pausa nas escritas. Novos eventos entram na fila de deltas enquanto a versão capturada é transmitida. As versões anteriores preservam referências e ordem, incluindo valores nulos. Alterações normais atualizam apenas os caminhos afetados; um reset completo do listener continua a exigir trabalho proporcional aos seus IDs.

A carga inicial também usa a versão mais recente, sem reproduzir alterações históricas nem projetar vetores de objetos já substituídos. Ao exceder 256 lotes ou 200.000 unidades de referências pendentes, o cliente descarta esse histórico, retira o transporte e captura novas raízes. Movimentos, IDs de reset e remoções contam no orçamento. O agendamento conserva uma única tarefa de drenagem, em vez de acrescentar uma Promise por evento.

O estado retido tem um limite separado de 200.000 referências, somando variantes, supressões e origens. O Worker mantém o limite de 100.000 documentos canónicos. Estes são limites lógicos de registos, não um orçamento absoluto de bytes. Exceder a capacidade real ou violar o protocolo continua a retirar o índice. A recuperação por histórico não reabre um âmbito retirado por perda de chave, timeout ou protocolo inválido.

Prioridades efetivas e ordem de criação mantêm os desempates entre origens depois da reconstrução, inclusive após remover e recriar listeners. Supressões são repostas antes dos documentos e persistem por erro/retry. Mapeamentos de origens/coortes que já desapareceram são compactados sem confundir centenas de origens ainda ativas com lixo.

## Transporte e autorização

Documentos, flags e metadata de remoção/movimento/reset viajam em lotes de até 128 registos. Na reconstrução, a ordem resulta dos próprios lotes de documentos; não há lista completa de IDs no cabeçalho. Num reset normal só de ordem, os IDs são transmitidos por lotes e os vetores inalterados são reutilizados. Os totais declarados têm de estar completos antes de aceitar vetores ou confirmar a publicação; mensagens incompletas, excessivas ou fora da fase retiram a réplica.

A projeção volta a verificar o âmbito e as supressões antes de cada vetor. O Worker recebe IDs, timestamp, coorte opaca e campos vetoriais permitidos, sem UID/equipa, plaintext, cifra, anexos ou posições da aplicação. Alterações de membership retiram a revisão e os lotes seguintes não leem vetores da equipa revogada. Perda de chave termina o Worker, rejeita ACKs e pausas pendentes e impede retoma tardia. A geração do transporte e a identidade do Worker recusam respostas anteriores mesmo depois de reiniciar a sequência.

## Evidência

**2275 testes frontend/238 ficheiros** e **216 focados/11** passaram. TypeScript/build/identidade, lint zero erros/21 avisos existentes, 23 contratos de CI/publicação e auditorias apenas de produção sem vulnerabilidades nos dois packages também passaram.

Os unitários exercitam raízes antigas, 10.000 referências sem ler conteúdo, movimentos/remoções concorrentes, 3.000 edições antes da primeira consulta, orçamento de IDs de reset, várias reconstruções, ACK tardio, pausa cancelada por chave, 300 origens/coortes ativas e recusa por capacidade real. A ordenação e os scores são comparados com arrays/ranking independentes, preservando variantes e nulidade.

O Chromium executou o publisher/cliente reais e o Worker compilado sob CSP nativa, com 10.000 vetores sintéticos de 384 dimensões. Confirmou 3.000 edições sem ler vetores históricos; 800 alterações com ACK real retido; paridade depois de reconstruir; retorno a uma projeção por edição; reset de 10.000 IDs com zero vetores reprojetados; tombstones/retry e membership. Criou/terminou dois Workers, enumerou zero vezes a origem no seletor e encaminhou zero pedidos externos. A aplicação completa/Auth/cofre/nativo e inferência não foram exercitados neste ensaio.

Tempos locais: 346.7 ms na carga atual inicial, 362.3 ms na recuperação e 233.7 ms no round trip de reset. O gap máximo global de heartbeat foi 322.1 ms; inclui as rajadas e a preparação síncrona do harness, e não prova ausência de tarefas longas na aplicação completa. Não foi estabelecida uma taxa máxima sustentada ou SLO. A carga inicial/reset, o desempenho global e os restantes consumidores continuam a exigir trabalho.

Os quatro ensaios anteriores de publicação persistente, escrita manual, coortes e Universo passaram com o Worker atual. Functions/Rules conservam fontes e artefactos por hashes: evidência anterior de 607 unitários (uma omissão prevista fora do emulador), 328 Functions/Rules +25 frontend/Rules; não foram novamente executados para este incremento cliente.

A tentativa inicial do stress expirou ao recalcular a vista de referência em cada passo; o ensaio passou a aplicar à referência só a ordem final, mantendo o mesmo volume de alterações no índice testado e sem aumentar o timeout global. A primeira tentativa do novo browser recusou o receiver da camada de medição em torno da coleção; o adaptador foi corrigido. Essa falha foi preservada, não contada como aprovação. Fontes runtime, build, lint e testes focados foram reutilizados por hashes após essa única alteração de harness; todos os browsers e a suite geral foram executados sobre a revisão final.

## Pendências do lançamento

- Publicação/alterações otimistas do Universo e os restantes consumidores da UI/jobs ainda precisam de deltas até ao destino.
- Preparação de carga/reset, envio inicial da prévia textual, qualidade de recuperação e latência sob carga sustentada continuam por validar.
- Migrações/compatibilidade, secrets/bindings, índices/TTL/alertas e pilotos do rollout continuam necessários.
- Os clientes Windows/Android finais precisam de reconstrução, assinatura e smoke. A CI remota fica pendente da limitação externa já identificada.

Os 49 switches ficam fechados. Não houve deploy, inferência generativa paga ou mutações Firebase/GCP. O objetivo integral e a autorização de deploy após conclusão mantêm-se. Prova privada: `W:/real/mnemosyne-launch-evidence/semantic-index-recovery-local-validation-20261107.json`; logs e cópias anteriores em `semantic-index-recovery-20261107/`. O rollback repõe as fontes preservadas e exige novo build/validação; não transforma os instaladores antigos na revisão atual.
