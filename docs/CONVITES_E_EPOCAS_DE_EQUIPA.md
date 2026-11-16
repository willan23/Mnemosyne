# Convites ligados à época e à identidade — 2 de outubro de 2026

## Decisão

Um convite novo declara a época e o identificador da chave que o cliente usou para preparar o envelope. O servidor compara esses valores com a equipa e a época ativa na transação de gravação. Uma rotação entretanto iniciada ou concluída recusa o pedido; o servidor não atribui ao envelope um rótulo novo.

O pedido declara ainda o UID autenticado esperado, o UID do destinatário e SHA-256 da sua chave pública PEM, normalizada com trim e CRLF para LF. O servidor resolve novamente o email, recusa identidades Auth desativadas, compara o UID e lê a chave pública atual na transação. O fingerprint é metadado de identidade; não constitui prova de que um cliente malicioso cifrou a chave correta. O servidor continua sem receber a chave AES em claro.

Falha de consulta Auth recusa o pedido com erro fixo. Foi retirado o fallback que procurava apenas `publicProfiles.emailHash`: esse metadado não confirma existência ou estado atual da identidade Auth. Uma indisponibilidade temporária exige repetir mais tarde, sem criar o convite nem devolver um perfil através desse fallback.

## Contrato e gravação

`inviteMember` aceita exclusivamente `teamId`, `email`, `wrappedKey`, `expectedUid`, `inviteeUid`, `expectedKeyEpoch`, `expectedKeyId` e `publicKeyFingerprint`. IDs não aceitam caminhos; época exige inteiro seguro positivo; o envelope exige RSA-OAEP v1 e base64 canónico de 256–512 bytes. Pedidos de versões antigas sem contexto são recusados. Não se faz downgrade automático.

A transação verifica:

- Perfil e marcador permanente de caller/destinatário; estado e marcador do owner.
- Pertença e papel owner/admin atuais do caller; equipa fora de eliminação e rotação ativa.
- Época/keyId esperados e consistência de membros/envelopes da época ativa.
- Chave pública atual do destinatário, capacidade e convites pendentes da mesma identidade/época.

Incrementa `teams/{id}.inviteRevision`, cria o convite e cria o evento de auditoria num único commit. A revisão serializa também consultas inicialmente vazias: pedidos concorrentes equivalentes não produzem vários convites. A colisão/falha do evento não deixa convite ou revisão parcialmente gravados. O limite de cem registos de convite por equipa/destinatário exige inventário; não se assume que uma página cheia representa o conjunto completo.

## Aceitação e cliente

Aceitar um convite observa caller, autor do convite, owner e equipa na mesma transação. O autor deve continuar membro com papel autorizado. O prazo exato de expiração já é recusado. Convites novos voltam a comparar o fingerprint atual do destinatário. A alteração de membership, os wraps e o fingerprint da época ativa, o estado do convite e a auditoria são confirmados juntos. Um convite pendente para alguém já membro só pode ser confirmado quando o envelope coincide; não pode fornecer uma chave diferente à cache.

O cliente captura UID, época, keyId e email antes de preparar o pedido. Verifica conta/cofre, geração da cache e contexto da seleção depois de cada await. Mudança de conta, incluindo sair e voltar à mesma conta, invalida a preparação. Uma resposta tardia não produz sucesso na UI.

Na aceitação o cliente confirma que consegue desembrulhar o envelope antes de pedir membership. Depois do ACK lê a equipa no servidor e só coloca a chave na cache da época correta se época, keyId e envelope ainda coincidirem. Uma rotação posterior impede guardar a chave antiga como chave ativa. O listener normal pode desbloquear a nova época. Antes, a UI colocava todas as chaves aceites na época 1; esse percurso foi removido.

## Admissão em criação e commit de rotação

Criar/cancelar uma criação de equipa também lê o marcador permanente mesmo quando o perfil continua presente. Confirmar uma rotação, incluindo repetir uma confirmação já feita, recusa membros/owner com marcador ou equipa em eliminação. Isto impede publicar a nova época com wraps para uma conta revogada que ainda esteja listada no snapshot.

## Compatibilidade e trabalho restante

### Pedidos de rotação e limpeza interna

Pedidos normais de rotação e saída observam o marcador do caller antes de ler até um recibo de idempotência já existente. Remover um alvo revogado pelo percurso normal também é recusado. A limpeza de conta usa uma autoridade interna distinta, que só permite saída do próprio UID com marcador v1 em estado `deleting`, fase `documents`, sem reutilizar essa exceção para pedidos manuais, remoção de outros membros ou idempotency keys. A autoridade não é um campo do payload da callable. O scheduler exige a sua autoridade interna e reason `scheduled`; ter UID literal `system` numa chamada normal não concede essa autoridade.

As transações de pedido e supervisão lêem estado/marcadores dos destinatários antes de escrever notificações. Admins revogados não recebem novos registos; owner revogado/equipa em eliminação recusa pedido e é ignorado pela supervisão/scheduler. A remoção do membro e o congelamento continuam juntos; uma falha de auditoria reverte também notificações e recibo.

O helper de memberships exige a fase `documents` e a ausência de equipas ainda pertencentes ao UID. Foi retirado o atalho que apagava apenas o documento pai de uma equipa própria. Essas equipas exigem o purge ancorado de objetos/filhos da fase anterior; um resto inesperado conserva o pedido e Auth para reparação, sem declarar eliminação completa.

A revisão destes percursos não define ainda a retenção dos campos `requestedByUid`, `targetUid` e outros metadados de rotações/auditoria existentes. Esse inventário e a sua migração permanecem necessários.

Equipas sem época explícita só podem receber um pedido novo com contexto explícito de época 1 e keyId nulo. Aceitação de convites históricos sem fingerprint mantém a compatibilidade existente, observando marcadores e autorização atual. Perfis antigos ausentes são tolerados nesse percurso e no commit de rotação; criar convites novos exige perfis de caller/destinatário presentes. Essa compatibilidade exige migração e piloto antes de abrir o gate.

O gate `TEAM_WRITES_ENABLED` permanece fechado até concluir os restantes critérios de equipas. Continuam pendentes outros escritores de equipas, inventário de metadados com UID, histórico/anexos de outros autores, recuperação entre dispositivos, ensaio de migração e de revogação real. Perder o ACK de um convite não tem ainda journal idempotente no cliente: uma repetição recebe convite pendente e o utilizador consulta a lista; não se afirma recuperação automática completa. Perder o ACK da aceitação pode exigir verificar membership pelo listener.

Os testes deste incremento e os seus resultados finais são registados em [ADMISSAO_CONTAS_E_OPERACOES_EM_CURSO.md](ADMISSAO_CONTAS_E_OPERACOES_EM_CURSO.md). Não houve deploy nem chamadas reais a Auth/fornecedores neste incremento.
