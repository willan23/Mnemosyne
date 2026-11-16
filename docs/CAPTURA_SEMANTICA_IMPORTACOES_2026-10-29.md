# Captura semântica limitada para aprendizagem e importações — 29 de outubro de 2026

Aprendizagem, revisão aprendida, cápsulas, documentos, Comms e gravação de pesquisa web deixam de clonar as sessões completas e convertê-las em `MemoryObject` antes de calcular os vizinhos. Usam uma captura comum de metadata semântica, em tarefas limitadas, e passam a guarda da operação também ao motor. A alteração reduz cópias e trabalho contínuo no thread da interface; não conclui o requisito de escalabilidade de toda a fase 5.

## Decisão e garantias

`captureSemanticCandidates` verifica a guarda e a elegibilidade antes de ler um vetor. O predicado pessoal exclui memória de outra conta, equipa, âmbito ambíguo, partilha, bloqueio e tombstone; o predicado de equipa seleciona a equipa exata e permite os seus outros autores. Uma revisão exclui o próprio ID. A admissão de conta/equipa/época continua a cargo dos protocolos existentes dos chamadores.

A captura conserva ID, autor/âmbito, flags de disponibilidade, marcador do modelo, vetor compatível, posição, agrupamento e tipo celeste. Não lê nem copia texto, título, envelope, anexos, tags ou conexões das memórias existentes. O vetor compatível é copiado, com limite de 4.096 dimensões, e a posição é independente da origem. Memórias legadas/incompatíveis continuam a contar para a classificação, sem ler ou copiar os seus vetores: não podem ser comparadas com a consulta do espaço atual. A elegibilidade precede mesmo getters dos campos sensíveis.

A cada 128 registos de origem, incluindo os recusados, a captura cede uma tarefa e revalida conta/cofre/âmbito. Observa as chaves pessoais e de equipa durante a captura. Os observadores são retirados no final ou em erro. As guardas dos protocolos envolventes continuam ativas através da inferência, cifra, journal e confirmação durável. As chamadas padrão de documentos e Comms passaram a encaminhar também as opções do motor, que antes não eram necessárias nessas assinaturas.

Um plano documental reutiliza uma única captura para todos os hubs/documentos. Um pack de cápsulas reutiliza a base capturada e acrescenta só a metadata de cada item processado. Cada consulta recebe um iterável limitado ao comprimento observado naquele momento, sem copiar a coleção crescente e sem incluir itens acrescentados depois. Conteúdo próprio da importação continua a ser capturado e cifrado pelos protocolos anteriores.

O posicionamento dos hubs documentais substitui `Math.min(...positions.map(...))` por um mínimo incremental, com cedência e guarda a cada 128 posições. Conserva o cálculo de distância, a escolha entre até 100 tentativas e o comportamento aleatório. A preparação dos sóis existentes também cede em lotes. Uma perda de âmbito durante o posicionamento impede inferência/cifra/publicação posteriores.

## Contrato de entrada e limites

As listas fornecidas pelos hooks são vistas imutáveis: atualizações publicam novos objetos/arrays. A captura lê essa vista em lotes e entrega cópias dos vetores/posições antes da inferência ou leitura dos ficheiros. Não cria um snapshot atómico de um array que outro chamador modifique no lugar durante os lotes. Chamadores futuros devem respeitar a imutabilidade e fornecer a guarda de revisão/âmbito apropriada. Alterar a coleção remota depois de capturar uma operação não altera automaticamente a sua coorte heurística.

A captura continua linear e retém as cópias dos vetores durante a operação. Não é um índice persistente. O motor ainda percorre a metadata capturada e reenvia os vetores em lotes para cada item calculado. Um pack grande pode, portanto, demorar; o trabalho agora cede tarefas. Não se declara concluída a exigência de evitar percursos completos por escrita. Também permanecem outros filtros/facetas, carregamento inicial e qualidade ampla. A posição de hubs não é um algoritmo novo de layout.

Não há alteração de envelopes, schema, Rules, Functions, quotas, recibos, confirmação/retoma ou abertura de gates. Falhas normais de enriquecimento conservam os fallbacks fixos anteriores dos chamadores; perda de autorização/âmbito é revalidada e impede continuar. A captura de um plano inválido pode recusar o plano inteiro. As fontes e metadata não são enviadas para um fornecedor externo.

## Validação

- **2.137 testes frontend em 229 ficheiros**, sem falhas/omissões; **82 focados em sete ficheiros**, incluindo 16 novos.
- TypeScript e build Vite passaram; lint dos 13 ficheiros do âmbito sem erros/avisos. Permanece o aviso de chunks grandes do build.
- A captura tem testes de 10.000 candidatos, lotes de 128, ACL antes de getters, ausência de conteúdo, cópias independentes, legado/incompatibilidade, limite de dimensão, duplicados, abort, retirada de chaves e prefixos crescentes.
- Os cinco chamadores têm testes de integração do serviço que usam getters de conteúdo proibidos, verificam os candidatos e o encaminhamento da guarda. Os testes anteriores de journals/ACK perdido, cifra, recuperação e isolamento continuam na suíte.
- Documentos: paridade da fórmula de posição com `Math.random` controlado, cedência durante o posicionamento e recusa antes de cifra/inferência quando a guarda é retirada.
- Chromium: helper e motor reais, Worker compilado sem alterações, CSP nativa e 10.000 registos sintéticos de 384 dimensões. Capturou 8.240 elegíveis, dos quais 8.040 compatíveis e 200 legados, sem ler conteúdo ou vetores recusados. Confirmou cópias independentes, prefixos 8.240/8.241, paridade dos sete vizinhos/posição/agrupamento/importância e terminação. A captura retirada por chave/guarda não iniciou Worker.

O primeiro browser decorreu em simultâneo com a suíte completa: captura de 2.818,4 ms/80 ticks e seleção de 308,1 ms. A repetição posterior preservou fontes/Worker e mediu **363,8 ms/72 ticks** na captura e **129,8 ms** na seleção. O `PerformanceObserver` não reportou tarefas longas cujo início estivesse dentro do intervalo dessa captura. Ambas as execuções e o helper anterior à instrumentação ficaram preservados. São observações locais, sem benchmark de dispositivos nem garantia de latência universal.

O browser usa embedding e eventos de chave sintéticos; não executa inferência real, os pipelines completos de importação, Auth, cofre, SDK Firestore ou aplicação instalada. Os chamadores são cobertos pelos testes unitários de integração. Zero pedidos externos encaminhados. Functions/Rules não foram repetidos; 594 testes gerais e 322 + 23 de Rules são evidência anterior. Artefactos nativos e downloads foram conservados; não incluem este build web.

## Migração, reversão e estado

Não há migração de dados. Reverter este incremento exige repor os chamadores e retirar o helper, mantendo os protocolos duráveis anteriores e o Worker semântico já existente. Não abrir gates nem publicar apenas parte de uma revisão final validada.

A prova privada `W:/real/mnemosyne-launch-evidence/semantic-capture-local-validation-20261029.json` vincula os resultados, fontes e artefactos à prova anterior `capture-preview-local-validation-20261029.json`. O scan do âmbito revê achados esperados e consulta apenas metadata pública de configuração/restrições Firebase, sem payloads de secrets. **Fases 0–6 incompletas, 49 gates fechados, zero chamadas a fornecedores de geração e zero deploy.** Migrações/configuração operacionais, CI remoto, disponibilidade da IA gratuita, qualidade ampla e pilotos continuam necessários.
