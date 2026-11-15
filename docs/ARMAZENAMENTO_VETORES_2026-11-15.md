# Representação dos vetores e memória — 15 de novembro de 2026

## Problema, opções e decisão

A cache do SDK retém a representação persistida além das vistas numéricas da aplicação. No ensaio anterior de 100.000 notas, o preload parou aos 91.008 por RAM livre abaixo do limite da fixture. Foi comparado o armazenamento em array Firestore com uma string contendo o mesmo array JSON, formato que os leitores já suportavam. Não se escolheu outro modelo nem se reduziram dimensões/precisão. Um formato binário novo exigiria outro protocolo de leitura; foi preferido o JSON já reconhecido, depois da comparação controlada.

Quatro execuções de 5.000 notas, ordem array/JSON/JSON/array, usaram os mesmos 384 valores por nota: sin determinístico e normalização L2, com todos os números verificados por Object.is. Foram verificadas 7,68 milhões de coordenadas. Dados e criptografia sintéticos; modelos não executados. O SDK, hooks, cache LRU sem limite e bundle fixture foram mantidos entre braços. A [API loadBundle](https://firebase.google.com/docs/reference/js/firestore#loadbundle) alimentou a cache e o [CDP através de Playwright](https://playwright.dev/docs/api/class-cdpsession) mediu a heap da página após recolha de lixo explícita. A recolha é apenas do instrumento, não foi adicionada ao produto.

| Média de duas execuções por formato | Array | JSON |
|---|---:|---:|
| Heap da página após preload e GC | 80,47 MB | 55,41 MB |
| Heap da página após carga inicial e GC | 172,39 MB | 82,27 MB |
| Bytes de bundles | 76.866.875 | 46.101.874 |

A redução observada na heap retida da página após carga foi 52,3%; nos bytes da fixture, 40,0%. Isto não inclui heap do Worker, GPU, memória nativa ou RAM de todo o processo, não é uma percentagem de faturação e não prova aceitação em dispositivos. São duas amostras por braço, não um SLO ou estimativa estatística de produção. A representação em string reduz a memória retida nesta comparação; não prova que os embeddings sejam a única causa da memória da aplicação.

## Implementação e contrato

O módulo puro functions/src/embeddingStorage.ts é partilhado com o frontend. Aceita arrays históricos e strings JSON numéricas, limita a 4.096 coordenadas/150.000 caracteres e rejeita coordenadas inválidas ou esparsas sem as remover. A serialização conserva os doubles finitos, incluindo zero com sinal. Testes incluem valores IEEE extremos e 4.096 valores determinísticos com round-trip exato.

A conversão é feita só depois da validação/digest do pedido, ao persistir o documento atual: criação pessoal/equipa/com anexos, revisões pessoais/equipa, edição genérica, publicação do índice e importação/sincronização mobile. Não altera o pedido cifrado pendente, digest, ciphertext, escopo ou resultado externo. As cópias de histórico preservam a representação exata anterior. Rollback do índice aceita e repõe arrays, JSON, campos ausentes e null sem relabelar modelos. A UI do histórico lê dimensões de ambos os formatos sem expor coordenadas.

| Superfície | Comportamento |
|---|---|
| sessions.embedding | Novas escritas dos caminhos revistos usam string JSON; arrays existentes continuam legíveis |
| versions/*/embedding | Conserva o valor anterior exato; não reescreve arquivos |
| RPC metadata.embedding | Continua array numérico validado; não passa a aceitar strings livres |
| API pública e vistas da aplicação | Continuam vetores numéricos |
| Comparação de sincronização | Normaliza o JSON persistido para vetor antes de comparar metadata |
| Ledger | Regista mudança de vetor/modelo; re-encoding isolado não inventa evento index |

Não há campos, coleções, modelos, dependências ou Rules novos. Nenhum índice ou TTL foi alterado neste incremento. O tamanho dos vetores e o modelo continuam sensíveis e sujeitos à autorização existente; JSON não é anonimização ou cifragem.

## Validação e ensaios online

Passaram 2.450 testes frontend/252 ficheiros, 65 focados/6 ficheiros, 626 testes backend, build TypeScript/frontend e identidade, lint zero erros/21 avisos anteriores, 51 testes Node de recuperação e 23 contratos de release. Um teste de Rules da suíte backend ficou omitido por não haver endpoint de emulador nesse comando. Há oito testes backend novos do armazenamento e três novos frontend; o teste de rollback existente ganhou casos JSON/array. O primeiro check focado conservado falhou numa asserção antiga que esperava array no documento; foi atualizada para verificar a string e a equivalência numérica.

Depois da mudança, dois ensaios online com emuladores novos, Auth/Firestore reais e Rules reais passaram nos hooks Sessões e Universe. Cada um verificou 5.000 conteúdos cifrados/desencriptados, 1,92 milhões de coordenadas, uma edição com uma leitura, 200 alterações com 200 leituras, índice de 5.000 candidatos, logout, bloqueio do handle antigo e término do Worker. As Rules recusaram duas leituras de servidor de notas de outra conta. Foram 10.404 escritas Admin sintéticas locais, sem dados do operador. Zero pedidos externos, page errors ou avisos/erros de console nos dois browsers. Todos os cinco ports ficaram livres no fim.

O ensaio online de Sessões observou 8,45 s de carga e pausa inicial de 1,10 s; Universe 5,68 s e pausa de 1,42 s. A suíte frontend corria em paralelo, por isso estes tempos não são uma comparação de performance com os ensaios anteriores. Os percursos passaram funcionalmente; responsividade, estabilidade prolongada e dispositivos continuam sem aceitação.

## O alvo de 100.000 mantém-se aberto

Uma execução JSON de 100.000 notas, sem GC forçado, carregou todos os bundles. O leitor recebeu QuerySnapshot real de 100.000, mas a fixture interrompeu durante o mapeamento pelo limite de 80% da heap do browser, com 72.960 mapeamentos observados e zero vista completa/commits. Não passou carga, índice, churn ou logout de 100.000 notas. O campo lastResource do relatório corresponde ao preload, não ao instante da interrupção; não há medida exata da heap nesse instante. O ensaio online anterior de 100.000 também continua sem aceitação. Os limites e o alvo não foram reduzidos para obter aprovação.

## Migração, rollback e riscos residuais

Não se converteram dados de produção. As novas escritas passam a usar JSON, mas documentos já existentes no modelo atual não são compactados automaticamente pelo percurso atual de reindexação. Falta implementar e validar a compactação retroativa em lotes com CAS, histórico, quotas, retomada e rollback antes de a considerar concluída para cofres existentes. A publicação atual do índice já grava compacto quando aplicável. Arquivos históricos mantêm a representação anterior e continuam sujeitos à retenção/autorização existentes.

O rollout deve coordenar escritores e leitores/recuperação da mesma versão. Rollback de código: repor as fontes guardadas e recompilar frontend/functions; cópias e hashes dos artefactos anteriores estão na prova. Arrays e JSON continuam legíveis no parser anterior, mas percursos antigos de histórico/reindexação não reconheciam todos os before-images JSON, pelo que não se deve presumir compatibilidade operacional de qualquer versão histórica. Rollback de dados do índice repõe a representação anterior exata pelo histórico validado; não restaura ciphertext ou metadata alheia. Nenhum rollback foi executado em produção.

Continuam o pico de heap/latência inicial, SDK online de 100.000, churn prolongado, recuperação de falhas e memória/dispositivos completos. Qualidade independente por idioma/modelo continua aberta; os candidatos QA/grafo anteriores não foram integrados. Instaladores estão desatualizados e rollout, migrações, índices/TTL, alertas e bindings continuam pendentes. A disponibilidade de inferência paga/CI aguarda a ação já combinada com o operador. Fases 0–6 incompletas, 49 gates falsos, sem merge/deploy.

## Comandos e evidência

~~~powershell
node functions/node_modules/typescript/bin/tsc --project functions/tsconfig.json
node --test functions/test/embeddingStorage.test.js functions/test/embeddingIndexRevisions.test.js
npm --prefix functions test
node frontend/node_modules/vitest/vitest.mjs run --root frontend --maxWorkers=1
npm --prefix frontend run lint
npm --prefix frontend run build
node scripts/check-build-version-identity.cjs
node --test scripts/retrieval-eval.test.cjs scripts/retrieval-coevidence.test.cjs scripts/retrieval-evidence-graph.test.cjs scripts/retrieval-answerability.test.cjs
node --test scripts/desktop-release-entrypoints.test.cjs scripts/release-gates-preflight.test.js scripts/secret-scan-policy.test.cjs
node W:/real/mnemosyne-launch-tools/run-vector-format-20261115.cjs attempt-arrayone sessions standard 5000 array
node W:/real/mnemosyne-launch-tools/run-vector-format-20261115.cjs attempt-json100ksessions sessions standard 100000 json
node W:/real/mnemosyne-launch-tools/run-vector-online-20261115.cjs attempt-onlinesessions sessions standard
node W:/real/mnemosyne-launch-tools/run-vector-online-20261115.cjs attempt-onlineuniverse universe standard
~~~

Helpers rejeitam nomes de tentativa já usados; para reproduzir, preparar um diretório privado novo e escolher outro nome attempt-. O comando de 100.000 terminou com código 1 pelo orçamento de heap e não é uma aprovação. Os restantes comandos validados terminaram com código zero. A comparação de formatos aconteceu antes da mudança de código; os ensaios online e suítes validam o código atual. Prova: embedding-storage-local-validation-20261115.json e cadeia pai. Valores secretos e conteúdo do operador não foram lidos nem enviados neste incremento; não houve inferência de fornecedor ou alteração de produção Google/Firebase/Stripe.
