# Compactação de vetores pessoais — 16 de novembro de 2026

## Problema e decisão

As novas escritas já guardam vetores como JSON, mas os arrays históricos continuam na cache do SDK e nas vistas da aplicação. Foi acrescentada uma operação de compactação que reutiliza a revisão, o journal cifrado, o CAS, o histórico, a quota e a recuperação do índice existentes. O comando `change:{kind:'compact'}` não aceita vetor, modelo ou autoridade adicional do cliente. O servidor lê o vetor atual e muda apenas a representação, sem gerar embeddings ou alterar o espaço semântico.

A operação exige uma nota pessoal com `teamId:null`, autor igual ao UID autenticado, sem partilha, sem tombstone, ciphertext válido e vetor não vazio/finito dentro do limite admitido. Arrays de qualquer modelo histórico válido podem ser compactados; marcadores de modelo ausentes ou null são preservados exatamente. Notas de equipa, partilhadas e casos ambíguos ficam fora deste percurso. A compactação de equipas continua pendente e não foi substituída por este resultado pessoal.

## Contrato e ameaça

O pedido tem nonce e baseline completos. Hash do documento, digest do conteúdo e revisão são conferidos dentro da transação. A versão anterior completa é arquivada com `embeddingIndex.kind:'compact'`; só `embedding`, `updatedAt` e `lastVersionId` mudam no documento atual. O rollback aceita esta versão e repõe a representação anterior exata, mantendo o conteúdo e os restantes metadados atuais. Uma mudança de conteúdo/chave ou perda de autorização impede o rollback. Um nonce repetido devolve o mesmo recibo, sem novo arquivo ou cobrança de quota.

Continuam Auth, App Check, ligação ao actor, release gate de revisão pessoal, rate limits e limites diários existentes: até 2.000 operações, 20 MiB de vetores e 100 MiB de arquivos por UID/dia. O limite efetivo depende do tamanho das notas e inclui cancelamentos/rollback. Não se aumentaram limites para acelerar a migração. Não há novos endpoints, coleções, campos Firestore, índices ou TTL; há um novo valor no discriminante do comando e no marcador de histórico existentes.

O cliente usa os mesmos pedidos cifrados e confirmação por status do índice. Uma resposta perdida mantém o nonce original. Cancelamento, inspeção, exportação e importação do journal continuam disponíveis com admissão fechada, conforme as verificações existentes. O percurso não envia texto decifrado, títulos, vetores substitutos ou mnemónica ao endpoint: a compactação contém referências e hashes. O vetor em claro continua dado sensível; JSON não o anonimiza nem o cifra.

## Paginação, revisão e retomada

A nova área das Definições consulta no máximo 25 documentos pessoais por página, por UID e `teamId:null`, ordenados pelo ID. Reutiliza o índice composto existente. O cursor usa o ID, pelo que atualizar uma revisão ou apagar fisicamente o documento de ancoragem não exige reler esse documento para retomar. A lista global de notas não é a fonte deste serviço de migração.

Todos os documentos da página são conferidos quanto ao escopo antes de inspecionar vetores. Notas já compactas, partilhadas, apagadas ou com vetor inelegível são excluídas. A preparação não envia `apply`; mostra rótulos decifrados apenas localmente. Após confirmação explícita, o lote inteiro é revalidado antes da primeira escrita e cada nota é novamente ligada à baseline pelo cliente e pela transação.

O ponto de leitura fica em `mnemosyne:embedding-storage-cursor:v1:<UID codificado>`, com UID e último ID dentro de envelope cifrado pelo cofre. Não contém nonce de escrita e não substitui o journal. Só avança após o lote confirmado. Se o lote parar, os documentos já convertidos são excluídos na próxima revisão. Um pedido pendente bloqueia nova revisão/reset até ser confirmado ou cancelado. Recomeçar a verificação só remove o cursor local, sem modificar notas ou apagar pedidos pendentes.

Mudança de conta, cofre, cursor ou cancelamento retira o trabalho e impede respostas antigas de restaurarem rótulos ou sucesso na nova vista. Um pedido nativo já enviado pode terminar no servidor; conserva-se o journal para confirmar o resultado. A eliminação local da conta inclui o cursor por chave exata, preservando cursores de outros UIDs. A interface e as mensagens foram adicionadas aos quatro idiomas; os testes de interface verificam preparação/confirmar, foco, Escape, pendentes e transições de escopo.

## Validação e interrupções conservadas

Passaram 2.472 testes frontend/254 ficheiros, 84 focados/7, 631 testes backend (um teste de Rules omitido nesse comando sem emulador), build TypeScript/frontend e identidade, lint zero erros/21 avisos anteriores, 51 testes de recuperação e 23 contratos de release.

A primeira execução da suíte completa frontend foi interrompida pela pausa da tarefa e não é aceite como concluída. Ao retomar, o handle deixou de existir e a consulta nativa confirmou zero processos dessa validação. Logs parciais foram conservados. As fontes permaneceram iguais; sete etapas com saída zero anteriormente observada e logs verificados por hashes foram reutilizadas. Só a suíte frontend completa foi repetida e passou. Os resultados não são apresentados como sete execuções novas após a pausa.

O primeiro teste do serviço tinha histórico de chamadas do mock acumulado entre a fase parcial e a retomada; o teste e a falha foram conservados e o contador da fase retomada foi isolado. A lógica do produto não foi alterada para satisfazer essa contagem.

## Ensaio com emuladores e browser

O percurso final usou 53 notas sintéticas, UI/serviços do produto, SDK Auth/Firestore e Rules reais no emulador, tokens Auth verificados pelo Admin SDK e transações reais do executor backend. Fez 51 compactações e um rollback: uma nota inicialmente compacta e uma partilhada foram excluídas; a leitura de uma nota de outra conta foi recusada. O final contém 51 strings compactas, incluindo a que já existia, e dois arrays: a nota partilhada e a nota cujo rollback foi confirmado.

Uma resposta foi perdida de propósito depois do commit de `compact-002`. A interface conservou o pedido, confirmou o recibo existente e retomou sem repetir `apply` para essa operação. O cursor cifrado sobreviveu ao recarregamento da página. As páginas observadas foram 25, 25, 25 e 3 documentos, incluindo a revisão repetida após recuperação. Houve 52 recibos e 52 operações de quota, correspondentes às 51 compactações e ao rollback. O conteúdo cifrado e os modelos foram preservados. Zero pedidos externos, page errors ou avisos/erros de console; os cinco ports ficaram livres no fim.

A ponte local do teste chama `executeEmbeddingIndexCall` após verificar o token; não exercita o transporte HTTP callable nem a verificação HTTP de App Check ou o rate limiter desse transporte. O gate frontend foi aberto apenas na cópia privada do bundle de teste. As 49 flags das fontes do produto continuam falsas. Este ensaio não aprova disponibilidade de produção, rate limits, aplicação completa ou 100.000 notas.

Duas tentativas do instrumento foram conservadas sem aprovação: a primeira tratou o aparecimento do botão de recuperação durante uma operação normal como falha terminal; a segunda usou um predicado assíncrono para esperar pelo cursor. O código instalado do Playwright avaliava o objeto Promise como truthy antes de o lote terminar. A versão final espera pelo estado de erro real e lê explicitamente o cursor decifrado até à confirmação. Código do produto e critérios não foram alterados entre essas tentativas.

## Migração, rollback e limites restantes

Nenhuma nota de produção foi convertida. Após rollout autorizado e abertura dos gates, o utilizador poderá rever/confirmar lotes pessoais e recuperar pedidos através da área de vetores existente. Se uma baseline ou autorização mudar, deve rever o lote restante; não existe retry cego com novo nonce. Versões antigas que não reconhecem `compact` não devem receber pedidos pendentes deste tipo: conservar o backup cifrado e usar um cliente compatível para confirmar/cancelar.

Rollback de código: repor as fontes guardadas e recompilar frontend/functions. Rollback de dados: escolher uma versão de índice validada, confirmar e usar o executor existente, que repõe o valor anterior sem restaurar conteúdo ou metadados alheios. Não se executou rollback em produção. Os cursores locais podem ser reiniciados sem remover o journal de escrita.

Continuam abertos a compactação de equipas, o pico de heap e a aceitação SDK online de 100.000 notas, churn prolongado, memória/dispositivos completos e qualidade independente por idioma/modelo. Os candidatos de recuperação QA/grafo anteriores continuam rejeitados. Instaladores finais, migrações/índices/TTL, alertas e bindings/rollout permanecem pendentes. A CI remota e inferência paga aguardam a ação já combinada com o operador. Fases 0–6 incompletas, PR em rascunho, sem merge/deploy.

## Reprodução e prova

~~~powershell
node functions/node_modules/typescript/bin/tsc --project functions/tsconfig.json
node --test functions/test/embeddingIndexRevisions.test.js functions/test/embeddingStorage.test.js
npm --prefix functions test
node frontend/node_modules/vitest/vitest.mjs run --root frontend --maxWorkers=1
npm --prefix frontend run lint
npm --prefix frontend run build
node scripts/check-build-version-identity.cjs
node --test scripts/retrieval-eval.test.cjs scripts/retrieval-coevidence.test.cjs scripts/retrieval-evidence-graph.test.cjs scripts/retrieval-answerability.test.cjs
node --test scripts/desktop-release-entrypoints.test.cjs scripts/release-gates-preflight.test.js scripts/secret-scan-policy.test.cjs
node W:/real/mnemosyne-launch-tools/run-compaction-browser-v3-20261116.cjs attempt-recoveryv3
~~~

Helpers rejeitam nomes de tentativa já existentes; para reproduzir, preparar um diretório privado novo e outro nome `attempt-`. Os comandos validados terminaram com saída zero; as tentativas interrompidas/falhadas permanecem identificadas separadamente. Prova: `embedding-compaction-local-validation-20261116.json` e cadeia pai, incluindo hashes das fontes, artefactos, backups, logs e instrumentos. A configuração Google foi conservada pela cadeia local, sem nova consulta ou geração neste incremento.
