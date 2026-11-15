# Revalidação dos leitores com SDK real — 15 de novembro de 2026

## Âmbito e decisão

As alterações recentes da fila e preparação dos snapshots foram exercitadas em useSessions e useUniverseMemories com Firebase Auth/Firestore SDKs reais, criptografia de produção e o Worker semântico compilado. Cada hook/cenário usa um emulador novo, projeto demo-mnemosyne-sdk-readers, cache de memória e ator/dados sintéticos. O módulo Firebase do instrumento inicializa exclusivamente os emuladores; Auth, onSnapshot e os mapeadores de produção não são simulados. O CSP do instrumento acrescenta apenas as duas origens locais dos emuladores; o CSP do produto está intacto.

Passaram quatro percursos de 5.000 notas, com verificação de todos os conteúdos iniciais. Nos dois percursos normais, cada hook mapeou 5.000 notas na carga, uma numa edição e 200 em vinte lotes de dez alterações. A consulta semântica confirmou 5.000 candidatos. Logout esvaziou a vista, invalidou o handle antigo e terminou o único Worker de cada execução. As escritas de preparação/alteração são feitas pelo Admin SDK local; não validam as rotas lógicas de escrita do produto, quotas, consentimento ou gates de produção.

Nos dois percursos concorrentes, o instrumento chamou o mapeador nativo e suspendeu a entrega de um resultado inicial. Uma edição recebida através do SDK publicou a vista atual de 5.000 notas antes de libertar esse resultado. O lease antigo resolveu obsoleto, não conseguiu fazer commit e não repôs o valor anterior; zero vistas completas antigas foram observadas. Cada percurso mapeou 5.001 versões na carga e uma na edição posterior, confirmou o índice e o logout. A suspensão é instrumentação explícita de timing; não substitui Auth/Firestore, dados, mapeador ou criptografia.

A primeira tentativa concorrente esperava apenas uma rejeição. O contrato também permite um lease obsoleto resolver com sucesso, mantendo isCurrent falso e commit recusado. A execução foi interrompida após verificar o processo pertencente ao teste; fonte, logs e registo foram preservados. O segundo instrumento aceita as duas formas de terminar, exige que o resultado antigo não consiga fazer commit e verifica a vista atual após o retomar. Os dois ensaios corrigidos passaram, sem alterar o runtime do produto. A primeira tentativa é conservada como NÃO aprovada, não como falha confirmada da aplicação.

## Medições e limites

| Percurso normal | Carga inicial | Prefixo síncrono do cache | Intervalo máximo de heartbeat inicial | Edição | 200 alterações |
|---|---:|---:|---:|---:|---:|
| Sessões | 4371.4 ms | 3 ms | 703.4 ms | 2298 ms | 36386.9 ms |
| Universo | 5359.5 ms | 3.3 ms | 1146.4 ms | 3110.6 ms | 38637.5 ms |

Os tempos incluem SDK/emulador, decifração e publicação; edição/churn incluem criação dos envelopes e RPC Admin local. As execuções concorrentes têm uma pausa artificial e não são medições normais de latência. O prefixo do cache não representa todo o trabalho do SDK. Um mapeamento numa edição não significa uma leitura faturada ou uma mensagem recebida: o perfil anterior mediu repetição de documentos no transporte do emulador. Estas medições não foram instrumentadas para contar bytes de rede.

O maior heap amostrado dos percursos normais foi 698538103 bytes em sessões e 642587470 bytes no Universo. Não mede pico real, RSS, memória nativa/Workers nem consumo estabilizado após GC. As pausas observadas continuam significativas; não se aceita desempenho de produto/dispositivos a partir destes ensaios. Não se atribuem automaticamente ao cache nem se afirma uma melhoria global face a perfis antigos.

Os quatro browsers registaram zero pedidos fora dos endpoints locais permitidos, zero exceções de página e zero avisos/erros de console. A pesquisa em blocos dos quatro logs não encontrou overflow de back channel ou NETWORK_ERROR. Isso não aprova estabilidade prolongada ou o ensaio de 100.000 notas. As cinco portas locais ficaram livres após os processos terminarem.

O [manifesto oficial consultado](https://raw.githubusercontent.com/firebase/firebase-tools/master/src/emulator/downloadableEmulatorInfo.json) continua a indicar Firestore 1.22.0, com SHA-256 igual ao JAR verificado neste ensaio. Não foi encontrada nessa consulta uma nova versão do emulador para resolver o bloqueio anterior; o manifesto não prova a ausência de qualquer correção fora dessa distribuição. Não se alterou o transporte do produto nem se repetiu a execução online de 100.000 notas, anteriormente incompleta por overflow.

## Reprodução, risco residual e rollback

Node 22.23.3; Firebase JS 12.19.0; Admin 13.10.0; Chromium 153.0.8010.12; CLI 15.34.0; Java 21; Firestore 1.22.0. O runtime, as fontes e os Workers foram verificados por hashes antes/depois. Os comandos seguintes terminaram com exit code 0 em emuladores separados:

~~~powershell
node W:/real/mnemosyne-launch-tools/run-sdk-readers-20261115.cjs attempt-sessions sessions standard
node W:/real/mnemosyne-launch-tools/run-sdk-readers-20261115.cjs attempt-universe universe standard
node W:/real/mnemosyne-launch-tools/run-sdk-readers-v2-20261115.cjs attempt-overlapfixsessions sessions overlap
node W:/real/mnemosyne-launch-tools/run-sdk-readers-v2-20261115.cjs attempt-overlapuniverse universe overlap
node W:/real/mnemosyne-launch-tools/analyze-sdk-readers-20261115.cjs
~~~

A prova sdk-readers-local-validation-20261115.json referencia as fontes dos instrumentos, resultados, logs, configuração, versões e hashes. Os 2.447 testes frontend/252 ficheiros, 126 focados/4, build/identidade, lint e 23 contratos anteriores são reutilizados por hashes, sem nova execução. Backend/Rules/auditorias anteriores também são conservados; as Rules de leitura foram usadas nos novos emuladores.

Não há alteração de runtime, schema, Rules, índices, TTL, modelo ou dados persistidos do produto, nem migração. Rollback deste incremento: retirar apenas o novo documento e os checkpoints de documentação; os dados dos emuladores eram descartáveis. A recuperação de falhas, materialização/transporte SDK, carga online de 100.000 notas, aplicação completa, churn prolongado/memória e dispositivos continuam por aceitar. A qualidade representativa mantém cinco de nove critérios falhados e a política experimental fora do produto.

Fases 0–6 abertas, PR em rascunho, 49 gates falsos e sem merge/deploy. Migrações, índices/TTL, alertas, secrets/bindings, instaladores finais e disponibilidade operacional de IA/CI continuam no plano de rollout. Não se consultou/alterou a configuração Google, não houve inferência de modelo/fornecedor ou operação de produção neste incremento.
