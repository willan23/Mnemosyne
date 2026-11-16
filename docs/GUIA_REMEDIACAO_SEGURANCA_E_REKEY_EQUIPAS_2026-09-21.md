# Guia de remediação de segurança e rotação de chaves de equipa

**Data:** 21 de setembro de 2026  
**Autor:** Manus AI  
**Âmbito:** vulnerabilidades identificadas em `frontend` e `functions`, e desenho executável para corrigir a revogação criptográfica de equipas.

## Decisão executiva

O Mnemosyne deve tratar dois problemas como bloqueadores de expansão comercial: as dependências de produção com vulnerabilidades críticas ou altas e a ausência de revogação criptográfica quando alguém deixa uma equipa. A atualização das dependências é um trabalho de curto prazo, mas precisa de ser feita numa branch isolada e validada por testes. A rotação de chaves exige uma alteração de modelo, porque a chave AES atual é única por equipa e continua válida no dispositivo de um ex-membro.

A solução recomendada é **chaves de equipa por época**. Quando um membro sai ou é removido, o servidor remove-o da ACL imediatamente, congela escritas da equipa e cria um pedido de rotação. Um cliente desbloqueado de owner ou admin gera uma chave AES-256 nova localmente, faz um envelope RSA-OAEP dessa chave para cada membro que permanece ativo e confirma a rotação numa transação atómica. O servidor nunca recebe a chave em claro. Após a confirmação, todas as novas memórias são cifradas com a nova época; o ex-membro não pode ler conteúdo posterior, mesmo que conserve a chave antiga.

> A rotação pode ser **acionada e supervisionada automaticamente**, mas a geração e a distribuição da chave nova têm de ocorrer num cliente autorizado e desbloqueado. Um job no backend não pode produzir a chave sem quebrar a promessa zero-knowledge. Se nenhum owner/admin estiver online, a equipa deve ficar em modo de leitura até à conclusão da rotação. Este bloqueio temporário protege a confidencialidade futura.

## 1. Preparação obrigatória antes de alterar dependências ou dados

O repositório de trabalho contém muitas alterações locais ainda não consolidadas. Não se deve usar `git reset --hard`, `git clean`, nem `npm audit fix --force`. Estes comandos podem apagar trabalho válido ou aplicar migrações incompatíveis sem revisão. Antes de tocar em manifests ou lockfiles, preservar o estado corrente e trabalhar numa cópia isolada.

```powershell
Set-Location W:\real\Mnemosyne

git status --short
git diff --check

# Depois de guardar ou fazer commit das alterações que pertencem ao trabalho atual:
git switch -c security/remediate-dependencies-and-team-rekey
```

Não editar `package-lock.json` manualmente. Cada alteração de manifesto deve ser feita por `npm install`, ficando o diff do lockfile associado à mudança que a motivou. O comando `npm audit` encontra vulnerabilidades conhecidas, mas não substitui testes, revisão de código ou análise de impacto de uma atualização maior.[1]

Antes de qualquer deploy que altere o modelo de equipas, criar um export recuperável do Firestore e registar o ID do release em que o export foi feito. O rollback de uma versão de software é reversível; restaurar uma chave antiga como chave ativa **não é**, porque voltaria a permitir que um ex-membro decifrasse conteúdo criado após a sua saída.

## 2. Correção exata das vulnerabilidades de dependências

### 2.1 Estado observado na auditoria

O snapshot de 20 de setembro registou **17 vulnerabilidades de produção no frontend**, incluindo duas críticas e treze altas. No `functions`, registou **15 vulnerabilidades**, incluindo uma crítica e quatro altas. Estes valores devem ser novamente obtidos no início e no final da branch, porque a base de advisories do npm muda com frequência.

```powershell
Set-Location W:\real\Mnemosyne
npm --prefix frontend audit --omit=dev --json | Tee-Object audit-frontend-before.json
npm --prefix functions audit --omit=dev --json | Tee-Object audit-functions-before.json
```

A tabela separa os pacotes diretamente atualizáveis das árvores transitivas. A criticidade é a do relatório local, não uma afirmação de exploração confirmada em produção.

| Área | Pacote ou cadeia | Risco observado | Correção preferida |
|---|---|---|---|
| Frontend | `firebase` → `@firebase/database` → `faye-websocket` → `websocket-driver` | Crítico: corrupção de mensagem por cabeçalhos de tamanho abusados | Atualizar o Firebase para uma versão que resolva `websocket-driver >= 0.7.5`; não adicionar `websocket-driver` como dependência de aplicação sem necessidade. |
| Frontend | `@capacitor/cli` → `tar` | Crítico: parsing/decompressão de tar com DoS | Atualizar o CLI Capacitor para versão que resolva `tar >= 7.5.21`. Como é ferramenta de build, movê-lo para `devDependencies` é um endurecimento adicional, após validar o pipeline Android. |
| Frontend | `pdfjs-dist` | Alto: execução de JavaScript ao abrir PDF malicioso | Atualizar para `pdfjs-dist 6.3.289`, adaptar o import do worker se necessário e testar importação de PDFs. |
| Frontend | `@huggingface/transformers` → `onnxruntime-node`/`sharp`/`adm-zip` | Alto: cadeia nativa de parsing e bibliotecas de imagem | Atualizar para `@huggingface/transformers 4.3.0`; validar modelo local, embeddings e bundle web. |
| Frontend | `vite`, `postcss`, `react-router-dom` | Alto: fuga de ficheiros no dev server, source maps e DoS de rotas | Atualizar pelo menos para `vite 7.3.5`, `postcss 8.5.28` e `react-router-dom 7.18.4`. Manter Vite na major 7 reduz a área de breaking change face a Vite 8. |
| Functions | `firebase-admin`/`@google-cloud/firestore` → `google-gax`, storage, gRPC e UUID | Alto/moderado: crash, DoS e bibliotecas HTTP antigas | Atualizar conjuntamente para `firebase-admin 14.4.0`, `@google-cloud/firestore 9.2.0`, `firebase-functions 7.4.0`, Firebase SDK de testes 12 e rules unit testing 5. |
| Functions | `openai` → `undici` e `form-data` | Alto: TLS, WebSocket, cache e CRLF injection | Atualizar `openai` para `7.20.0` e rever as chamadas que usam o SDK. |
| Functions | `protobufjs`, `websocket-driver`, `form-data`, `qs`, `uuid` | Crítico/alto/moderado: DoS, parsing e injeção CRLF | Devem desaparecer da auditoria como consequência das atualizações principais. Se persistirem, aplicar uma `overrides` mínima e justificada, só depois de identificar a cadeia com `npm explain`. |

### 2.2 Atualização do frontend

Executar estes comandos na branch isolada. Eles usam versões já publicadas e corrigidas na data deste guia. O comando não deve ser trocado por `npm audit fix --force`.

```powershell
Set-Location W:\real\Mnemosyne

# Atualizações diretas de runtime.
npm --prefix frontend install `
  firebase@12.19.0 `
  @huggingface/transformers@4.3.0 `
  pdfjs-dist@6.3.289 `
  react-router-dom@7.18.4

# Ferramentas de build e desenvolvimento, mantendo a major Vite 7.
npm --prefix frontend install -D `
  vite@7.3.5 `
  postcss@8.5.28

# O Capacitor CLI não é necessário dentro do bundle entregue ao utilizador.
# Só executar a movimentação após confirmar que os jobs de Android usam npm ci
# sem --omit=dev.
npm --prefix frontend uninstall @capacitor/cli
npm --prefix frontend install -D @capacitor/cli@8.5.2
```

A migração de `pdfjs-dist` é a única atualização explicitamente major nesta lista. O ponto concreto a rever é `frontend/src/services/learningService.ts`, nas linhas que fazem `import('pdfjs-dist')` e importam `pdf.worker.mjs?url`. Confirmar no build que o worker é emitido, que o leitor de PDF não cai para worker falso e que um PDF sem JavaScript, um PDF com muitas páginas e um PDF malicioso de teste são rejeitados ou processados sem executar conteúdo ativo.

Depois da atualização, executar as verificações abaixo. Se o `npm audit` ainda indicar uma cadeia transitiva corrigível, inspecionar primeiro a origem:

```powershell
Set-Location W:\real\Mnemosyne

npm --prefix frontend explain websocket-driver
npm --prefix frontend explain tar
npm --prefix frontend explain pdfjs-dist
npm --prefix frontend explain @huggingface/transformers

npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend test -- --run
npm --prefix frontend test:e2e
npm --prefix frontend audit --omit=dev --json | Tee-Object audit-frontend-after.json
```

Caso uma cadeia transitiva permaneça vulnerável apesar da atualização da dependência principal, adicionar uma `overrides` temporária e documentada no `frontend/package.json`, com versão mínima corrigida e teste de regressão associado. Não usar overrides como primeira escolha, nem ocultar uma incompatibilidade de major. Um exemplo aceitável, apenas se o relatório final provar que ainda é necessário, é fixar `websocket-driver` em `0.7.5` ou `tar` em `7.5.21`. A remoção da override deve ser acompanhada numa atualização posterior do pacote que a exigiu.

### 2.3 Atualização das Cloud Functions

As atualizações do Admin SDK, Firestore e Functions devem ser feitas em conjunto. `firebase-functions 7.4.0` declara compatibilidade com `firebase-admin 14`, e `@firebase/rules-unit-testing 5` exige Firebase Web SDK 12. Este alinhamento elimina a combinação antiga de SDKs 11/13 e reduz a árvore vulnerável.

```powershell
Set-Location W:\real\Mnemosyne

# Dependências executadas nas Cloud Functions.
npm --prefix functions install `
  firebase-admin@14.4.0 `
  @google-cloud/firestore@9.2.0 `
  firebase-functions@7.4.0 `
  openai@7.20.0

# SDKs usados pelos testes de rules e emulação local.
npm --prefix functions install -D `
  firebase@12.19.0 `
  @firebase/rules-unit-testing@5.0.1

npm --prefix functions run build
npm --prefix functions test
npm --prefix functions audit --omit=dev --json | Tee-Object audit-functions-after.json
```

O upgrade do SDK OpenAI exige revisão manual de todas as chamadas em `functions/src` que o importam. Confirmar tipos, forma do request, tratamento de timeout/abort, limites de tokens e mensagens de erro; não assumir compatibilidade só porque o TypeScript compila. Também é obrigatório confirmar `npm explain` para cada vulnerabilidade residual antes de a resolver por override:

```powershell
Set-Location W:\real\Mnemosyne\functions
npm explain websocket-driver
npm explain undici
npm explain form-data
npm explain protobufjs
npm explain @grpc/grpc-js
```

### 2.4 Critério de aceite para a correção de dependências

A alteração só pode ser integrada quando `npm ci` funciona em diretório limpo para ambos os pacotes, build, lint e testes passarem, os testes de rules correrem com Java 21 e os dois relatórios de produção tiverem `critical: 0`. O objetivo imediato é também `high: 0`; se algum alerta alto permanecer, a pull request deve conter a cadeia, a mitigação verificável, o proprietário e uma data de correção. Não aceitar simplesmente um comentário a dizer que a vulnerabilidade é “apenas dev”: o `tar` e o Vite, por exemplo, expõem a máquina de desenvolvimento e a cadeia de build mesmo quando não entram no bundle final.

```powershell
Set-Location W:\real\Mnemosyne

# Pré-requisito local: JDK 21, igual ao job rules-tests do CI.
java -version
node --version

npm --prefix frontend ci
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend test -- --run
npm --prefix frontend test:e2e

npm --prefix functions ci
npm --prefix functions test
node scripts/run-rules-tests.js

npm --prefix frontend audit --omit=dev
npm --prefix functions audit --omit=dev
git diff --check
git status --short
```

## 3. Modelo de segurança da rotação de chave

### 3.1 Garantia que a correção entrega

A rotação por época entrega **revogação para o futuro**. Assim que a transação de rotação fica ativa, toda nova memória e toda atualização de memória de equipa é cifrada com uma chave que o ex-membro não recebeu. O ex-membro pode conservar a chave antiga, mas essa chave não abre dados cifrados na época nova.

A correção não apaga conteúdo que o ex-membro já leu, descarregou ou fotografou. Também não torna retroativamente ilegíveis os documentos históricos que continuam cifrados com a época antiga. Uma migração opcional pode recifrar gradualmente o histórico para reduzir a exposição da cópia armazenada no Firestore, mas não revoga cópias que já saíram do dispositivo. Esta distinção deve aparecer na interface e na política de segurança.

O protocolo MLS usa a noção de épocas e renova chaves quando a composição do grupo muda, precisamente para obter forward secrecy e post-compromise security.[3] O Mnemosyne não deve tentar implementar MLS/TreeKEM caseiro agora. Para o limite atual de dez membros, uma chave AES de grupo por época, envelopada individualmente com RSA-OAEP, é uma solução de transição simples, auditável e compatível com o esquema atual. Se o produto crescer para grupos grandes, multi-dispositivo por utilizador ou exigência forte de segurança pós-compromisso, deve migrar para uma biblioteca MLS madura e auditada.

### 3.2 Estados de uma rotação

| Estado | Quem pode provocá-lo | Escritas de equipa | Significado |
|---|---|---:|---|
| `active` | Commit válido de rotação ou criação de equipa | Permitidas com a época ativa | Todos os membros ativos têm um envelope da chave atual. |
| `rotation_pending` | Saída, remoção, rotação manual ou prazo de rotação atingido | Bloqueadas | A ACL já excluiu o membro removido; falta um owner/admin desbloqueado gerar e envelopar a nova chave. |
| `rotation_blocked` | Job de supervisão depois do prazo de SLA | Bloqueadas | A equipa continua segura contra novas escritas, mas exige intervenção de owner/admin. |
| `retired` | Apenas histórico de época | Nunca se escreve nesta época | A chave pode servir para ler histórico por membros que permanecem autorizados. |

Não usar um estado que permita continuar a escrever durante `rotation_pending`. Esse atalho faria com que dados novos ainda fossem cifrados com a chave já conhecida pelo ex-membro.

## 4. Esquema Firestore proposto

O documento `teams/{teamId}` continua a ser o índice de pertença e estado operativo. O material envelopado passa para uma subcoleção por época. O servidor armazena apenas envelopes, nunca a chave AES em claro.

```ts
// teams/{teamId}
{
  name: string,
  ownerUid: string,
  memberUids: string[],
  roles: Record<string, 'owner' | 'admin' | 'member'>,

  activeKeyEpoch: number,             // 1, 2, 3, ...
  activeKeyId: string,                // UUID aleatório; não é segredo
  keyRotationStatus: 'active' | 'rotation_pending' | 'rotation_blocked',
  pendingRotationId: string | null,
  nextRotationDueAt: number | null,   // por exemplo: 90 dias
  updatedAt: number
}

// teams/{teamId}/keyEpochs/{epochId}
{
  epoch: number,
  keyId: string,
  status: 'active' | 'retired',
  memberUids: string[],               // fotografia dos membros que receberam a chave
  wrappedKeys: Record<string, WrappedKeyEnvelope>,
  createdAt: number,
  activatedAt: number,
  retiredAt: number | null,
  reason: 'team_created' | 'member_left' | 'member_removed' |
          'scheduled' | 'manual' | 'key_compromise',
  rotationId: string
}

// teamKeyRotations/{rotationId}
{
  teamId: string,
  oldEpoch: number,
  newEpoch: number,
  status: 'pending' | 'committed' | 'blocked' | 'cancelled',
  reason: 'member_left' | 'member_removed' | 'scheduled' |
          'manual' | 'key_compromise',
  targetUid: string | null,
  requestedByUid: string,
  requestedAt: number,
  deadlineAt: number,
  committedAt: number | null,
  committedByUid: string | null,
  idempotencyKey: string
}

// sessions/{sessionId}, apenas quando teamId existe
{
  teamId: string,
  keyEpoch: number,
  keyId: string,
  enc: { v: 2, iv: string, ct: string },
  text: '',
  title: null,
  // restantes metadados já existentes
}
```

A `keyEpoch` e o `keyId` não são secretos. Eles permitem selecionar a chave correta e verificar que uma escrita usa a época ativa. O conteúdo continua no envelope AES-GCM. Para os novos envelopes, usar a versão `v: 2` e autenticar o contexto `{teamId, keyEpoch, keyId}` como **additional authenticated data (AAD)** do AES-GCM. Isto impede que um ciphertext válido seja movido de uma equipa ou época para outra sem falhar na decifragem.

A cache do frontend não pode continuar como `Map<teamId, CryptoKey>`. Deve passar a `Map<teamId, Map<epoch, CryptoKey>>`, com uma função explícita para devolver a chave ativa. Manter chaves de épocas antigas só na memória de processo e só enquanto for necessário ler documentos históricos. Ao bloquear a mnemónica, fazer logout ou receber um evento de remoção, limpar todas as chaves em cache desse `teamId`.

## 5. Sequência exata de implementação

### Fase A — Preparar compatibilidade sem ativar a revogação

1. Criar tipos novos em `functions/src/teams.ts` e `frontend/src/services/teamsService.ts`: `TeamKeyEpochDocument`, `TeamKeyRotationDocument`, `activeKeyEpoch`, `activeKeyId` e `keyRotationStatus`.
2. Alterar `teamVault.ts` para aceitar uma época e um `keyId` ao cifrar ou decifrar. Introduzir `TEAM_ENC_VERSION = 2`, preservando leitura de `v: 1` para dados legados.
3. Alterar `sessionMemoryFields.ts` para selecionar a chave pelo par `teamId + keyEpoch`, e não apenas pelo `teamId`.
4. Alterar `teamKeyAccess.ts` para desbloquear a época pedida. O helper deve ler `teams/{teamId}/keyEpochs/{epoch}` e abrir exclusivamente o envelope pertencente ao utilizador atual.
5. Alterar `TeamSettings.tsx` e `useMyTeams.ts` para mostrar `rotation_pending`, abrir automaticamente a tarefa de rekey para um owner/admin desbloqueado e impedir gravações enquanto a rotação não terminar.
6. Manter compatibilidade de leitura com o campo legado `teams.wrappedKeys` até a migração e a atualização do frontend estarem concluídas. Não remover nem reescrever todas as memórias neste momento.

### Fase B — Migrar metadados legados sem tocar em conteúdo cifrado

Criar uma função administrativa idempotente, protegida por IAM e não exposta ao cliente, para percorrer `teams` em páginas. Para cada equipa que não tenha `activeKeyEpoch`, criar `keyEpochs/1` com cópia de `wrappedKeys`, `memberUids`, `status: 'active'`, `reason: 'team_created'` e um `keyId` novo. Atualizar o documento de equipa com `activeKeyEpoch: 1`, `activeKeyId`, `keyRotationStatus: 'active'` e `nextRotationDueAt`.

Esta migração só copia envelopes existentes. Não decifra nem transporta a chave AES e, por isso, é compatível com o modelo zero-knowledge. Registar contadores de equipas analisadas, migradas, ignoradas e falhadas; aceitar um `dryRun` para inspecionar o conjunto antes de escrever. Repetir a execução deve ser segura.

### Fase C — Bloquear escritas obsoletas nas regras

Adicionar às Firestore Rules um helper que leia o estado da equipa e permita escrita de memória de equipa apenas quando todos os critérios seguintes forem verdadeiros: o chamador ainda é membro, a equipa está `active`, e os campos `keyEpoch`/`keyId` da escrita coincidem com `activeKeyEpoch`/`activeKeyId` do documento de equipa. Uma forma clara de estruturar o helper é:

```rules
function canWriteActiveTeamSession(teamId) {
  return isTeamMemberOf(teamId) &&
    teamDoc(teamId).keyRotationStatus == 'active' &&
    request.resource.data.keyEpoch == teamDoc(teamId).activeKeyEpoch &&
    request.resource.data.keyId == teamDoc(teamId).activeKeyId;
}
```

Aplicar este helper tanto em `allow create` como nos dois caminhos de `allow update` para sessões de equipa. Durante a fase de compatibilidade, permitir o modelo legado somente para equipas sem `activeKeyEpoch`; depois de todas as equipas serem migradas e o frontend dual-read estar em produção, remover essa exceção. Escrever testes no emulador que confirmem que uma escrita falha quando está em rotação, quando traz época velha, quando traz `keyId` errado e quando o utilizador acabou de ser removido.

As regras não conseguem provar que o ciphertext foi cifrado com a chave da época indicada. Elas apenas aplicam autorização e consistência de metadados. A implementação de cliente deve usar a chave correta e AAD; a autenticação GCM então deteta ciphertexts reetiquetados quando forem decifrados.

### Fase D — Pedido de rotação atómico ao remover ou sair

Substituir a lógica atual de `executeLeaveTeam`, nas linhas que apenas removem `wrappedKeys[uid]`, por uma transação que faz três operações lógicas num único commit:

1. Lê a equipa e confirma que o chamador é membro, que não é owner e que não existe uma rotação pendente.
2. Remove o UID de `memberUids`, `roles` e do conjunto de envelopes da época atual; define `keyRotationStatus: 'rotation_pending'` e `pendingRotationId`.
3. Cria `teamKeyRotations/{rotationId}` com `oldEpoch`, `newEpoch = oldEpoch + 1`, o motivo `member_left`, `targetUid`, prazo, idempotency key e estado `pending`.

Para uma remoção feita por owner/admin, criar `removeTeamMember` com a mesma transação, mas validar o papel do ator e usar `reason: 'member_removed'`. A remoção deve atualizar a ACL antes de notificar o alvo. Para apagamento de conta, `purgeUserTeamMemberships` deve criar pedidos de rotação para as equipas restantes; não pode continuar a retirar simplesmente o wrap e deixar a chave ativa.

Depois da transação, escrever um evento append-only em `teamAudit`, por exemplo `member_left` ou `member_removed`, e uma notificação sem conteúdo secreto para owners/admins. O evento de auditoria deve guardar ID da rotação, época antiga, ator, alvo, motivo e timestamp; nunca ciphertext ou chave.

### Fase E — Confirmação de rotação no cliente autorizado

O frontend deve assinar o fluxo abaixo quando receber um snapshot com `keyRotationStatus: 'rotation_pending'` e o utilizador for owner/admin.

1. Pedir a mnemónica se o vault estiver bloqueado. Sem mnemónica, exibir o estado e não tentar fazer fallback cloud.
2. Carregar a chave da época antiga para leitura de histórico, usando o envelope do membro ativo no documento `keyEpochs/{oldEpoch}`.
3. Obter os perfis públicos atuais de todos os membros que permanecem. A fonte é `publicProfiles/{uid}`; validar que existe `publicKeyPem` e que a lista de UIDs coincide exatamente com `team.memberUids` da rotação pendente.
4. Gerar localmente `newTeamKey = AES-GCM-256` e `newKeyId = crypto.randomUUID()`.
5. Para cada membro ativo, chamar `wrapTeamKeyForPublicPem(newTeamKey, publicKeyPem)`. O resultado contém apenas `{v, alg, ct}`. Validar que não há campos proibidos nem uma string de chave em claro.
6. Chamar `commitTeamKeyRotation` com `rotationId`, `expectedOldEpoch`, `newKeyId` e `wrappedKeys`. A chave AES em claro nunca entra no payload.
7. Só depois de a callable devolver sucesso, guardar a nova chave em cache para a nova época e começar a escrever `enc.v = 2`, `keyEpoch = newEpoch` e `keyId = newKeyId`.

O servidor deve executar a confirmação numa transação Firestore. Ele precisa ler primeiro a equipa, o pedido de rotação e a época antiga. Deve recusar se o ator não for owner/admin, a rotação já não estiver `pending`, o `oldEpoch` diferir, a lista de wraps for diferente da lista atual de membros, algum envelope for inválido ou contiver campos de chave em claro. Se tudo estiver correto, deve criar `keyEpochs/{newEpoch}`, marcar a época antiga como `retired`, atualizar a equipa para `activeKeyEpoch = newEpoch`, `keyRotationStatus = 'active'` e marcar o pedido `committed`. As transações Firestore aplicam todas as escritas ou nenhuma e são repetidas se o documento lido mudar durante a operação; por isso, o callback deve ser puro e idempotente.[2]

A callable deve aceitar a repetição de uma confirmação já efetuada apenas quando `rotationId`, `newKeyId` e os dados persistidos coincidirem. Isso torna seguro o retry depois de uma falha de rede sem permitir que uma chave diferente substitua a mesma época.

### Fase F — Recuperação de histórico e recifragem opcional

Após a rotação, novas memórias têm de usar imediatamente a época nova. Memórias antigas podem manter a época de origem e ser decifradas pelos membros que ficaram, porque esses membros ainda têm os envelopes antigos. O ex-membro não consegue obter os envelopes históricos pela regra de membro atual, mas deve-se assumir que já possuía a chave antiga.

Oferecer uma ação opcional de **recifrar histórico**. Ela roda apenas num cliente owner/admin desbloqueado, em páginas pequenas, e para cada memória: decifra com a chave antiga, recifra com a chave ativa, atualiza `keyEpoch`, `keyId` e `enc` com controlo de versão. O processo deve ter cursor, limite de concorrência, pause/cancel e métricas de progresso. Não executar recifragem automática no backend, pois ele não possui as chaves. Não bloquear a rotação futura esperando pela recifragem de todo o histórico.

## 6. Automação correta sem violar zero-knowledge

O Mnemosyne já usa funções agendadas para retenção. Deve usar o mesmo mecanismo apenas para **detetar, notificar e escalar**, não para gerar material criptográfico. Funções agendadas podem executar sobre Cloud Scheduler, mas podem sobrepor execuções; por isso, a lógica deve ser idempotente e protegida contra repetição.[4]

Criar duas automações determinísticas:

1. **Supervisor de rotações pendentes:** executa, por exemplo, a cada 15 minutos. Consulta `teamKeyRotations` em `pending`, envia uma notificação interna ao owner/admin quando está próxima do prazo e muda para `rotation_blocked` depois do prazo. Não altera membros, chaves ou epochs.
2. **Detector de rotação periódica:** executa diariamente. Para uma equipa com `nextRotationDueAt` vencido e estado `active`, cria um pedido `scheduled` em transação e congela escritas. O primeiro owner/admin desbloqueado que abrir a equipa finaliza a rotação localmente. O intervalo inicial pode ser 90 dias; rotação por saída ou remoção continua imediata e prioritária.

| Opção | Funcionamento | Vantagens | Limitações |
|---|---|---|---|
| **Rekey assistido pelo primeiro owner/admin online** | A saída cria o pedido; o próximo administrador com vault desbloqueado confirma a chave nova. | Mantém zero-knowledge, não requer chave no servidor e é suficiente para equipas de até 10 pessoas. | A equipa fica sem escrita até haver administrador online. **Recomendado para P0.** |
| **Rekey após confirmação conjunta de vários admins** | Exige, por exemplo, 2 de 3 aprovações antes da confirmação. | Maior governança para equipas empresariais. | Não resolve sozinho a geração da chave; aumenta UX e complexidade. Implementar mais tarde. |
| **MLS com gestão de dispositivos** | Protocolo de grupo por cliente/dispositivo, com commits de época. | Melhores propriedades para grandes equipas e compromissos de dispositivo. | Migração significativa; usar biblioteca auditada, nunca implementação própria. Não é necessário para o P0 atual. |

## 7. Ficheiros a alterar

| Ficheiro | Alteração necessária |
|---|---|
| `functions/src/teams.ts` | Adicionar schema de época/rotação, callables `requestTeamKeyRotation`, `commitTeamKeyRotation`, `removeTeamMember`, validação de wraps exatos, transações e eventos de auditoria. Atualizar `leaveTeam` e `purgeUserTeamMemberships`. |
| `functions/src/index.ts` | Exportar as novas callables e adicionar supervisor agendado idempotente de rotações pendentes/prazos. |
| `functions/test/teams.test.js` | Testar pedido, commit, autorização, concorrência, idempotência, lista exata de membros, remoção de ex-membro e eventos de auditoria. |
| `functions/test/rules.test.js` | Testar que membros não escrevem durante rotação, que chave/época erradas falham e que um ex-membro não lê nem escreve após a ACL mudar. |
| `frontend/src/services/teamVault.ts` | Introduzir envelopes v2 com AAD, cache por equipa/época, helpers para chave ativa e limpeza total de cache por equipa. |
| `frontend/src/services/teamKeyAccess.ts` | Abrir key epoch específico, atualizar a cache após commit e limpar cache perante remoção/erro de autorização. |
| `frontend/src/services/teamsService.ts` | Expandir parsers/tipos, expor as novas callables e listeners de rotação. |
| `frontend/src/services/sessionMemoryFields.ts` | Escrever/ler `keyEpoch` e `keyId`; manter leitura v1 durante o rollout. |
| `frontend/src/components/TeamSettings.tsx` | Mostrar estado de segurança, botão de finalizar rekey para owner/admin e bloqueio claro de escrita para membros. |
| `frontend/src/hooks/useMyTeams.ts` | Reagir a troca de época, desbloquear chaves necessárias e nunca reutilizar uma cache antiga para a época nova. |
| `frontend/src/services/teamVault.test.ts` | Testar decifragem correta por época, falha com época/equipa/AAD errados e impossibilidade de usar chave nova por ex-membro. |
| `firestore.rules` | Exigir equipa ativa, membro atual e `keyEpoch`/`keyId` ativos nas escritas de sessão de equipa. |

## 8. Sequência de deploy sem janela de exposição

1. Fazer backup/export do Firestore e criar branch de release.
2. Publicar frontend com suporte dual-read: lê `enc.v1` e `enc.v2`, e entende `activeKeyEpoch` quando existe, mas não obriga ainda a época nova.
3. Publicar Functions com os tipos, a migração administrativa e as novas callables, ainda com feature flag de rekey desligada para equipas comuns.
4. Executar a migração de metadados de todas as equipas; comparar número de equipas, membros e wraps antes/depois. Não ativar o enforcement com qualquer equipa sem uma época ativa válida.
5. Publicar rules compatíveis que permitem o legado somente quando a equipa ainda não possui `activeKeyEpoch`.
6. Executar piloto numa equipa interna: criar equipa, adicionar membro, escrever nota, remover membro, finalizar rotação, confirmar que o membro removido não lê/escreve e que membros restantes escrevem na época nova.
7. Ativar feature flag para equipas piloto e, depois de monitorização sem falhas, para todas as equipas.
8. Trocar `leaveTeam`, remoção e apagamento de conta para criar sempre pedido de rotação. Só então a remediação P0-01 está efetivamente concluída.
9. Manter leitura de envelopes v1 por período de compatibilidade controlado. Remover `teams.wrappedKeys` legado apenas quando todos os clientes suportados tiverem sido atualizados e o histórico necessário estiver migrado.

Nunca fazer rollback de `activeKeyEpoch` ou reatribuir a chave velha como ativa. Se um release de frontend falhar depois de um rekey, corrigir o cliente para suportar a época nova ou desativar temporariamente a UI; a chave nova deve permanecer a chave de escrita.

## 9. Testes de segurança obrigatórios

A implementação não está pronta sem os testes abaixo. Cada teste deve ser automatizado e executado no CI, não apenas demonstrado manualmente.

1. **Saída revoga o futuro:** Bob lê uma memória da época 1, sai, Alice confirma época 2 e grava nova memória; a chave de Bob da época 1 falha ao abrir a memória da época 2.
2. **Escrita congelada:** entre `rotation_pending` e commit, Alice e Carol recebem `permission-denied` ao criar ou atualizar memória da equipa.
3. **ACL imediata:** depois do pedido de saída, Bob já não consegue ler `teams/{teamId}`, `teamKeyRotations`, `keyEpochs` nem `sessions` daquela equipa.
4. **Integridade de membros:** o commit falha se faltar wrap de um membro ativo, se existir wrap de ex-membro, se houver UID desconhecido ou se o ator for member comum.
5. **Replay e corrida:** dois admins tentam confirmar; só o primeiro commit vence. Repetir o mesmo request depois de timeout devolve o estado já confirmado, sem aumentar a época outra vez.
6. **Binding criptográfico:** ciphertext v2 falha se `teamId`, `keyEpoch` ou `keyId` forem alterados; ciphertext v1 permanece legível apenas pelo caminho legado durante a compatibilidade.
7. **Membro offline:** um separador antigo de Bob tenta gravar depois de removido; a regra bloqueia a escrita mesmo que a cache local ainda contenha a chave velha.
8. **Recifragem paginada:** pausar e retomar a migração de histórico não perde documentos, não duplica versões nem reduz a época ativa.
9. **Observabilidade segura:** logs, Sentry e `teamAudit` não contêm `ct`, `iv`, wraps, mnemónica, chave ou texto de memória.
10. **Regression suite:** frontend lint/build/unit/E2E, Functions build/tests e emulator rules ficam verdes com JDK 21.

## 10. Checklist final de aceite

- [ ] `npm audit --omit=dev` indica `critical: 0` nos dois pacotes.
- [ ] Nenhuma vulnerabilidade alta fica aberta sem cadeia, mitigação, proprietário e prazo.
- [ ] Dependências e lockfiles são instaláveis por `npm ci` em ambiente limpo.
- [ ] PDF import e embeddings locais funcionam após as atualizações major.
- [ ] Todas as equipas existentes receberam `activeKeyEpoch: 1` sem perder wraps.
- [ ] Saída, remoção e apagamento de conta criam uma rotação, em vez de só remover a ACL.
- [ ] Enquanto a rotação está pendente, não há escrita de equipa possível.
- [ ] O commit contém exatamente os wraps dos membros atuais e nunca recebe uma chave em claro.
- [ ] Um ex-membro falha ao decifrar qualquer conteúdo criado na nova época.
- [ ] O cliente apresenta claramente “rotação pendente” e o caminho de resolução para owner/admin.
- [ ] Alertas agendados são idempotentes e não geram ou transportam segredos.
- [ ] Frontend, Functions e rules tests passam no CI antes do deploy.

## 11. Prompt de execução para uma implementação assistida

```text
Trabalha no repositório Mnemosyne e implementa a rotação zero-knowledge de chaves de equipa por época, sem alterar dados fora do escopo e sem usar npm audit fix --force, git reset --hard ou git clean.

Objetivo de segurança: quando um membro sai, é removido ou tem a conta apagada, deve perder acesso a todo conteúdo novo da equipa. A chave AES nunca pode ser enviada ao backend em texto claro. Durante a rotação pendente, nenhuma escrita de equipa pode ser aceite.

Implementa em etapas pequenas e testáveis:
1. Antes de alterar, verifica git status, cria branch de trabalho e regista npm audit --omit=dev para frontend/functions.
2. Atualiza dependências segundo o guia: frontend firebase 12.19.0, Transformers 4.3.0, pdfjs-dist 6.3.289, react-router-dom 7.18.4, Vite 7.3.5, PostCSS 8.5.28, Capacitor CLI 8.5.2; functions firebase-admin 14.4.0, Firestore 9.2.0, firebase-functions 7.4.0, OpenAI 7.20.0, Firebase Web 12.19.0 e rules unit testing 5.0.1. Faz build/test após cada conjunto. Não edites lockfiles à mão.
3. Introduz `activeKeyEpoch`, `activeKeyId`, `keyRotationStatus`, `teams/{teamId}/keyEpochs/{epoch}` e `teamKeyRotations/{rotationId}`. Mantém dual-read dos documentos legados v1.
4. Muda o cofre do frontend de cache por `teamId` para cache por `teamId + epoch`. Cria envelope v2 e usa AES-GCM AAD com teamId, epoch e keyId. A chave nova é AES-GCM-256 e só existe no cliente desbloqueado.
5. Implementa transações server-side para request e commit da rotação. O request remove o membro da ACL, congela a equipa e cria o pedido. O commit valida owner/admin, expected old epoch, estado pending, conjunto exato de membros e wraps RSA-OAEP válidos; cria a época nova e ativa-a atomically. O backend nunca aceita campo de chave em claro.
6. Atualiza as regras Firestore: escrita de sessão de equipa só é permitida para membro atual quando a equipa está active e `keyEpoch`/`keyId` correspondem à época ativa. Mantém exceção de compatibilidade apenas para equipas ainda não migradas.
7. Atualiza UI e hooks para mostrar rotação pendente, bloquear escrita e permitir que owner/admin desbloqueado gere os wraps e confirme a nova época. Não fazer fallback cloud.
8. Adiciona uma função agendada idempotente que apenas deteta/recorda rotações pendentes e bloqueadas. Ela não pode gerar chaves, decryptar conteúdo ou reativar a chave velha.
9. Escreve testes unitários, rules emulator e integração que provem: ex-membro não abre dados novos, escrita fica bloqueada durante rekey, commit rejeita wraps incompletos/extras, retry é idempotente, e AAD impede reetiquetagem de ciphertext.
10. Executa e apresenta como evidência: npm ci, frontend lint/build/test/E2E, functions build/test, rules emulator com JDK 21, npm audit --omit=dev e git diff --check. Só declara conclusão quando critical for zero e todos os testes forem verdes.

Entrega um resumo por commit lógico, lista de ficheiros alterados, decisões de compatibilidade e qualquer alerta residual com proprietário e prazo. Nunca faça deploy sem apresentar o diff final e os resultados de validação.
```

## Referências

[1]: https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities/ "Auditing package dependencies for security vulnerabilities"
[2]: https://firebase.google.com/docs/firestore/manage-data/transactions "Transactions and batched writes"
[3]: https://www.rfc-editor.org/rfc/rfc9420.html "RFC 9420: The Messaging Layer Security Protocol"
[4]: https://firebase.google.com/docs/functions/schedule-functions "Schedule functions"
