# Criação atómica e recuperação da primeira época de equipa

30 de setembro de 2026. Implementada e validada localmente; não publicada. A fase 3 continua parcial e as flags de escrita de equipa continuam fechadas.

## Problema e decisão

A criação anterior gravava uma equipa legada sem época ativa e só depois gravava o evento de auditoria. Uma falha entre essas operações podia deixar estado incompleto. A criação passa a gravar equipa, `keyEpochs/1`, evento `created` e recibo de idempotência numa única transação Admin SDK. O ID da chave é um UUID gerado pelo servidor; a AES continua exclusivamente no cliente.

A identidade pública do proprietário deve estar publicada. O cliente envia `expectedUid` e o fingerprint SHA-256 do PEM normalizado com trim e CRLF convertido em LF, conservando maiúsculas/minúsculas. O servidor exige correspondência com o UID autenticado, lê a conta e o perfil público na transação e recusa conta ausente/em apagamento ou fingerprint alterado. O envelope RSA deve ter Base64 canónico e 256 a 512 bytes. Campos adicionais, incluindo material de chave em claro, são recusados. O servidor não consegue provar que o envelope contém uma AES correta; o cliente demonstra a sua recuperação antes de chamar a criação.

## Fluxo do cliente

`createTeamWithActiveEpoch` publica a identidade, gera a AES, prepara o envelope e recupera a chave pela RSA privada local. A publicação da identidade deixou de ser opcional: a falha impede criar a equipa. O coordenador verifica UID, cofre desbloqueado, evento de alteração da criptografia e geração da cache depois de cada operação assíncrona. Mudança de conta, lock ou cache impede enviar uma preparação antiga ou publicar uma resposta tardia na cache.

Antes de enviar, o coordenador cifra e persiste UID/nome/requestId/wrap/fingerprint no cofre pessoal, sem AES, mnemónica ou privada em claro. Web Locks por UID impede preparações simultâneas entre separadores. Falha de armazenamento impede envio. Uma tentativa posterior, incluindo com nova instância do coordenador, recupera exatamente o mesmo pedido, sem gerar AES nem republicar identidade. Checkpoints inválidos, trocados de UID, ilegíveis com o cofre atual ou preparados com outra identidade são conservados; não há fallback para JSON em claro. Pedir outro nome enquanto há preparação pendente é recusado.

`createTeamRemote` exige no ACK `teamId` válido, época positiva inteira, `activeKeyId` UUID e `alreadyCreated` booleano. A primeira criação começa na época 1; o retry devolve a época atualmente ativa. O cliente lê de novo a equipa do servidor, confirma owner/pertença/época/ID e só publica na cache a chave dessa época. Se a equipa já rodou, desbloqueia a época atual, em vez de restaurar a AES inicial. Só depois remove o checkpoint. Respostas inconsistentes ou falha de rede conservam a preparação. Os erros da UI são fixos, sem detalhes do servidor.

A UI mostra criação pendente e oferece Retomar criação, conservando o gate de criação fechado. O cancelamento exige confirmação e invalida o pedido no servidor antes de limpar a preparação local. A transação grava um marcador cancelado mesmo quando a criação ainda não chegou; uma criação concorrente ou tardia não passa depois desse cancelamento. Se a criação tiver terminado primeiro, a equipa permanece na lista. Falha de ACK, mudança de conta/cofre ou falta de armazenamento conserva o checkpoint para repetir o cancelamento. Cancelar é possível mesmo com a flag de novas criações fechada.

## Schema, compatibilidade e migração

- Equipa nova: campos existentes e `activeKeyEpoch: 1`, `activeKeyId`, `keyRotationStatus: active`, `pendingRotationId: null`, `nextRotationDueAt` em 90 dias e `updatedAt`.
- `teams/{id}/keyEpochs/1`: época/ID coincidentes, estado ativo, apenas o proprietário em membros/wraps/fingerprints, timestamps, `retiredAt: null`, `reason: team_created` e `rotationId: initial-<keyId>`.
- Evento `teamAudit`: campos allowlist de criação, sem conteúdo ou material criptográfico.
- `teamCreationRequests/{sha256(JSON([uid,requestId]))}` guarda UID, digest do payload normalizado, equipa e timestamp. Retries só aceitam o mesmo nome/wrap/fingerprint. Não recriam equipa apagada, não ignoram conta em apagamento e revalidam owner/pertença/época atuais. Cancelamento grava `status: cancelled` e conserva o primeiro timestamp; não apaga equipa/época.
- Recibos/marcadores ficam conservados até purga de conta. Não adicionar TTL que permita recriar um pedido antigo. A purga paginada de conta inclui esta coleção. Sem índice composto novo; as regras explicitamente negam toda a leitura/escrita de cliente nos recibos.
- `createTeam` exige agora `requestId` UUID canónico. Nova callable `cancelTeamCreation` exige UID esperado, requestId e confirmação. As duas partilham limite servidor de 20 chamadas por UID/minuto; cancelamento continua autenticado mesmo com novas criações fechadas.
- Checkpoint local `mnemosyne:team-creation:v1:<uid>`: envelope pessoal `{v,iv,ct}` com payload versionado. Um pedido pendente por conta neste dispositivo; nomes e wraps ficam dentro do ciphertext.
- Equipas legadas não são alteradas por esta criação; continuam a precisar do migrador administrativo antes de abrir escrita.
- Clientes antigos sem requestId/binding/fingerprint/ACK da época deixam de criar equipas quando este contrato for publicado. Publicar Functions/frontend/cancelamento/regras coordenados, mantendo o gate fechado durante a transição. Não eliminar recibos ao apagar uma equipa; isso reabriria a recriação por um retry.

## Validação

- `npm --prefix functions test`: **97 passaram**, zero falhas, uma suite de regras ignorada fora do emulador; TypeScript passou. Inclui rejeições sem escrita para UID/fingerprint alterados, identidade ausente, conta em apagamento, envelope inválido e campo de chave em claro, retry exato, equipa apagada, época posterior e cancelamento antes/depois da criação.
- Firebase CLI 15.32.0, JDK 21.0.12.1, projeto `demo-mnemosyne-rules`: **34 testes Functions + 19 frontend passaram**, saída zero, emuladores encerrados. Envelope RSA-OAEP/SHA-256 real com identidade sintética é recuperável; equipa/época têm o mesmo ID; externo e escrita de cliente são recusados. Duas criações concorrentes retornam a mesma equipa e criam um único recibo/evento. Colisão deliberada no create da auditoria não deixa gravações parciais; perfil alterado impede criação nova. Cancelamento concorrente vence qualquer retry tardio, não apaga equipa criada, separa namespaces de contas e recusa conta em apagamento. Recibos não são acessíveis a clientes.
- `npx vitest run src/services/teamCreation.test.ts src/services/teamsService.creation.test.ts src/components/TeamSettings.test.tsx src/utils/translations.test.ts`: **25 passaram**, antes da suite completa. Inclui checkpoint cifrado real, reutilização após ACK perdido, armazenamento negado, UID/cofre/identidade alterados, outro nome recusado, época posterior desbloqueada, resposta inconsistente, Web Locks, cancelamento com falha/conta alterada, confirmação negada e UI fechada pela flag.
- `npm --prefix frontend test -- --run`: **346 testes passaram em 79 ficheiros** (62,79 s), no estado final do frontend.
- `npm --prefix frontend run build`: TypeScript/Vite passaram, **3217 módulos**, 39,80 s de Vite. Mantêm-se os avisos existentes de chunks grandes e imports mistos.
- ESLint dos serviços/testes alterados e do componente: passou sem erros/avisos. A execução completa de lint da etapa anterior tinha 0 erros e 23 avisos; não foi repetida nesta etapa.

A primeira execução desta extensão encontrou um booleano local a sombrear a função de notificação do checkpoint; foi renomeado e o TypeScript/testes voltaram a passar. Um teste de retry reutilizava o mesmo spy com `vi.fn(spy)`, contando a tentativa anterior; passou a usar um novo wrapper. Não se desativaram validações ou testes para obter aprovação.

## Limites e próximos passos

Nenhuma equipa, perfil ou época de produção foi alterada pelos ensaios. Não houve deploy. Recuperação/idempotência/cancelamento foram implementados localmente. O servidor não comprova o conteúdo de um envelope RSA nem elimina cópias históricas. Apagar armazenamento do navegador ou perder o cofre pode perder a preparação local; uma equipa já confirmada continua na lista. Um checkpoint corrompido é conservado para recuperação/suporte, sem apagar silenciosamente o identificador nem fazer outra criação. Não se afirma compatibilidade com plataformas sem Web Locks, nem com dispositivos ainda não ensaiados.

Continuam pendentes a validação das regras/escritores/versões com época ativa, recifragem histórica paginada com checkpoint/cancelamento, migração administrativa, piloto entre papéis/plataformas, restauração isolada e gates gerais das fases 0–6. Não repor chaves antigas como ativas num rollback; manter a criação fechada se retirar o cliente novo.
