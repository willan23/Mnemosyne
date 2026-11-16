# Retirada de snapshots sem percorrer toda a fila — 15 de novembro de 2026

## Problema, ameaça e decisão

Ao fechar o cofre ou mudar a conta/chaves/âmbito de equipa, o leitor precisa de retirar os trabalhos ainda não iniciados e impedir a publicação de resultados antigos. A fila limitava a oito mapeamentos em curso, mas o seu cancelamento percorria cada trabalho pendente e criava um erro para cada um. O reset do cache também recolhia todos os IDs para recuperação e descartava-os logo a seguir. Numa fila sintética de 100.000 documentos bloqueados, este percurso atrasava o retorno do reset em 229.9 ms nesta máquina.

Os trabalhos em espera passam a guardar as funções que capturam documentos num mapa pertencente à geração. A retirada desliga a fila, limpa esse mapa e rejeita os trabalhos em espera que têm coletores a aguardar. Um trabalho que ainda não tinha coletor rejeita se for consultado depois. Não se percorrem os links dos restantes trabalhos. O reset explícito deixa de recolher IDs de recuperação que seriam imediatamente descartados. A recuperação de uma falha do listener conserva o comportamento anterior e ainda pode percorrer IDs.

A alternativa de manter o percurso completo criava um custo proporcional ao cofre na retirada de acesso. Uma pausa assíncrona para retirar autorização prolongaria o intervalo de validade dos dados antigos; foi mantida a retirada síncrona da geração. A implementação limita o trabalho imediato aos coletores realmente pendentes. Esse conjunto pode crescer com snapshots concorrentes; não se promete custo constante perante um número ilimitado de coletores.

Trabalho nativo que já começou pode terminar. As guardas de geração/revisão e os leases continuam a impedir que publique ou invalide o âmbito novo. Não há promessa de apagar instantaneamente da memória do processo os valores de operações nativas em curso, nem de revogar conteúdo já lido. Os trabalhos ainda não iniciados perdem as funções que leriam os documentos; os oito em curso não dão início ao restante lote depois da retirada.

## Validação

Passaram **2.437 testes frontend/252 ficheiros**, incluindo cinco novos testes da fila. Passaram ainda 116 testes focados/4 ficheiros, lint completo zero erros/21 avisos anteriores, build de produção/identidade antes e depois dos testes e 23 contratos de distribuição/segredos/gates.

O novo ensaio Chromium usa a fila e o cache reais com documentos sintéticos bloqueados. Em 100.000 documentos, o retorno do reset passou de 229.9 para 0.5 ms; a retirada direta da fila passou de 342.7 para 0 ms na resolução do relógio deste ambiente. O teste também observa zero leituras de links da fila durante a retirada, apenas oito leituras de documentos iniciadas, zero leituras tardias em fila, rejeição de coletores antigos e preservação de uma nova geração. Os tempos são amostras locais, não um SLO ou prova de dispositivos.

Repetiu-se o mapeamento de 100.000 envelopes sintéticos distintos com AES-GCM/PBKDF2 reais: conteúdo/ordem, pico de oito mapeamentos em curso, uma leitura/projeção numa edição e retirada dos resultados antigos. Esse harness inclui uma publicação síncrona de stress, por isso o seu heartbeat global não mede apenas o mapeamento nem o caminho controlado dos hooks. Repetiu-se separadamente a publicação atómica com controller/store e Worker semântico compilado, incluindo edições, eliminações e alterações de âmbito concorrentes. Os três ensaios registaram zero pedidos externos e zero erros de página. Auth/SDK/dispositivos não são comprovados por estes testes sintéticos.

Comandos executados, todos com exit code 0:

```powershell
node frontend/node_modules/vitest/vitest.mjs run --root frontend src/services/snapshotMappingQueue.test.ts src/services/incrementalSessionSnapshot.test.ts src/hooks/useUniverseMemories.test.tsx src/hooks/useSessions.test.tsx --maxWorkers=1
npm --prefix frontend run lint
npm --prefix frontend run build
node scripts/check-build-version-identity.cjs
node scripts/snapshot-retirement-browser.cjs
node scripts/snapshot-mapping-browser.cjs
node scripts/atomic-publication-browser.cjs
node --test scripts/desktop-release-entrypoints.test.cjs scripts/release-gates-preflight.test.js scripts/secret-scan-policy.test.cjs
node frontend/node_modules/vitest/vitest.mjs run --root frontend --maxWorkers=1
node scripts/check-build-version-identity.cjs
```

Node fixado: 22.23.3. Comandos/logs e hashes: snapshot-retirement-local-validation-20261115.json. A baseline anterior e os artefactos substituídos pelo build foram preservados antes da execução. Backend, Rules, dependências e instaladores anteriores conservam os hashes; os seus testes/auditorias não foram repetidos neste incremento.

## Risco residual, migração e rollback

Continuam pendentes a preparação inicial síncrona de metadata/SDK, recuperação de falhas proporcional ao número de IDs, carga/churn/memória da aplicação completa e SDK de 100.000 notas. A captura inicial deste ensaio continuou a custar 69.7 ms; a alteração não resolve essa etapa. A qualidade semântica continua com cinco dos nove critérios por aceitar e a política experimental permanece fora da aplicação.

Não houve alteração de schema, Rules, índices, TTL, algoritmo de criptografia, política cloud ou modelos. Não há migração de dados. Rollback: restaurar snapshotMappingQueue.ts e incrementalSessionSnapshot.ts pelas imagens anteriores, retirar o novo teste/harness e o respetivo passo CI e repetir build/testes. O rollback devolve o custo de cancelamento anterior; não altera dados persistidos. Um rollout posterior exige reconstruir e validar instaladores contra a revisão aceite e satisfazer os restantes pré-requisitos.

Google/Vertex não foi consultado ou alterado e não houve inferência de fornecedor/modelo. Não se executaram migrações, índices/TTL, ativação de alertas, bindings de secrets, merge ou deploy. Os 49 gates locais permanecem falsos. O PR continua em rascunho; CI remota/faturação, disponibilidade dos fornecedores e conclusão das fases 0–6 continuam pendentes.
