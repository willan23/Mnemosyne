# Preparação controlada dos snapshots — 15 de novembro de 2026

## Problema e decisão

A retirada da fila já não percorria todos os trabalhos, mas o início de um snapshot ainda criava os IDs, entradas e cópias de metadata numa única tarefa. Num ensaio sintético de 100.000 documentos, prepare devolvia o controlo após 91.6 ms e depois de visitar os 100.000 IDs. Este custo podia atrasar interação e retirada de acesso.

A preparação aplica e copia metadata em blocos de até 128 elementos com pausas entre tarefas. Os snapshots seguintes são recebidos numa fila por geração e aplicados pela ordem do SDK, antes de admitir uma publicação. Os oito mapeamentos já iniciados podem terminar; novas leituras ficam suspensas durante uma preparação que cede o controlo. Assim, edições e remoções já recebidas podem substituir trabalhos em espera antes de ler os documentos antigos. A cópia de metadata obsoleta é abandonada, conservando as alterações necessárias para o snapshot seguinte.

A fila admite no máximo 64 snapshots pendentes, incluindo o ativo. O limite anterior de 20.000 movimentos não confirmados continua em vigor. Exceder qualquer limite retira a geração e exige recuperação pelo próximo snapshot completo; não descarta alterações para publicar um resultado incompleto. O chamador conserva a responsabilidade de retirar a vista perante erro. Uma carga que exceda a fila pode deixar a vista indisponível até esse próximo snapshot; o limite não é uma garantia de throughput.

Erros dos mapeamentos que terminam durante a ingestão de metadata são verificados no estado estável: uma correção já em fila pode substituir o trabalho falhado; um erro ainda atual retira a geração. Isto não adia notificações de alteração de conta/chaves, revogação de equipa ou erros de autorização do listener: o reset rejeita a preparação e os inputs em fila imediatamente, mesmo se o scheduler externo ainda não retomou. As guardas de geração/revisão e o commit do lease continuam obrigatórios.

## Ameaças, alternativas e testes

Os riscos cobertos são publicação parcial, perda/reordenação de deltas, leitura de corpos já substituídos, restauração de dados de uma geração retirada e retenção ilimitada de inputs. Serializar todas as decifrações desperdiçaria a concorrência útil; manter a captura inteira síncrona conservaria a pausa. A decisão serializa metadata, mantém oito operações nativas em curso e deixa a publicação existente adotar apenas leases completos e atuais. Uma retirada reentrante durante a leitura de um ID também não pode inserir uma linha no âmbito novo.

Passaram **2.447 testes frontend/252 ficheiros**, incluindo dez novos, 126 focados/4, lint zero erros/21 avisos anteriores, build/identidade antes e depois dos testes e 23 contratos. Os testes novos cobrem blocos de metadata, deltas recebidos durante a captura, cópia ultrapassada, reset antes de retomar uma pausa externa, fila cheia, correção de um mapeamento falhado, movimentos inválidos após uma pausa, retirada reentrante e holds de leitura aninhados/retirados. Sete testes anteriores do Universo passaram a aguardar a publicação deliberadamente suspensa, em vez de supor que todas as etapas tinham terminado após um act. Mantêm as asserções de retirada síncrona, conteúdo completo e publicação única do delta atual.

Quatro ensaios Chromium passaram, sem pedidos externos ou erros de página: preparação controlada, retirada, mapeamento de 100.000 envelopes sintéticos distintos com AES-GCM/PBKDF2 reais e publicação atómica com controller/store e Worker semântico compilado. No novo ensaio, o retorno inicial passou de 91.6 para 3.4 ms, com 128 IDs visitados e oito corpos lidos. Verificou a ordem/conteúdo de uma edição, remoção e inserção recebidas durante a captura, zero leituras dos corpos antigos substituídos, uma leitura numa edição posterior e nova geração intacta depois de retomar trabalho antigo.

O getter docs do SDK é chamado uma vez no rebuild e continua síncrono. O ensaio fornece um array sintético já existente; não mede a materialização, transporte ou parsing reais do Firestore. A baseline e o teste atual usam o mesmo código até à medição do retorno. O oráculo final atual gera IDs esperados sem voltar a consultar getters históricos; por isso não se usa o tempo total do harness como comparação de desempenho entre versões. São amostras locais, não um SLO ou aceitação de dispositivos, modelos ou aplicação completa.

Comandos executados, todos com exit code 0:

```powershell
node frontend/node_modules/vitest/vitest.mjs run --root frontend src/services/snapshotMappingQueue.test.ts src/services/incrementalSessionSnapshot.test.ts src/hooks/useUniverseMemories.test.tsx src/hooks/useSessions.test.tsx --maxWorkers=1
npm --prefix frontend run lint
npm --prefix frontend run build
node scripts/check-build-version-identity.cjs
node scripts/controlled-snapshot-capture-browser.cjs
node scripts/snapshot-retirement-browser.cjs
node scripts/snapshot-mapping-browser.cjs
node scripts/atomic-publication-browser.cjs
node --test scripts/desktop-release-entrypoints.test.cjs scripts/release-gates-preflight.test.js scripts/secret-scan-policy.test.cjs
node frontend/node_modules/vitest/vitest.mjs run --root frontend --maxWorkers=1
node scripts/check-build-version-identity.cjs
```

Node fixado: 22.23.3. Logs, imagens anteriores, protótipo intermédio e hashes: controlled-capture-local-validation-20261115.json. Backend, Rules, dependências e instaladores conservam hashes anteriores; os seus testes/auditorias não foram repetidos. Não houve inferência nem consulta/alteração da configuração Google neste incremento.

## Risco residual, migração e rollback

Continuam por aceitar a materialização/transporte SDK, carga de 100.000 notas com SDK/aplicação completa, churn/memória e dispositivos. A recuperação de uma falha ainda recolhe IDs proporcionalmente ao estado conhecido; um movimento isolado pode deslocar uma parte grande do array de ordem. O tempo total/heap da aplicação não está aprovado. A qualidade semântica mantém cinco dos nove critérios falhados e a política experimental fora do produto.

Não há alterações de schema, Rules, índices, TTL, criptografia, política cloud ou modelo. Não há migração de dados. Rollback: restaurar os dois módulos de runtime pelas imagens anteriores, retirar o novo harness/passo CI e os respetivos testes, e reconstruir/validar os artefactos. Os instaladores anteriores foram preservados e continuam desatualizados. O rollout ainda exige a conclusão dos restantes requisitos de migrações, índices/TTL, alertas, secrets/bindings, distribuição e disponibilidade operacional de IA/CI.

PR em rascunho, 49 gates locais falsos, fases 0–6 abertas e sem merge/deploy. Não se executaram operações de produção.
