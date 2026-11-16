# Publicação transacional e rollback de embeddings pessoais — 25 de outubro de 2026

O encaminhamento por espaço permite pesquisar um corpus misto, mas não publica os vetores preparados. Reutilizar uma edição de conteúdo para essa publicação invalidaria campos de grafo/geração e alteraria a revisão de aprendizagem. Foi criado um protocolo específico de servidor, sem ativação em produção. O [serviço de retoma do cliente](JOURNAL_RECUPERAVEL_EMBEDDINGS_2026-10-25.md) tem validação separada e ainda não está ligado à interface.

## Admissão e preservação de dados

As quatro Functions regionais `prepareEmbeddingIndexRevision`, `applyEmbeddingIndexRevision`, `getEmbeddingIndexRevisionStatus` e `cancelEmbeddingIndexRevision` exigem Auth e App Check. O UID capturado no pedido deve coincidir com a conta autenticada. A aplicação partilha o gate existente `PERSONAL_REVISION_WRITES_ENABLED`, que continua falso; status e cancelamento podem resolver pedidos pendentes quando esse gate fecha. Os limites por UID aplicam-se antes do acesso ao protocolo.

A preparação exige o digest da vista atualmente apresentada. O servidor devolve hashes do estado completo e da versão Firestore, revisão e digest da identidade do conteúdo cifrado. A transação de aplicação volta a verificar o perfil e o marcador permanente de apagamento da conta, propriedade pessoal, ausência de partilha/equipa/apagamento, envelope cifrado válido e a baseline inteira. Alterar e restaurar os mesmos bytes não recupera uma baseline antiga, porque o hash inclui a versão Firestore.

A publicação aceita apenas o espaço multilingue revisto, com SHA fixado, 384 números finitos e norma próxima de um. O servidor valida o contrato; não decifra a memória nem prova que o vetor corresponde semanticamente ao texto. Essa ligação deverá ser confirmada pelo cliente, pela geração da chave e pelo checkpoint cifrado antes do envio.

Na mesma transação, guarda o snapshot anterior em `sessions/{id}/versions/embedding-index-{operationId}` e atualiza apenas `embedding`, `embeddingModel`, `updatedAt` e `lastVersionId`. Conserva os bytes do envelope, epochs/identificadores de chave e os restantes campos: anexos, ligações, nós, agrupamentos, aprendizagem, prompts e metadados adicionais. O arquivo não promove a memória para uma nova revisão de conteúdo e não reclassifica o modelo dos vetores históricos.

## Idempotência e rollback

O recibo em `embeddingIndexRevisions/{operationId}` vincula UID, memória e digest do pedido completo. Repetir o mesmo pedido após perder o ACK devolve o resultado anterior, sem segunda escrita, arquivo ou cobrança de quota. Reutilizar o ID com outro vetor/pedido/conta é recusado. O recibo contém apenas identificadores, hashes, estado e datas; não contém texto, cifra ou vetor. Status não cria um resultado fictício de sucesso. Um cancelamento durável sela uma operação ausente e impede a aplicação tardia; se a escrita já terminou, confirma esse resultado.

O rollback lê o arquivo apenas no caminho da memória atual. Exige uma baseline nova e a mesma identidade do conteúdo cifrado/epoch. Restaura apenas os dois campos de índice, incluindo a diferença entre campo ausente, nulo e marcador legado. Preserva alterações posteriores de grafo ou outros metadados. Recusa um vetor de conteúdo/chave diferentes. O próprio rollback arquiva o estado anterior e tem recibo, pelo que pode também ser recuperado depois de um ACK perdido.

As transações mantêm todas as leituras antes das escritas. Quotas diárias limitam a 2000 operações, 20 MiB de vetores contabilizados e 100 MiB de snapshots arquivados por UID; cancelamentos novos também consomem uma operação. Limites e estado de quota inválido recusam a transação inteira. O volume de arquivo é contabilizado pela representação canónica; não é uma estimativa de faturação Firestore.

## Schema, Rules e apagamento

Foram acrescentadas as coleções privadas `embeddingIndexRevisions` e `embeddingIndexBudgets`, com negação explícita de leitura/escrita/listagem SDK para qualquer principal. Os arquivos usam a subcoleção `versions` existente, com o marcador servidor `embeddingIndex`; a autorização de leitura/histórico mantém-se e os clientes não podem fabricar esses arquivos. O apagamento de conta passa a remover as duas coleções por UID e os arquivos pelo percurso existente de remoção dos filhos das memórias. Não há nova consulta que exija um índice composto.

A edição da base `(default)` de `mnemosyne-one` foi confirmada por consulta de metadados: Standard, Firestore Native, `eur3`. O desenvolvimento/testes usam o projeto demo explícito, com dados sintéticos. Não foram alterados a base de produção, Rules publicadas, bindings, dados ou configuração de faturação.

## Validação e limites

Passaram **18 testes focados** de contrato/transações simuladas, apagamento e ledger. A primeira tentativa teve uma falha no fixture ao calcular o digest de um documento sintético inválido antes de chegar ao servidor; o fixture foi corrigido para testar a recusa do servidor, mantendo as assertivas. A suite geral final passou **591 testes Functions**, com uma omissão prevista de Rules fora do emulador. TypeScript passou. Uma tentativa geral com descoberta implícita de testes foi terminada por selecionar um conjunto diferente do script do package; os resultados incompletos não são usados como aprovação.

A validação integral final passou **322 testes Functions/Rules e 23 frontend/Rules**, sem falhas ou omissões, no projeto demo explícito. Inclui seis cenários novos com transações reais: replay concorrente/ACK, operações concorrentes e ABA, rollback/cifra, cancelamento/apagamento, quotas/negação SDK e purge de conta. O processo terminou com código 0 e encerrou normalmente todos os emuladores.

A primeira tentativa não iniciou por a porta 8080 pertencer ao Docker. O ensaio seguinte usou portas livres e configuração privada, mas o prazo de dez minutos do lançador encerrou o Storage após 204 testes; esse resultado incompleto não é aprovação. O exit 0 de um processo intermédio também não foi usado como sucesso da suite, porque ficaram filhos ativos e faltava o serviço Storage. Foram terminados apenas os processos desse ensaio. A execução final, com prazo de trinta minutos, conservou testes/assertivas/tempos de produto e passou integralmente. Não se encerrou o Docker nem se alterou o `firebase.json` do repositório.

Não houve alterações frontend neste incremento: os 1798 testes, build, lint e browser com os dois modelos são evidência da etapa anterior, vinculada por hashes. Nenhuma inferência cloud ou chamada generativa foi necessária. Não foram recompilados instaladores, executados pilotos de distribuição ou feito deploy.

O incremento de servidor não inclui a integração do journal/retoma na UI de publicação/rollback. Essa parte é desenvolvida e verificada separadamente; Auth/App Check publicados e o fluxo completo da aplicação mantêm validação pendente. O modelo global continua legado e a seleção local continua a ser uma sobreposição. Permanecem migração das equipas, consistência dos percursos de criação/grafo/API/export/sync, qualidade/abstenção/multi-hop, desempenho e plataformas. **Os 49 gates continuam fechados e as fases 0–6/lançamento completo não estão concluídos.**

Prova privada: `W:/real/mnemosyne-launch-evidence/embedding-index-cas-local-validation-20261025.json`, encadeada à prova de encaminhamento por espaço. Evidência em `W:/real/mnemosyne-launch-evidence/embedding-index-cas-validation-20261025/`. O incremento verifica os ficheiros enumerados; os três ficheiros do serviço cliente/documentação em progresso são enumerados fora do incremento de servidor, sem declarar revisto todo o checkout misto.
