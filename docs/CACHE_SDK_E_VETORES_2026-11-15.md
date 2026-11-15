# Cache real do SDK e integridade dos vetores — 15 de novembro de 2026

## Correção que chega ao backend

O parser público removia coordenadas inválidas de embeddings. Um vetor com nove posições, uma delas null, podia tornar-se um vetor com oito posições e aparecer como correspondência perfeita de uma query de oito dimensões. A correção rejeita o vetor inteiro se alguma coordenada não for numérica e finita, alinhando o comportamento com o frontend. Mantém arrays válidos e strings JSON legadas com as posições originais.

Pesquisa por cosine exclui o vetor corrompido, projeções públicas omitem o vetor e o marcador de modelo, e criação cifrada continua a aceitar a nota enquanto omite essa metadata opcional inválida. Não há mudança de autorização, ciphertext ou formato de armazenamento; nenhuma nota de produção foi lida ou alterada. Quatro testes reproduziram a falha antes da mudança e passaram depois. Passaram build TypeScript, 25 testes focados e a suíte backend: 618 aprovados, zero falhados, um teste de Rules omitido porque FIRESTORE_EMULATOR_HOST não estava definido. As Rules e ensaios anteriores são conservados por hashes, sem nova execução.

## Separação entre cache e transporte online

Foi usado o SDK Firestore 12.19.0 real, Auth no emulador demo e os dois hooks, criptografia mnemónica e Worker compilado reais. A [API pública loadBundle](https://firebase.google.com/docs/reference/js/firestore#loadbundle) carrega dados na cache local; os bundles deste instrumento são fixtures sintéticas no formato BundleElement com comprimentos prefixados, sem snapshots de servidor fabricados. A implementação de referência instalada de BundleBuilder foi inspecionada. A subscrição recebe QuerySnapshot real, com metadata fromCache=true.

Firestore ficou com a rede desativada. Só Auth e o servidor HTTP local foram permitidos no browser, com bloqueio de rede externa também no processo Node. Não houve escrita Firestore/Admin, acesso ao cofre do operador ou inferência de fornecedor. Rules Firestore não são exercidas por carregar bundles de confiança na cache. A cache do instrumento usa memory LRU sem limite para conservar documentos pré-carregados antes da subscrição; essa configuração difere da aplicação e não foi incorporada no produto.

| Percurso de 5.000 notas | Sessões | Universe |
|---|---:|---:|
| Carga completa/desencriptada | 5.000 | 5.000 |
| Tempo inicial observado | 1.022 ms | 1.163 ms |
| Maior pausa do heartbeat inicial | 233 ms | 393 ms |
| Edição de uma nota | 26 ms / 1 leitura | 14 ms / 1 leitura |
| Vinte lotes de dez alterações | 200 leituras | 200 leituras |
| Candidatos no índice semântico | 5.000 | 5.000 |
| Logout, handle anterior bloqueado e Worker terminado | passou | passou |

Os dois percursos confirmaram todo o conteúdo inicial, versões editadas, imutabilidade da vista retida e retirada do âmbito. Zero pedidos externos, erros de página ou avisos/erros de console. São medições funcionais de uma execução por hook, não percentis, aceitação de SLO, aplicação completa ou dispositivos. A carga inicial continua a apresentar pausas. O primeiro piloto não cedia controlo entre lotes de preload, e o seu heartbeat de preload não teve ticks; não é uma medida válida de responsividade. O instrumento posterior cede entre lotes, sem alteração dos hooks.

## Ensaio de 100.000 notas e limite observado

O alvo permaneceu 100.000 notas com 384 coordenadas e envelopes cifrados reais. O instrumento foi congelado com interrupção se a RAM livre descesse a 768 MiB ou a heap ultrapassasse 80% do limite do browser. A execução com diagnóstico parou durante preload aos 91.008 registos, antes de montar qualquer hook: RAM livre 751.890.432 bytes (717 MiB), heap usada 2.468.858.566 bytes (2,30 GiB), limite de heap 4.395.630.592 bytes e 847.458.943 bytes de bundles carregados. Foi o limiar de RAM, não o limiar de heap, que interrompeu esse ensaio. A máquina tinha aproximadamente 15,7 GiB de RAM total e outras aplicações abertas; esta medição não é um limite universal de capacidade do produto.

Uma tentativa anterior chegou a pelo menos 83.840 registos no último progresso e terminou sem preservar o código específico; a causa dessa tentativa fica desconhecida. Os primeiros dois arranques também estão conservados: erro de sintaxe do cleanup e guarda antiga que exigia um endpoint Firestore num ensaio só com emulador Auth. Ambos falharam antes dos dados. As correções do instrumento não mudaram código do produto nem os critérios de aceitação.

O resultado separa uma parte do processamento de cache do transporte online, mas não prova que os embeddings sejam a única causa da memória observada. Não houve ablação ou profiler de retenção que estabelecesse essa causalidade. O ensaio online anterior de 100.000 notas, churn prolongado, memória de toda a aplicação e dispositivos continuam sem aceitação. Os cinco ports do instrumento foram confirmados livres no fim.

## Reprodução, proveniência e rollback

~~~powershell
node W:/real/mnemosyne-launch-tools/run-sdk-cache-v3-20261115.cjs attempt-cachesessionsv3 sessions standard 5000
node W:/real/mnemosyne-launch-tools/run-sdk-cache-v5-20261115.cjs attempt-cacheuniverse universe standard 5000
node W:/real/mnemosyne-launch-tools/run-sdk-cache-v5-20261115.cjs attempt-cache100kdiagnostic sessions standard 100000
npm --prefix functions run build
node --test functions/test/memoryEmbedding.test.js functions/test/publicApi.test.js functions/test/personalMemoryScope.test.js functions/test/sharedEmbeddingSpace.test.js
npm --prefix functions test
~~~

As três execuções de cache usaram emulador/Auth e browser novos. O comando de 100.000 terminou com código 1 pelo limite de RAM e não deve ser descrito como aprovação. Helpers rejeitam nomes de tentativa já usados; para reproduzir, usar outro nome attempt- em diretórios privados novos e a preparação correspondente. Os comandos backend terminaram com código zero. A rede dos testes backend ficou limitada a loopback, sem credenciais do operador. Os 2.447 testes frontend, 126 focados, 51 testes Node de recuperação, 23 contratos, lint zero erros/21 avisos, build frontend e auditorias/Rules anteriores são conservados por hashes, sem repetição. A correção modifica apenas runtime backend e os dois artefactos compilados de memoryPublic.

Não há migração, novo schema, índice, TTL, alteração de Rules, modelo ou dependências. Rollback do parser: repor o módulo anterior e recompilar functions; a cópia anterior e hashes estão na prova privada. Esse rollback reintroduz a aceitação indevida de vetores encurtados. A aplicação continua a usar o armazenamento atual e os instaladores anteriores continuam desatualizados por mudanças frontend precedentes. Os modelos QA/grafo experimentais continuam rejeitados e fora do runtime.

Prova: cache-vector-local-validation-20261115.json e sua cadeia pai. A configuração Google foi verificada por metadata no incremento pai: Vertex restrito, API habilitada, secret ativo; não foi repetida geração ou leitura de valores secretos. Continuam qualidade independente por idioma/modelo, SDK online/grande volume, recuperação de falhas, memória/dispositivos, instaladores, migrações, índices/TTL, alertas e bindings/rollout. Disponibilidade paga de IA e CI aguarda a ação já combinada com o operador. PR em rascunho, 49 gates falsos, fases 0–6 incompletas, sem merge/deploy.
