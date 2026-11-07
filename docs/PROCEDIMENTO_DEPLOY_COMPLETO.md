# Procedimento de deploy completo — 24 de outubro de 2026

## Estado e autorização

O objetivo atual é concluir todas as áreas das fases 0–6 e, depois, executar o deploy completo já autorizado. A validação deste procedimento não declara as áreas concluídas nem abre gates. O inventário atual inclui **49 gates em 26 ficheiros**, todos fechados. O guard de runtimes/aliases corre antes desses gates e de qualquer consulta remota. O preflight de gates recusa a publicação antes de qualquer comando Firebase. Os ensaios anteriores conservam abaixo a sua cronologia.

O script anterior usava o projeto implícito, ignorava falhas de regras/Storage/Functions e podia anunciar sucesso ao terminar Hosting. Foi substituído por uma sequência que exige `-Project`, trabalha a partir da raiz correta, verifica cada código de saída e para na primeira falha. `npm run deploy` e `deploy:all` passam pelo mesmo entrypoint, com PowerShell não interativo. O deploy npm de Functions também exige esse entrypoint. Os aliases de runtimes retirados e o âmbito do novo guard estão em [RUNTIME_LEGADO_E_ENTRADAS_2026-10-23.md](RUNTIME_LEGADO_E_ENTRADAS_2026-10-23.md).

## Uso

Node 22, JDK 21+, dependências de desenvolvimento instaladas em Functions/frontend e Firebase CLI autenticado são pré-requisitos operacionais. A auditoria final das fases, migração, compatibilidade, artefactos assinados e rollback deve estar concluída antes de executar a publicação.

Validação sem comandos de publicação:

```powershell
cd W:\real\Mnemosyne
.\deploy.ps1 -Project mnemosyne-one -PreflightOnly
# Equivalente:
npm run deploy -- -Project mnemosyne-one -PreflightOnly
```

Publicação completa, no rollout após concluir os critérios:

```powershell
.\deploy.ps1 -Project mnemosyne-one
```

O diretório de relatórios é novo e absoluto, por omissão um nome único em TEMP. Pode ser indicado com `-ReportDirectory`; um diretório existente é recusado para conservar a evidência. O script principal não expõe a injeção de executor dos testes. A fábrica de execução real invoca argumentos estruturados, não constrói comandos por concatenação e não muda o projeto global do gcloud/Firebase.

## Sequência

| Ordem | Verificação/ação |
|---|---|
| 1–4 | Node 22, runtime/aliases, gates de código, JDK 21+ |
| 5–9 | Build Functions; preflight real de secrets; âmbito pessoal/índices READY; caixa de convites; referências de anexos |
| 10–17 | Lint/build/testes frontend; coerência de versão/ID/data entre manifestos e bundle depois dos testes; unitários Functions; emuladores de rules; audit de dependências de produção nos dois packages |
| 18 | Artefactos desktop já copiados para o dist, com verificação sem staging |
| 19 | Releitura dos gates, exigindo hashes iguais ao primeiro preflight |
| 20–24 | Firebase: índices Firestore, regras Firestore, regras Storage, Functions, Hosting |

Todas as publicações passam `--project <ID>` e `--non-interactive`. O projeto é validado antes de qualquer comando. Os preflights Admin também recebem projeto explícito e os flags de leitura `--require-complete`/`--require-clean`; o procedimento não faz backfill, purge ou eliminação de dados para desbloquear um lançamento.

`PreflightOnly` executa somente as primeiras 19 etapas, parando na primeira recusa. Isso pode incluir leituras de produção, builds/testes locais, emuladores e consultas de auditoria de dependências quando os gates de entrada passam. Não significa ausência de rede. Na passagem real de 23 de outubro, Node e runtime/aliases passaram; a recusa na etapa 3, com 49 gates fechados, impediu as etapas seguintes e quaisquer pedidos de API de produção.

O verificador `node scripts/check-build-version-identity.cjs` exige manifestos public/dist idênticos, versão do package e ID/data presentes no módulo realmente referenciado pelo index. Os testes não podem mudar esses manifestos. O [contrato da identidade de build](IDENTIDADE_BUILD_E_ATUALIZACOES_2026-10-24.md) explica o UUID, IDs explícitos, alias version:write e limites: coerência destes metadados não é assinatura do conteúdo.

A sintaxe e o projeto explícito seguem a [referência da CLI Firebase](https://firebase.google.com/docs/cli). Verificou-se também no código da CLI local **15.0.0** o suporte dos targets `firestore:indexes` e `firestore:rules`; esse exame não executou deploy ou validação de credenciais da CLI. Os índices requerem a verificação READY anterior: criar/publicar uma definição não comprova que um índice já terminou de construir. A ordem entre regras/Functions/Hosting requer o piloto de clientes antigos, escoamento e janela de manutenção previstos na migração; esta sequência não garante ausência de interrupção.

## Gates de código

`release-gates-preflight.js` usa o parser TypeScript instalado para exigir uma única declaração `export const` de boolean literal de cada gate. Comentários com texto de código, variáveis `let`, duplicados, inicializadores dinâmicos, erros de sintaxe, symlinks e ficheiros inválidos são recusados. Não avalia código de aplicação ou configuração enviada pelo operador.

Verifica as 49 declarações listadas em `SOURCES`, em 26 ficheiros: percursos pessoais/equipa, anexos, publicação/importação, contactos/P2P, emparelhamento e aprovação de mutações, entre outros. Conserva hashes dos ficheiros inspecionados e recusa a sua mudança durante as verificações. Não abre gates automaticamente. Os contratos e limites constam dos documentos de cada protocolo e do estado geral do lançamento.

Esta é uma barreira mecânica de rollout. Gates abertos não provam que todos os requisitos do produto foram cumpridos. Os hashes cobrem os ficheiros de gates, **não a revisão inteira**, artefactos ou todos os escritores. Continua obrigatória a auditoria final da revisão/CI e dos critérios de todas as áreas antes da publicação; o [estado completo](ESTADO_LANCAMENTO_COMPLETO.md) mantém essas pendências.

## Relatório, falha parcial e rollback

`deployment-result.json` conserva etapas concluídas, etapa/código de falha, componentes com ACK da CLI e tentativas de publicação. Um comando de publicação que falha fica `uncertain`: pode ter feito uma alteração remota antes de perder o ACK. Nenhum comando posterior é iniciado e não se faz rollback automático. Uma nova tentativa exige inspeção do estado real, revisão do plano de recuperação e diretório de relatório novo.

Mesmo quando todos os comandos terminam, `runtimeSmokeVerified=false` e `releaseComplete=false`. A saída distingue publicação de comandos de conclusão do produto. Ainda é necessário verificar versões/bindings efetivos, smokes, clientes/dispositivos, artefactos assinados, alertas e estado dos dados. Não se usa o sucesso do último comando como prova de todas essas áreas.

Rollback deve usar revisões/artefactos e versões de secrets aprovados, preservando ledgers e dados migrados. Não se apagam índices, counters ou anexos para recuperar disponibilidade; não se reintroduzem chaves antigas/aliases. A recuperação deve considerar cada tentativa com estado incerto e confirmar o estado publicado.

No pacote Functions, `firebase.json` passou a excluir `.env`, `.env.*` e `.secret.*` do source bundle. Isso não remove credenciais locais e não impede a CLI de carregar dotenv para configuração de ambiente. O [preflight de secrets](MIGRACAO_SECRETS_FUNCTIONS.md) continua a exigir a migração dessas entradas. Nenhum valor foi removido, copiado ou enviado neste incremento.

## Validação atual da identidade — 24 de outubro

Passaram oito testes de gates/publicação, incluindo a sequência PowerShell com executor simulado nos 24 pontos de falha. O novo verificador fica depois dos testes frontend e antes da primeira publicação. Os 14 testes Node do verificador/escritor e o build real pelo alias version:write passaram; dev, preview e 40 testes frontend posteriores conservaram os manifestos. A etapa CI é obrigatória, mas não foi executada remotamente. Não houve chamadas de publicação, APIs de produção ou abertura de gates neste incremento. Resultados e limites na prova build-identity-local-validation-20261024.json.

## Validação anterior e limites — 23 de outubro

Passaram **31 testes de scripts** em Node 22.23.3/Windows, sem omissões: guard, aliases npm reais retirados, wrappers sem projeto, sequência PowerShell e verificações existentes de publicação desktop/versão. A sequência simulada percorre agora 23 pontos de falha, incluindo o guard de runtime antes dos gates. O entrypoint real com `-Project mnemosyne-one -PreflightOnly` confirmou Node/guard e parou nos gates; os relatórios têm zero tentativas de publicação. Os novos testes estão nos jobs obrigatórios Functions e Windows do CI, cuja execução remota continua pendente.

Esta revisão de comandos não alterou código de aplicação, schemas, Rules, índices, dependências ou artefactos compilados. As suites gerais e os resultados de Vite/ledger do incremento anterior conservam o seu âmbito e não foram repetidos por esta revisão. A análise de referências dos 24 caminhos já eliminados não certifica equivalência de cada ecrã ou caminhos de módulo calculados.

## Validação histórica — 3 a 9 de outubro

Passaram **três testes de scripts** em Node **22.23.3**: AST/contrato dos gates, CLI/outputs/baseline obsoleto e a sequência PowerShell. O teste PowerShell percorre os **21 pontos de falha**, exige que nenhum comando seguinte corra, confirma projeto explícito em todas as publicações, conserva ACKs/tentativa incerta, restaura cwd e prova que `PreflightOnly` não publica. Todos os comandos de build/API/Firebase desse teste são simulados; não equivalem a CI, migração, permissões ou deploy real.

O entrypoint real foi executado com `-PreflightOnly` e projeto `mnemosyne-one`. Confirmou Node 22, guardou o relatório dos dez gates fechados e terminou com código 1 do entrypoint/código 2 do gate, como esperado. `publicationAttempts=[]`, nenhum comando Firebase e nenhum acesso externo. O teste CLI aceita o estado autorizado futuro dos gates; não obriga a mantê-los fechados para passar.

JSON de package/configuração foi relido e `git diff --check` do escopo terminou sem erro. O aviso de conversão LF/CRLF do Git foi conservado. Nenhum código frontend/Functions mudou neste incremento, por isso não se repetiram as suites gerais anteriores.

Foi acrescentado o job `windows-deployment-tests` ao workflow CI, com Node 22 e execução real destes testes PowerShell no Windows. O workflow foi analisado localmente; o job remoto e a configuração como check obrigatório ainda não foram executados/verificados. Os restantes checks e a prova de revogação histórica continuam exigidos.

A prova local `W:\real\mnemosyne-launch-evidence\deploy-pipeline-local-validation-20261003.json` conserva fontes/logs/relatórios com hashes, `releaseReady=false`, `allPhasesComplete=false`, zero mutações de produção e nenhum deploy. O próximo trabalho permanece nos critérios restantes das fases 0–6; a recusa local não é um estado de conclusão do lançamento.
