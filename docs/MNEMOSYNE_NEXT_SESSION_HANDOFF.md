# Mnemosyne Next Session Handoff

## Incremento validado — backup, restauro e retenção das identidades Comms, 13 de outubro de 2026

Novo serviço commsIdentityBackup e painel Settings.identity. Backup externo v1 cifrado com snapshot primária/pedido/histórico, dono/data/UUID internos, 4 MiB/20 entradas, RSA 2048–4096/e65537/probe. Ficheiro selecionado relido em inspect/restore/purge; prévia liga digest/snapshot/base remota. Restauro conserva antiga primária em v3, copia todos os diários sem substituir bytes e não omite primária do ficheiro distinta da selecionada para um pedido pendente. Retain preserva primária/pedido mesmo offline. Purga mostra impressões, verifica as mesmas no consentimento, exige arquivo exato no backup e exclui o pedido pendente. Contrato: [COMMS_BACKUP_IDENTIDADES.md](COMMS_BACKUP_IDENTIDADES.md).

Checkpoint novo namespace mnemosyne:comms-identity-backup:v1:encodedUID, coberto por accountDeletion. Formato v2 deduplica cifras/referências SHA256 de before/after; v1 legível. Estágio/readback/matches antes ou depois, recuperação e reversão confirmada; guardas de UID/cofre/vista/ficheiro/storage/remote CAS. hasPendingCommsIdentityRecovery bloqueia publicação, rollover/retained loading recusam estágio. observeCommsIdentityRollovers inclui estágio/história. openCommsIdentityJournal/History partilham validação; histórico v3 é só uma chave local, sem recibo fictício. Falha na leitura inicial deixa finalmente unsubscribe correto. Vista inativa desmontada; nome de ficheiro/input/FP retirados em mudança de conta/cofre.

1.157 gerais frontend/158 ficheiros, 106 focados/cinco antes do último teste de impressão, incluído na geral; build/TypeScript/lint escopo zero e geral zero erros/23 avisos anteriores. Quatro smokes públicos do build local; audits produção frontend/backend zero vulnerabilidades. Máximo de 20 arquivos 100KB/purga de um/checkpoint deduplicado testado. Aviso effect inicial corrigido, logs conservados.

Native Chromium actualpanel/controller/crypto/File/download/KV/WebLocks, Auth/RPC/executor DB sintéticos. Origem fechada antes de instalação vazia/restauro/abertura de mensagem RSA e wrap de equipa; pedido restaurado/retoma gate fechado; antiga primária retida; ABA em File.text/input retirado; purga/reimportação; readback primária falhou depois do put/recuperação ou reversão após reload; Bob conservado; token swap recusado antes DB. API helper real para read dispatcher/rollover de setup: quatro writes sintéticos de fixture, zero writes de backup, perfis/recibos/budget intactos. Três exports cifrados por execução guardados na pasta privada. Sem piloto real cloud/dispositivo/binário nativo atual.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-identity-backup-local-validation-20261013.json; logs comms-identity-backup-validation-20261013. Anterior b10d0d8214dcc7b0b09555294720c98205f23e62db255f10bdac8c0a918d13e9 imutável. Backend/rules/índices/dependências/CI/artefactos Functions conservados/comparados; suites backend/rules/CI remota não repetidas. 40 gates/21 fontes fechadas. Rollback precisa manter v3, checkpoint v1/v2 e cleanup. Nenhum deploy/produção/fornecedor.

**Próximo concreto:** ler W:\real\mnemosyne-launch-evidence\comms-identity-backup-validation-20261013\team-revision-next-plan.md. Ainda é plano: learningService.reviseLearnedMemory lê o pai ao submeter e usa revisão recente; CognitiveInput/draft só têm baseline pessoal. Implementar baseline completo antes de editar, diário/UUID/recibo/CAS/retoma de equipa e proveniência sem rebase oculto. Fonte teamSessionPersistence arquiva campos selecionados, omite learning, e só CAS numérico; não enfraquecer outros callers. Todas as outras áreas/fases 0–6 e smokes de rollout permanecem. Perguntas de projeto isolado/revogação histórica continuam pendentes; não repetir. Email wgftechnologies@gmail.com confirmado, alertas sem ativação/entrega verificada; objetivo ativo e deploy completo condicionado. Blocos seguintes históricos.

## Incremento validado — resolução explícita de conflitos de identidade, 13 de outubro de 2026

Publicação habitual passou a runTransaction sobre users/publicProfiles e recusa PEM remoto diferente. Rules permitem inicialização com getAfter do par e refresh da mesma chave; substituição/eliminação por SDK negadas. recover/cancel devolvem erro de conflito em committed/current false; inspect só lê recibo/perfis e valida ambas as cifras. republish exige prévia/confirmação, copia entrada e compara hash da cifra/UUID/impressão/base completa. Arquiva original antes de novo diário v2/UUID, reserva histórico, reutiliza candidata. v2 separa localPriorFingerprint da base remota e guarda cancelVaultRaw; v1 continua legível sem alterar bytes. Quatro RPCs têm envelope actorUid/request, UID ligado ao token antes de rate/DB. Helper executeCommsIdentityCall interno, não exportado em index HTTP. Contrato: [COMMS_IDENTIDADE_CONFLITOS.md](COMMS_IDENTIDADE_CONFLITOS.md).

1.110 frontend/156 ficheiros, 50 focados/três; TypeScript/build, lint escopo zero, geral zero erros/23 avisos anteriores. Backend 339 +um skip/quatro pipeline, 11 focados. Emulador: 202 Functions integrais; final dez identidade +23 regras frontend. Fixture Timestamp Admin no SDK e expectativa antiga de publicação isolada corrigidas; scripts não enfraquecem rules. Produto/rules iguais entre passagem integral Functions e final, só fixture frontend mudou. Wrapper inicial backend tentou caminho auxiliar inexistente; final correto passou. Logs conservados.

Dois harnesses de Chromium atualizados para transação/envelope/dispatcher: recusa de chave remota distinta sem commit; quatro swaps de token; inspeção após reload; confirmação recusada; base desatualizada; republish ACK perdido/retoma v2 com gate fechado; leitura RSA antiga. Crypto/storage/locks reais, Auth/RPC/base sintéticos. Quatro smokes públicos locais e audits de produção frontend/backend com zero vulnerabilidades. Sem piloto real cloud/dispositivo, CI remota ou artefacto nativo atual.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-identity-conflict-local-validation-20261013.json; logs comms-identity-conflict-validation-20261013. Predecessora b43f15c038beda8917cd17647d2b5e8d386477ccb45ef794fb64e3c955ea17ad imutável. 40 gates/21 fontes fechadas, saída preflight 2 esperada. Índices/storage.rules/dependências/CI inalterados/comparados; firestore.rules alterado. Rollback tem de conservar o envelope e os diários v2. Sem deploy/mutação de produção/fornecedor.

**Próximo concreto:** backup cifrado/restauro das identidades e retenção/purga explícita. Ler W:\real\mnemosyne-launch-evidence\comms-identity-conflict-validation-20261013\identity-backup-next-plan.md; é plano, não implementação. Sovereign export em utils/sovereignExport.ts só cobre memórias/grafo; RSA é aleatório, frase sozinha não recupera vault perdido. UI precisa funcionar sem pendência; avaliar secção identity em SettingsModal, preserve primary/pending/outro UID, guarda até File.text/download e finalmente para leitura inicial de storage. Não adicionar namespace durável sem cleanup de conta. As perguntas anteriores sobre projeto de restauro isolado/revogação histórica continuam pendentes; não repetir. Todas as outras áreas/fases 0–6 e smokes de lançamento permanecem obrigatórios, objetivo ativo/deploy completo condicionado. Email wgftechnologies@gmail.com confirmado; alertas sem ativação/entrega verificada. Blocos abaixo históricos.

## Incremento validado — recuperação de contacto com destinatário eliminado, 13 de outubro de 2026

Consulta/cancelamento devolvem revoked apenas por marcador permanente ou deletionState deleting, com conta do remetente e nonce/digest/fingerprint verificados. Auth/perfis/recibo purgados não impedem fecho do diário; falha transitória ou ausência sem marcador conserva a cifra. Marcadores são lidos antes de Auth e relidos após sucesso/falha. Criação recusada, sem recriar pedidos/pares/budgets. Cliente verifica datas válidas ou ambas null, limpa só a chave do UID atual e retira seleção do peer conservando o rascunho. Contrato: [COMMS_CONTACTOS_DESTINATARIO_ELIMINADO.md](COMMS_CONTACTOS_DESTINATARIO_ELIMINADO.md).

1.089 frontend/155 ficheiros e 337 Functions +um skip/quatro pipeline. 70 frontend focados/cinco ficheiros, 48 backend/pipeline e 13 focados finais no emulador. Build/TypeScript aprovados; lint escopo zero, geral zero erros/23 avisos anteriores. Suites gerais iniciais falharam em fixtures de formato/prontidão/snapshot; corrigidas e passagem final verde. Timeout P2P no browser concorrente conservado; browser final passou recuperação de pedido admitido/purgado após reload e regressões contacto/diretório/remoção/relay/P2P/IndexedDB. Auth/RPC/DB sintéticos no browser, Auth sintético no emulador; reposição só da fixture do peer para cenários independentes. Sem piloto real Firebase/dispositivo, suite integral rules/audits/CI remota não repetidos.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-contact-revocation-local-validation-20261012.json; logs comms-contact-revocation-validation-20261012. Nome conserva o início do incremento em 12/10, fecho em 13/10. Prova anterior de UID imutável, SHA256 f410b6ecf18b84dad575994e43d43fd3b22c0f1ed703039c03f2cb6a1b99b7e1. 40 gates/21 fontes fechadas. Rules/índices/dependências/CI e schema persistente conservados e hashes comparados; revoked é projeção, não novo estado gravado. Sem deploy/produção/fornecedor.

Próximo concreto: resolver candidata de identidade confirmada mas substituída remotamente; o journal continua conservado por result.status committed/current false em commsIdentityRollover. Conservar ambas as cifras, preparar resolução explícita sem substituir chaves silenciosamente; depois retenção/backup/equipas/writers e restantes fases 0–6. Aplicação real das cinco rooms legadas/14 candidatos, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e validação integral continuam pendentes. Objetivo ativo: todas as áreas antes do deploy completo autorizado. wgftechnologies@gmail.com confirmado, plano não ativado/entrega não verificada. Blocos seguintes são históricos.


## Incremento validado — UID capturado nos cinco comandos de contactos, 12 de outubro de 2026

Envelope RPC exato actorUid/request para lookup/create/status/cancel/respond. UID do corpo comparado ao token antes de gate/Auth/rate/DB, contexto e payload copiados antes dos awaits. Helper de transporte/dispatcher comum aos callables e integração. Payload canónico de três campos, digest, documentos v2 e diário v1 mantidos; recuperação não gera outro UUID nem reescreve a cifra. Contrato: [COMMS_CONTACTOS_UID_CAPTURADO.md](COMMS_CONTACTOS_UID_CAPTURADO.md).

1.078 frontend/154 ficheiros, 332 Functions +um skip e quatro pipeline, build/TypeScript e lint zero erros/23 avisos anteriores. 59 frontend focados/quatro ficheiros e lint escopo zero; 39 backend focados; dez focados no emulador. Chromium final recusa cinco swaps de token e confirma create/ACK perdido/retoma sem novo create, resposta do destinatário e cancelamento desconhecido com o envelope, além de regressões diretório/remoção/relay/P2P/IndexedDB. Auth/RPC/DB sintéticos no browser e Auth sintético no emulador; sem piloto real Firebase/dispositivo. Suite integral rules/audits/CI remota não repetidos.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-contact-actor-local-validation-20261012.json; logs comms-contact-actor-validation-20261012. Prova anterior da remoção imutável, SHA256 d2690b7e20c0665539b76e70f70091392ba9482eac0b966004e453d08d7cc631. 40 gates/21 fontes fechadas. Rules/índices/dependências/CI e schema persistente inalterados e hashes comparados. RPC antigo sem envelope recusado: Functions e clientes precisam de rollout/rollback coordenados. Sem deploy/produção/fornecedor.

Próximo concreto: recuperação terminal do pedido quando o destinatário é permanentemente eliminado; executeCommsContact ainda exige Auth do peer antes de consultar os marcadores e pode deixar um diário do remetente sem retoma/cancelamento. Resolver sem recriar referências; depois identidades/retenção/backup/equipas/writers e restantes fases 0–6. Aplicação real das cinco rooms legadas/14 candidatos, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e validação integral continuam pendentes. Objetivo ativo: todas as áreas antes do deploy completo autorizado. wgftechnologies@gmail.com confirmado, plano não ativado/entrega não verificada. Blocos seguintes são históricos.


## Incremento validado — remoção recuperável de contactos aceites, 12 de outubro de 2026

UID capturado no pedido comparado ao token antes de Auth/rate/DB. Confirmação retira pedidos ativos do par em duas direções, até 25 por transação, conservando documentos/campos adicionais/mensagens. Par privado bloqueado, recibo/UUID/digest estáveis e diretório sem perfil do par em remoção. Cópia local cifrada/lock por UID persiste até estado terminal. Intenção não admitida pode ser cancelada com checkpoint; progresso já admitido é conservado. Cleanup de conta cobre recibos nas duas direções e chave local exata. Contrato: [COMMS_REMOCAO_CONTACTOS_RECUPERAVEL.md](COMMS_REMOCAO_CONTACTOS_RECUPERAVEL.md).

Suites gerais: 1.076 frontend/154 ficheiros, 329 Functions +um skip antes do último reforço de UID. Após o reforço: 92 focados frontend/sete ficheiros, TypeScript/build e lint escopo zero; 40 backend/pipeline; cinco focados no emulador final. Lint geral zero erros/23 avisos anteriores antes do reforço. Chromium final confirma cifra/reload, ACK perdido, 25/50/61, retoma com admissão fechada, cancelamento desconhecido e replay sem writes, com regressões diretório/relay/P2P/IndexedDB. Auth/RPC/DB sintéticos no browser e Auth sintético no emulador; sem piloto cloud/nativo. Suite integral rules/audits/CI remota não repetidos.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-contact-removal-local-validation-20261012.json; logs comms-contact-removal-validation-20261012. Prova anterior do diretório imutável, SHA256 3e3f3db3f284b95ce17a4bb0de5c6e76cd01621dc74093d779f502376a320477. 40 gates/21 fontes fechadas. Índice composto anterior/rules/clientes exigem rollout coordenado; índice cloud não publicado/READY não verificado. Remoção não bloqueia utilizador/revoga chaves/fecha sala P2P; recibos ainda sem TTL/backup entre instalações. Rollback conserva lock/recuperação de operações admitidas.

Próximo concreto: vincular também UID capturado nos pedidos/respostas de contactos existentes, cujo contrato atual usa o UID do token; depois identidades/retenção/backup/equipas/writers e restantes fases 0–6. Aplicação real das cinco rooms legadas/14 candidatos, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e validação integral continuam pendentes. Objetivo ativo: todas as áreas antes do deploy completo autorizado. wgftechnologies@gmail.com confirmado, plano não ativado/entrega não verificada. Blocos seguintes são históricos.


## Incremento validado — diretório e procura de contactos aceites, 12 de outubro de 2026

Lista própria de relações aceites nas duas direções; até 26 candidatos por query, 25 percorridos por página, cursor UTF-8 e chave RSA pública atual validada no servidor. Procura pontual por UID/email exige relação aceite; cursor liga entrada e UID resolvido. Guards de conta/cofre/vista/edição retiram respostas tardias. Não há backfill, novos writes ou listagem global de perfis. Contrato: [COMMS_DIRETORIO_CONTACTOS_ACEITES.md](COMMS_DIRETORIO_CONTACTOS_ACEITES.md).

1.054 testes frontend/152 ficheiros; build/TypeScript e lint zero erros/23 avisos anteriores. 47 focados/quatro ficheiros e lint escopo zero. Functions 317 +um skip antes do último negativo adicional; passagem final 15 testes serviço/contrato +quatro pipeline. Três focados no emulador com Firestore real e Auth sintético. Chromium final passa 25 +6 contactos entre 100 pendentes, procura UID fora da página, email/seleção e outsider vazio, com regressões relay/P2P/IndexedDB. Zero pedidos externos/fornecedor/produção. Suite integral rules/audits/CI remota não repetidos.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-contact-directory-local-validation-20261012.json; logs comms-contact-directory-validation-20261012. Prova anterior da inbox imutável, SHA256 447cca67069b5fa106c520b688c6e42be33d276b5f893433159a192f27fad1aa. 40 gates/21 fontes fechadas. Três índices acrescentados apenas ao manifesto; os anteriores/field overrides foram comparados. Índices cloud não publicados nem READY verificado. Relações duplicadas são deduplicadas só na página, sem promessa de snapshot global.

Próximo concreto: remoção recuperável de contactos aceites; concluir identidades/retenção/backup/equipas/writers e restantes fases 0–6. Aplicação real das cinco rooms legadas/14 candidatos, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e validação integral continuam pendentes. Objetivo ativo: todas as áreas antes do deploy completo autorizado. wgftechnologies@gmail.com confirmado, plano não ativado/entrega não verificada. Blocos seguintes são históricos.


## Incremento validado — inbox P2P com registos indisponíveis, 12 de outubro de 2026

Store enumera até dez candidatos +peek; schema inválido é contabilizado sem falhar outras linhas. Leitor verifica cifra/UID/digest/abertura por cópia e conserva saudáveis; mudança de contexto ou falha de serviço interrompe a página, sem plaintext parcial. Cursor nativo copiado/validado por UID permite avançar past metadata malformada. Limpeza usa intervalo primário UID exato e abrange chaves em arrays/cópias fora do índice, conservando outra conta. UI tem contagem scoped e navegação, sem apagar cifras/ACK/receipt failed. Contrato: [COMMS_P2P_INBOX_INDISPONIVEIS.md](COMMS_P2P_INBOX_INDISPONIVEIS.md).

1.046 testes frontend gerais/152 ficheiros, build/TypeScript e lint zero erros/23 avisos anteriores; 61 focados/cinco ficheiros e lint escopo zero antes da última fixture determinística, incluída na suite geral posterior. Chromium real de painel/serviços/RSA/AES/IndexedDB/locks com Auth/RPC/DB sintéticos passou 10 bad index rows +páginas 10/2 saudáveis, mistura quatro indisponíveis/seis abertas e purge de UID incluindo array/unindexed com outra conta retida. Registos adicionais são fixtures cifradas locais, não nova admissão de entrega. Regressões WebRTC nativo/anexo 192 KiB/retoma/ACK/reload/reconciliação/relay/páginas incluídas; zero externos/produção/fornecedor. Backend/rules/CI/índices/dependências e artefactos backend conservados; suites backend anteriores não repetidas.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-p2p-inbox-local-validation-20261012.json; logs comms-p2p-inbox-validation-20261012. Prova anterior de legado imutável, SHA256 0e42c511a072e3abbcaa4b269aa77ee7c23d0d502dafc80bd4e39aa73589253d. 40 gates/21 fontes fechadas. Cópias indisponíveis não são reparadas/reindexadas automaticamente; registos sem timeline não aparecem na contagem, mas a purga cobre-os. Sem produção/deploy/alertas ativados.

Próximo concreto: diretório de contactos aceites independente das duas páginas de pedidos; completar identidades/retensão/equipas/writers. A aplicação real das cinco rooms legadas/14 candidatos, pilotos/cutover, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e validação final continuam pendentes. Objetivo ativo: todas as fases 0–6 antes do deploy completo autorizado. wgftechnologies@gmail.com confirmado, plano não ativado/entrega não verificada. Blocos seguintes são históricos.


## Incremento validado — inventário/reconciliação do P2P antigo, 12 de outubro de 2026

Admin CLI projeta metadata/versões de rooms e dos dois collection groups, sem SDP/ICE/labels/campos de UID no output. Vínculo explícito a projeto e base (default). Datas antigas do cliente não autorizam purga: cutover usa source/release de rules verificadas, serverTimestamp/readTime e prazo de dez minutos. Planos/UUIDs estáveis capturam versões/hashes; transação retira apenas sinalização conhecida e até 32 candidatos por lado, conserva campos adicionais/budgets e grava recibo. Continuação usa o commit do recibo privado anterior; substituições/rooms v2/órfãos com pai recriado são recusados. Recibos têm limpeza de conta nas três direções e não recriam referências após marcadores. Contrato: [COMMS_P2P_LEGADO_RECONCILIACAO.md](COMMS_P2P_LEGADO_RECONCILIACAO.md).

Consulta real de metadata a mnemosyne-one/(default) às 11:45:43 UTC: cinco rooms legadas, dez callerCandidates e quatro calleeCandidates associados, zero órfãos observados; páginas completas, clean=false, zero mutações. W:\real\mnemosyne-launch-evidence\comms-p2p-legacy-validation-20261012\production-metadata-final.json. Nenhum marcador/plano foi aplicado em produção. A aplicação destes cinco roots faz parte do rollout completo depois das restantes áreas; não inferir ausência global de órfãos de páginas independentes.

311 unitários Functions +um skip antes do reforço final da base (default); 17 focados finais (dez serviço/contrato, três verificador Rules API/CLI e quatro pipeline), build; cinco focados finais no emulador com versões de commit reais, SDK negado, retoma/órfãos/páginas e cleanup da conta. O emulador injeta política Rules API sintética e graceMs=0; default de dez minutos é testado em unidade, não espera cloud real. CI inclui novos testes de política/CLI, sem execução remota. Frontend/artifactos/dependências/índices/storage.rules inalterados e hashes comparados; não repetir alegações de teste frontend/audit como execução atual.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-p2p-legacy-local-validation-20261012.json; 40 gates/21 fontes fechadas. Prova anterior de expiração v2 imutável: SHA256 42c2530ba4b141567a6b313acd180c3f82008a76a5ba59a1a1ca5a7ca794e4c7. Falhas de tipagem SDK/mock reparadas com logs preservados. Sem deploy, fornecedor generativo, alertas ou alteração de produção.

Próximo concreto: isolar registos inválidos da inbox P2P local para não suprimirem cópias saudáveis da mesma página; concluir diretório/contactos/identidades/equipas/writers. Aplicação do legado, pilotos/cutover, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e verificação integral continuam pendentes. Todas as fases 0–6 antes do deploy completo já autorizado; objetivo ativo. wgftechnologies@gmail.com confirmado, plano não ativado/entrega não verificada. Blocos seguintes são históricos.


## Incremento validado — expiração/reconciliação P2P v2, 12 de outubro de 2026

Worker EU de cinco em cinco minutos, com gate fechado, elimina apenas root v2 vencido/validado e duas coleções limitadas de ICE atomicamente; conserva recibos/budgets/conteúdo. Varredura de 50 candidatos usa cursor privado de expiração/ID e CAS, passando registos retidos sem bloquear os seguintes. SDK do cursor fechado. Guardas do cliente consultam estado autenticado e retiram apenas a referência local terminal, sem outro write ou perda da cápsula pendente. Watch faz a reconciliação e Verificar sala P2P guardada funciona após perder o peer/reload, mesmo com admissão fechada. Contrato: [COMMS_P2P_EXPIRACAO_RECONCILIACAO.md](COMMS_P2P_EXPIRACAO_RECONCILIACAO.md).

46 testes frontend/quatro ficheiros, build/TypeScript e lint do escopo zero erros/avisos; 24 Functions focados (quatro cleanup, 12 sinalização, oito conteúdo), quatro pipeline. 181 backend +23 frontend no emulador começaram antes do refinamento final dos limites da query/cursor; três focados finais no emulador validam a fonte posterior, incluindo timestamp fracionário retido e empate entre IDs. Chromium com dois peers/painel/controladores/executores/crypto/IndexedDB/locks reais e Auth/RPC/DB sintéticos passou reconciliação automática, consulta de root purgado sem write, preservação do recibo e regressões de anexo 192 KiB/retoma/inbox/relay/páginas. Browser precede apenas o refinamento da query de varredura, sem alteração à remoção de room ou ao cliente. Zero externos/fornecedor/produção. Suites gerais/audits não repetidos; histórico anterior conserva data/prova.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-p2p-cleanup-local-validation-20261012.json; logs em comms-p2p-cleanup-validation-20261012. 39 gates/20 fontes fechadas. Prova anterior de conteúdo imutável: SHA256 27379c3fb6baefbb31637ebeabeae7583f47380b787e0acd53bd3d0b69c86d53. Fontes/artefactos atuais divergem das provas anteriores; sem deploy/binário nativo/alertas ativados.

Próximo concreto: inventário/reconciliação de rooms legadas sem prazo confiável e candidatos órfãos, depois pilotos/cutover. Não apagar legado por suposição ou timestamp isolado. Permanecem registo local inválido que falha a página, retenção/identidades/equipas/writers, cloud/segredos/alertas/restauração/pilotos, qualidade, agentes/acessibilidade e validação final. Objetivo ativo: todas as fases 0–6 antes do deploy completo autorizado. wgftechnologies@gmail.com confirmado, plano não ativado/entrega não verificada. Blocos seguintes são históricos.


## Incremento validado — entrega P2P recuperável, 12 de outubro de 2026

Conteúdo P2P conserva diário cifrado/UUID/cifra antes da admissão. O servidor recebe apenas descriptor e sala, com UID/Auth/participantes/fingerprints atuais, recibo privado e budgets partilhados com relay. Fragmentação respeita SCTP/16 KiB, reassembly tem dois slots/60 s, backpressure/fila são limitados. Destinatário verifica bytes/digest, guarda cifra pessoal em IndexedDB com CAS/releitura antes de abrir e pedir ACK. Remetente só retira diário depois de consultar recibo recebido; ACK do canal não é autoridade. Retoma noutra sala conserva pacote e não cobra outra quota. Inbox local paginada/recuperação manual/limpeza exata UID incluídas. Contrato: [COMMS_P2P_ENTREGA_RECUPERAVEL.md](COMMS_P2P_ENTREGA_RECUPERAVEL.md).

1.035 testes gerais frontend/152 ficheiros antes de três regressões adicionais; 93 focados finais/oito ficheiros, TypeScript/build e lint zero erros/23 avisos anteriores, zero no escopo alterado. 297 Functions +um skip; quatro pipeline; 178 backend +23 frontend no emulador demo. Chromium com dois peers/painel/controladores/executores/RSA/AES/IndexedDB/Web Locks reais e Auth/RPC/DB sintéticos verificou ACK perdido/reload, anexo 192 KiB interrompido/retomado com mesma cifra/ID e quotas, e páginas 10+2/CAS/purga UID no IndexedDB nativo. Focados recusam ACK falso, cifra adulterada e contexto retirado durante abertura. Logs de falhas preservados. Prova privada: W:\real\mnemosyne-launch-evidence\comms-p2p-content-local-validation-20261012.json. 38 gates/19 fontes fechadas, zero fornecedor/externos/produção/deploy. Audits não repetidos; manifestos inalterados e provas anteriores conservadas.

Próximo: limpeza automática de SDP/ICE expirados e reconciliação das referências/salas legadas, com testes/pilotos/cutover. Ambos os peers ainda fecham explicitamente a referência anterior antes de negociar outra sala; registo local inválido falha a página. Restam retenção/identidades/equipas/writers, cloud/segredos/alertas/restauração/pilotos, qualidade, agentes/acessibilidade e validação final. Todas as fases 0–6 precedem o deploy completo autorizado. Email wgftechnologies@gmail.com confirmado; plano ainda não ativado/entregue. Blocos abaixo são históricos.


## Estado de continuação — 12 de outubro de 2026

Mais recente: sinalização P2P recuperável. Contrato [COMMS_P2P_SINALIZACAO_RECUPERAVEL.md](COMMS_P2P_SINALIZACAO_RECUPERAVEL.md), prova `W:\real\mnemosyne-launch-evidence\comms-p2p-signaling-local-validation-20261012.json`, logs `comms-p2p-signaling-validation-20261012`. Room/SDP/ICE/fecho são server-owned: actor/token/participantes/fingerprints/oferta, recibos/budgets atómicos, diário cifrado por UID e referência cifrada de sala. Recuperação conserva operação e fecho depois de perder peer não cria nova negociação. Rules fecham SDK P2P; cleanup abrange novos roots/slots. Sinais expirados não são retornados, mas limpeza automática/legado ainda pendente. Observer de identidade agora filtra keys próprias; projection de room v2 conserva createdAt; fecho aparece depois de limpar composição.

1.014 frontend gerais/150 ficheiros antes dos últimos ajustes/testes; 99 focados finais/oito ficheiros, build/lint escopo; 288 Functions +um skip antes da regressão adicional, 20 focados finais; quatro pipeline; 175 backend +23 frontend emulador. Dois peers WebRTC nativos no painel Chromium com serviço/executores/crypto/locks reais e Auth/RPC/DB sintéticos: ACK perdido de proposta/mesma sala, fecho guardado, oferta/resposta/ICE admitidos, mensagem decifrada e remoção de sinais. Regressões relay/paginação incluídas; zero externos/produção. 37 gates/18 fontes fechadas. Provas anteriores imutáveis e históricas.

Próximo concreto: conteúdo P2P com diário/cifra/UUID estáveis, ACK durável, fragmentação/reassembly/limites/retoma/reconciliação. Depois limpeza automática de expiração/legado e pilotos/cutover; retenção/identidades/equipas/writers, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e validação final. Não considerar send() como confirmação. Email wgftechnologies@gmail.com confirmado, plano não ativado. Objetivo ativo: todas as fases 0–6 antes do deploy completo autorizado. Parágrafos seguintes são históricos.

Mais recente: listas Comms paginadas. Contrato [COMMS_LISTAS_PAGINADAS.md](COMMS_LISTAS_PAGINADAS.md), prova `W:\real\mnemosyne-launch-evidence\comms-pagination-local-validation-20261012.json`, logs `comms-pagination-validation-20261011`. Cinco queries de coleção do painel passam a callable EU com UID capturado, autorização por registo, schema/projeção/byte cap. Cursores da mesma conta/família seguem UTF-8 e IDs longos de candidatos indisponíveis. Participante revogado não falha outras linhas; falhas transitórias limpam a página e mostram erro. UI conserva uma página, tem Anterior/Seguinte/Atualizar e refresh visível a cada 30s. Perfis pontuais falhados não retiram todos os contactos. Rules/índices/dependências inalterados.

1.006 gerais frontend/149 ficheiros; 38 focados finais/quatro ficheiros, builds/lint escopo; 276 unitários Functions +um skip separado antes do ajuste final de cursores, oito focados finais; quatro pipeline; três emulador finais. Chromium com 25+quatro cápsulas, três indisponíveis, retorno e regressão de entrega/ACK; Auth/RPC/DB sintéticos, zero externos/produção. 36 gates/17 fontes fechadas. Provas anteriores imutáveis e históricas; fontes/artefactos atuais divergem.

Próximo: P2P com admissão/sinalização/ACK/fragmentação/retoma/reconciliação e cutover. Depois retenção/identidades, revisão de equipa/writers, cloud/segredos/alertas/restauração/pilotos, qualidade, agentes/acessibilidade e validação final. Contactos aceites refletem as duas páginas de pedidos; pesquisa/lista independente ainda pendente. Email wgftechnologies@gmail.com confirmado, plano não ativado. Objetivo continua ativo: todas as fases 0–6 antes do deploy completo autorizado. Os blocos seguintes são históricos.

Mais recente: entrega Comms recuperável. Contrato [COMMS_ENTREGA_RECUPERAVEL.md](COMMS_ENTREGA_RECUPERAVEL.md); prova `W:\real\mnemosyne-launch-evidence\comms-delivery-local-validation-20261011.json`, logs `comms-delivery-validation-20261011`. Relay usa diário cifrado/UUID/cifra estáveis, callables EU, UID capturado/Auth, fingerprints e conta ativa, cápsula/recibo/três budgets atómicos. Status/cancel/ACK idempotentes; ACK manual recupera perda de confirmação. Cancelar não devolve quota/revoga cópias. Destinatário purgado termina sem recriar referências. Rules bloqueiam mutações SDK; cleanup abrange novas roots. Novo gate P2P permanece fechado.

Validação: 1.000 gerais frontend/148 ficheiros antes do último teste; 85 focados finais/sete ficheiros e builds/lint escopo; 268 unitários Functions +um skip separado, 23 focados finais; 169 backend +23 frontend rules e cinco backend focados finais; quatro pipeline. Chromium com painel/controller/recovery/ACK/executores reais e Auth/RPC/DB sintéticos, zero externos/produção. 36 gates/17 fontes fechadas. Logs de falhas e provas anteriores preservados; fontes/artefactos backend divergem das provas anteriores.

Próximo: P2P com admissão/sinalização/ACK/fragmentação/retoma e cutover; listas paginadas autorizadas que tratem participantes revogados sem falhar toda a inbox. Restam identidades/equipas/writers, pilotos/configurações/segredos/restauração, qualidade, agentes/acessibilidade e validação final. Email operacional confirmado wgftechnologies@gmail.com; plano não ativado. Objetivo ativo: todas as fases 0–6 antes do deploy completo autorizado. Não substituir por lançamento reduzido. Os parágrafos seguintes são históricos.

Mais recente: transporte Comms contextual/limitado. Contrato [COMMS_TRANSPORTE_CONTEXTUAL.md](COMMS_TRANSPORTE_CONTEXTUAL.md), prova `W:\real\mnemosyne-launch-evidence\comms-transport-local-validation-20261011.json`, logs `comms-transport-validation-20261011`. O cliente captura composição/sender/destino/FP e vincula peer/room/instância; guards cobrem crypto/send/offer/answer/ICE e callbacks tardios de outbox/rooms. MIME ativo passa a download binário e limites/base64/schema/tamanho são verificados. Não cria receipt failed por falta local de chave ou por ACK perdido depois de decrypt. Backend/rules/índices/dependências são os da prova de contactos; não repetir alegações de emulador como execução atual.

Próximo trabalho concreto: envio recuperável/idempotente por relay com diário cifrado, UUID/status/cancelamento/ACK, fingerprint e contas ativas e budget transacional; P2P com confirmação/fragmentação/retoma e regras coordenadas para impedir bypass. Listas/inbox revogado/legado/rooms órfãs/pilotos continuam. O objetivo permanece todas as fases 0–6 antes do deploy autorizado; conservar ativo, árvore misturada e provas imutáveis.

Mais recente: contactos Comms recuperáveis. Prova `W:\real\mnemosyne-launch-evidence\comms-contact-local-validation-20261011.json`, logs `comms-contact-validation-20261011`, contrato [COMMS_CONTACTOS_RECUPERAVEIS.md](COMMS_CONTACTOS_RECUPERAVEIS.md). Lookup pontual EU por Auth/perfis; pedido cifrado/UUID/lock, request/par/budget atómicos; receiver responde idempotentemente; cancelamento não retira contacto aceite. Legado pending/accepted impede duplicados; cap >50 recusa descoberta incompleta. Rules fecham mutações diretas de friendRequests; novo índice fromUid/toUid só no manifesto. Cleanup abrange pares nas duas direções/budgets/diário próprio. Wrapper Comms retira o estado e não adota o mesmo draft após perda de contexto; unmount fecha peers locais. Não considerar isso proteção de todos os handlers de send/offer/answer/ICE.

Validação: 962 gerais frontend/145 ficheiros antes do ajuste final de observer/teste adicional; 60 focados finais/cinco ficheiros, tipos/lint escopo/build; lint completo zero erros/23 avisos anteriores. 256 unitários Functions (um teste separado ignorado); 165 backend no emulador. Primeira frontend rules falhou no contrato antigo de escrita direta; corrigido, depois cinco backend focados (incluindo asserts novos de cleanup dos pares) e 23 frontend rules passaram. Quatro testes preflight/pipeline e audits produção zero. Chromium com painel/controller/recovery/executores/crypto/storage/locks reais e Auth/RPC/DB/streams sintéticos, zero pedidos externos/produção. Falhas de tipos/matcher/sintaxe/contrato conservadas. 33 gates/16 fontes fechadas. Fontes e artefactos atuais divergem das provas anteriores.

Próxima área: envio recuperável por relay/P2P e limites/guards de transporte, incluindo handlers que ainda leem Auth após awaits em TransmissionPanel. Também: paginação, inbox que trate revogação sem a query inteira falhar, históricos acima do cap, remoção de contactos aceites, pilotos/cutover. Não reabrir descoberta por listagem. O objetivo continua todas as fases 0–6 antes do deploy completo já autorizado; manter ativo e preservar a árvore misturada/provas.

Incremento mais recente: troca recuperável da identidade Comms. Prova privada `W:\real\mnemosyne-launch-evidence\comms-identity-rollover-local-validation-20261011.json`, logs `comms-rollover-validation-20261011`, contrato [COMMS_IDENTIDADE_RECUPERAVEL.md](COMMS_IDENTIDADE_RECUPERAVEL.md). Substitui a próxima ação de rollover no bloco anterior abaixo. Backend/rules foram alterados: quatro callables EU, novo contrato/executor, roots privados e cleanup. Primário antigo/candidata são cifrados antes de aplicar; retoma/cancelamento usa pedido estável e status atual, sem rebase/geração automática. Publicação habitual recusa pending. Mensagens/wraps antigos tentam histórico local com guardas; cache de handles é retirada ao fechar. Limite 20 históricos; conflito remoto de identidade substituída conserva pending e precisa de resolução explícita ainda pendente.

Validação: 942 gerais frontend/143 ficheiros antes do último ajuste de cache/teste adicional; 89 focados finais/sete ficheiros, TypeScript/lint escopo/build, lint completo zero erros/23 avisos anteriores, 246 unitários Functions (um teste separado ignorado), 161 Functions +23 frontend no emulador, quatro testes preflight/pipeline e audits produção zero. A suite geral do emulador começou antes do último reforço de UID do perfil; passagem focada final no emulador e unitário novo validam a fonte posterior. Browser de controlador/painel/crypto/storage/locks/executor reais, Auth/RPC/DB sintéticos, zero pedidos externos/fornecedor/produção. Falhas iniciais BigInt target e JSX do harness foram corrigidas, logs preservados. 31 gates/15 ficheiros fechados, sem deploy/binário nativo novo.

Próxima área autorizada: concluir contactos/resolução/envio/rooms e limites/recuperação de entrega Comms, com todo o estado/callbacks ligados ao UID/cofre/painel. A query de email continua recusada pelas rules; usar descoberta autorizada e não reabrir listagem pública. Revisão de equipa/base/recuperação e restantes fases continuam pendentes. Conservar o objetivo e a autorização condicional de deploy completo; não pedir novamente autorização já dada ou repetir as perguntas externas pendentes.

Objetivo ativo: concluir todas as fases 0–6 antes do deploy completo já autorizado. Branch `main`, HEAD `4688641a4535371b05b95ef7f47e91b3153610a4`, alterações locais misturadas. Preservar a árvore atual; não restaurar/limpar/commitar tudo. Usar Node 22.23.3 de `W:\real\mnemosyne-launch-tools\node-v22.23.3-win-x64` e JBR Android Studio 21 para os emuladores exclusivamente `demo-mnemosyne-rules`. O estado completo e limites atuais estão em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md); os blocos de setembro abaixo são históricos.

Fechados localmente: revisão pessoal com baseline/recibo/diário/arquivo/orçamento e importação individual Comms com IDs próprios/anexo cifrado/recuperação. Provas privadas imutáveis:

- `W:\real\mnemosyne-launch-evidence\personal-revision-local-validation-20261009.json`, SHA256 `4b09e4a3d2eff622ca4621cb3d128f18962de2d32ebedd5ab629288bf7036c0a`. Validação terminou a 10 de outubro: 830 gerais frontend/135 ficheiros (antes do tratamento final da baseline indisponível), 78 focados finais/seis ficheiros, 237 unitários Functions/um skip e 156 Functions +23 frontend no emulador. A falha de teste de escrita sem alteração foi corrigida para mudança e reposição reais; suite completa final passou.
- `W:\real\mnemosyne-launch-evidence\comms-import-local-validation-20261010.json`, SHA256 `84470b05ad32f3b22610843bda72ef09da6a991f484c56a75d4bbe1027c4b210`. 863 gerais frontend/138 ficheiros, 61 focados finais/cinco ficheiros (incluindo dois testes UI posteriores à suite geral), build/TypeScript e lint zero erros/23 avisos anteriores. Audits atuais de produção zero. Chromium usou cifra/ficheiros/IndexedDB/locks reais, executor real com DB/upload sintéticos localhost e zero pedidos externos. Backend/rules não alterados; suites anteriores conservam data/prova próprias e hashes comparados. Logs `comms-*-20261010.log` na pasta privada.

Todos os processos destes incrementos terminaram. 29 gates/14 ficheiros permanecem fechados. Sem fornecedor real, produção ou deploy; o APK debug anterior pertence a outra revisão. O plano de alertas conserva wgftechnologies@gmail.com, `applied=false`, `deliveryVerified=false`. Bucket/export EU foram autorizados anteriormente; não repetir a autorização. Não repetir perguntas pendentes sobre destino isolado de restauração ou evidência de revogação histórica.

Rascunho cifrado do compositor concluído localmente neste incremento: `cognitiveDraft.ts`/`cognitiveDraftStore.ts`/`useCognitiveDraft.ts`, ligados a `CognitiveInput` e limpeza exata por UID. Texto/imagem/prompt/resultado/base pessoal são cifrados, CAS protege outra aba e contexto retira plaintext/imagens. Legado global sem dono nunca é adotado; descarte explícito exige confirmação. Equipa exige ACL/época atual, mas a base transacional de revisão de equipa continua pendente. Prova privada `W:\real\mnemosyne-launch-evidence\cognitive-draft-local-validation-20261010.json`; logs permanentes em `cognitive-draft-validation-20261010`. 894 gerais/140 ficheiros precedem quatro testes adicionais e últimos ajustes; 61 focados finais/quatro ficheiros, TypeScript/lint do escopo/build finais e Chromium real de compositor/AES/IndexedDB/locks passaram. Nenhum backend/rules alterado ou provider/produção/deploy. Durabilidade só depois de confirmação local; detalhes em [RASCUNHOS_CIFRADOS_CAPTURA.md](RASCUNHOS_CIFRADOS_CAPTURA.md).

Identidade Comms: guardas até à preparação local/hash/batch atómico de dois perfis, Web Locks por UID, cache ligada aos bytes da cifra e retirada ao mudar o cofre. App/painel/criação/convite/rotação propagam as guardas. Prova privada `W:\real\mnemosyne-launch-evidence\comms-identity-local-validation-20261011.json`; logs `comms-identity-validation-20261011`. 913 gerais/141 ficheiros antes da correlação final da cache/teste adicional; 59 focados finais/seis ficheiros, TypeScript/lint do escopo/build finais e browser de serviço/RSA/AES/storage/locks reais passaram, contra fronteiras Auth/perfis/batch sintéticas. Falha de dependency de rotação ainda tipada com dois argumentos foi corrigida; log conservado. Backend/rules/dependências de produto inalterados.

Próximo incremento concreto: regeneração recuperável de identidade, conservando as cifras antiga/nova antes de qualquer troca e confirmando o estado remoto sem nova geração após perda de ACK. O reset atual ainda elimina o primário antigo antes de publicar; não declarar esse caminho completo. Depois, contactos/resolução/envio/rooms e limites de transporte: `TransmissionPanel` ainda tem handlers que leem Auth depois dos awaits e estado não ligado ao contexto, e a query de email é recusada pelas rules de descoberta. Não reabrir listagem pública. Revisão de equipa com base capturada e escrita recuperável continua pendente. Preservar provas imutáveis e a cronologia: fontes frontend atuais divergem das provas pessoais/Comms/rascunho anteriores. As perguntas externas já colocadas permanecem pendentes, sem as repetir.

Pendências restantes: outros handlers Comms/identidade/rooms/contactos/envio e limites de transporte; team draft baseline/fluxos legados/rules/migrações; retenção/purga/instalações/quotas; segredos e revogação histórica; alertas/entrega, restauração isolada e backups Auth/objetos/chaves; App Check/pilotos/binários assinados; benchmark multilíngue de cofres grandes/retrieval/injection; agentes com escrita/preview/confirmação/reversão/auditoria e acessibilidade. Nenhuma fase completa pode ser inferida destes incrementos. Não ativar gates ou fazer deploy enquanto o objetivo completo estiver por cumprir.

Data: **2026-09-15** (bloco novo no topo)
Continuar em: `W:\real\Mnemosyne`  
Produção: https://mnemosyne-one.web.app · https://mnemosyne-one.com

## Update — 15 set 2026 (auditoria → implementação)

### Feito em código
- **Secrets Stripe:** `functions/src/params.ts` + `defineSecret`; removido `functions.config()` de `stripe.ts`. Script: `scripts/sync-function-secrets.ps1`.
- **Checkout:** activo se existir `VITE_STRIPE_PUBLISHABLE_KEY` (Founder Preview continua free-first nas rules — sem `paid` enforcement). Pricing permite upgrade voluntário.
- **Rules:** creates de `sessions` exigem `enc` + `text==''`; removido `hasSharedAccess` morto.
- **Regions:** `trackShareView` / `trackConversion` / `onMemoryShared` → `europe-west1`.
- **/status** página pública honesta; footer link.
- **Sentry opcional:** `VITE_SENTRY_DSN` + scrub de conteúdo.
- **Playwright smoke:** `frontend/e2e/smoke.spec.ts` (`npm run test:e2e`).
- **i18n:** toasts Captura/Comms (menos `alert()`).

### A tua parte (ops — consola)
1. App Check: **reCAPTCHA v3 clássico** (não Enterprise).
   https://www.google.com/recaptcha/admin → v3 → domains `mnemosyne-one.com`, `www.mnemosyne-one.com`, `mnemosyne-one.web.app`, `localhost` →
   Firebase App Check → provider **reCAPTCHA v3** → `VITE_FIREBASE_APPCHECK_SITE_KEY` → rebuild hosting (modo **monitor**).
   Se a consola mostrar Enterprise desactivado: ignora; o código default é v3.
2. Opcional Secret Manager: `powershell -File scripts/sync-function-secrets.ps1` (hoje Stripe lê `functions/.env`)
3. PITR Firestore na consola; opcional `VITE_SENTRY_DSN`
4. Smoke Stripe: `/pricing` → checkout test mode (price IDs + webhook EU)
5. Smoke Comms 2 contas
6. **Não** pôr `config/monetization.mode=paid` sem quiseres bloquear free uploads

### Deploy 15–16 set
- Hosting + firestore.rules + functions OK
- Apagadas `trackShareView` / `trackConversion` / `onMemoryShared` em `us-central1`; recriadas em `europe-west1`
- Webhook: `https://europe-west1-mnemosyne-one.cloudfunctions.net/handleStripeWebhook`

---

## Update — 14 set 2026 (Obsidian / Starter / HUD / estudo / temas)

### Estado
- **Importer de vault Obsidian:** pastas + `.md` + frontmatter + `[[wikilinks]]` → memórias E2EE + `connections` persistidas + hubs por pasta de topo. Auto-detect em drop/pasta (web + Tauri). Limite 150 notas/import. Código: `obsidianVaultParse.ts`, `obsidianVaultImport.ts`.
- **Starter Founder in-app:** 42 notas reais (lanes A–E) em `data/starterFounder.ts`; assimilação via `starterUniverse.ts`. CTA no empty state (“Acender Starter Founder”). Founder pode alargar o seed até ~80–120.
- **Taxonomia A–E + estados de projecto:** chips no HUD; `taxonomyLane` / `projectStatus` (metadado em claro, como category); anel visual nos nós; UI no sidebar.
- **Modo estudo (thin):** `StudyModePanel` — anexo | nota | ligações sem sair do Universo.
- **Temas de universo realistas:** `universeThemes.ts` — Galáxia / Sistema Solar / Nebulosa / Buraco Negro / Quântico / Oceânico com luzes, fog, espiral, disco e nebulosas distintos. Picker rico em Definições → Universo e no HUD.
- **P3 / Stripe / App Check:** inalterados (Stripe latente; App Check ainda sem site key na consola).

### A tua parte (produto)
1. Alargar `frontend/src/data/starterFounder.ts` com mais notas reais.
2. Demo 20s (void → starter → filtro B → estudo).
3. Smoke num vault Obsidian teu após deploy.

### Próxima sessão recomendada (ops / trust — não produto)
1. App Check monitor (site key reCAPTCHA).
2. Migração secrets (`defineSecret`) se ainda houver Runtime Config legado no Stripe.
3. i18n residual / `/status` / PITR — ver bloco 1 set abaixo.
4. **Não** Stripe live sem pedido explícito.

---

## Update — 1 set 2026 (P3 + i18n + upload + picker)

### Estado
- **P3 código: feito.** Papéis owner/admin/member, `teamAudit`, `/enterprise`, SDK `@mnemosyne/sdk`, `docs/SOC2_TYPE_I_CONTROLS.md`. Stripe **não** ligado.
- **App Check:** cliente pronto; **site key reCAPTCHA v3 ainda é passo de consola** (monitor, sem enforce).
- **i18n:** pt-PT, pt-BR, EN, FR no produto. **Não há ES.** Residual: toasts internos das Definições, HTML estático (`privacy.html`, `security.html`, `account-deletion.html`), emails, Tauri/Android nativo, clipper usa `navigator.language`, Insights / Web Research / Memory Detail.
- **Upload:** o cliente infere MIME (Windows MIME vazio; `.ts` não é vídeo); `storage.rules` aceita código + extensão case-insensitive; imagens/docs até 25 MB. **Deploy das rules de Storage** se produção estiver atrasada.
- **Picker de modelos:** menu vertical em Definições → Inteligências. Só presets que a app envia (Ollama local, backend GPT-OSS / Llama 3.1 / gpt-4o-mini). Sem Gemini 3.7 / Claude Opus inventados — o cliente **não** chama essas APIs para chat.
- **Agente in-app:** não há tool-calling loop. Já existe o slice: `parseAiCommand` no input (criar memória, gerar texto, imagem, `/web`). MCP é para agentes **externos** (Cursor/Claude) sobre ciphertext + metadados. Próximo slice realista: tools no cliente com vault desbloqueado (criar memória, pesquisar sessões já decifradas, export markdown). Sem o servidor a ler plaintext.

### Podemos implementar agora (horas/dias)
1. `firebase deploy --only storage` (e functions/rules se ainda não) após o fix de upload.
2. App Check monitor: criar reCAPTCHA v3, meter `VITE_FIREBASE_APPCHECK_SITE_KEY`, rebuild hosting.
3. i18n residual (lista acima).
4. Página `/status` estática, honesta.
5. PITR na consola Firestore; playbook IR de 1 página (já listado no SOC2).
6. Afinar comandos do input (EN/FR) — o parser hoje é sobretudo PT.

### Bloqueado / não agora
Stripe live, SSO OIDC (precisa Identity Platform), SAML, SCIM, SOC 2 cert, Play Store pública, Authenticode, modelos cloud que não temos conector.

### Próxima sessão recomendada
1. Deploy storage.rules + smoke de import (PDF, `.md`, `.docx`, `.ts`).
2. Site key App Check.
3. Se sobrar tempo: i18n dos toasts / HTML estático — **não** Stripe.

---

## Update — auto-update da app (2026-07-18g)

- Web/Capacitor: `AppUpdatePrompt` compara `/version.json` (no-cache) com build embutido
- Toast “Nova versão disponível” → **Atualizar agora** (reload hard) ou Depois
- Check a cada 3 min + on focus/visibility
- Plugin Vite gera `version.json` + `VITE_APP_VERSION` / `VITE_APP_BUILD_ID` (v1.0.7)
- Desktop Tauri: mantém updater nativo com copy alinhada
- `firebase.json`: Cache-Control no-cache para `version.json` e `index.html`

## Docs atualizados (2026-07-18f)

- **Novo:** [`docs/MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md`](./MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md)  
  - Gaps para atrair Big Tech (P0–P3)  
  - Plano de migração `functions.config()` → params/secrets  
  - Roadmap 90 dias  
- Atualizado: `docs/README.md`, `docs/MNEMOSYNE_MARKET_READINESS_ROADMAP.md`

### Próxima sessão recomendada
1. Executar **Fase A–B da migração de secrets** (Stripe + reviewer + LLM)
2. Entitlements server-owned
3. App Check site key + enforce
4. Demo multi-user Comms (2 contas) gravada

## Update — Functions Node 22 upgrade (2026-07-18e)

- `functions/package.json` `engines.node`: `20` → `22`
- `@types/node` → `^22.15.0`
- Build + unit tests OK; deploy functions em curso / feito

## Update — Comms / E2E / rate limit / Flow + deploy (2026-07-18d)

### Comms multi-user
- `services/commsService.ts`: bloqueio self-send, payload relay `status:sent`, P2P separado, friend requests
- TransmissionPanel usa o serviço + toasts (sem delay fake no relay)
- Rules tests: friendRequests + transmissions

### Rate limit server-side
- `functions/src/rateLimit.ts` (Firestore sliding window por IP)
- Aplicado a `webResearch`, `generateText`, `generateImage` → HTTP 429 + Retry-After
- Coleção `rateLimits` bloqueada a clientes

### E2E pipeline (vitest)
- `test/e2e.pipeline.test.ts`: crypto cápsula, comms, search, client rate limit
- Functions: `test/rateLimit.test.js`

### Flow polish
- Ecos via motor de pesquisa unificado; chips de modo; rascunho; dicas empty; ecos clicáveis

### Deploy OK
- https://mnemosyne-one.web.app
- hosting + firestore:rules + functions

## Update — Search + Definições (2026-07-18c)

### Search
- Motor unificado `utils/searchMemories.ts`: ranking textual + semântico, operadores `#tag`, `tag:x`, `cat:y`
- `useSessions` usa o mesmo motor (floor semântico 0.38)
- Command Palette: recentes, chips de tags, snippets, tipo de match, deep-links (Pulse, Insights, Definições·IA/PIN)
- Ctrl+Enter → web research; limpar query; indicadores de score

### Definições
- Barra de pesquisa interna (PIN, Ollama, sync…)
- Chips de estado (memórias, PIN, IA, dispositivos)
- Persistência da última secção + deep-link `initialSection`
- Atalhos 1–7 entre secções
- Nav filtra secções pela query

### Validação: 79 tests + build OK

## Update — Universo real + polish + prioridades (2026-07-18b)

### Universo 3D de verdade
- Núcleo galáctico, poeira cósmica, nebulosas mais densas (`space3dBackdrop` + `Space3DBackdrop`)
- Luzes hemisphere + core warm; intro de câmara; auto-rotate em vazio
- Proto-estrelas + CTA “Universo nascente” quando sem memórias
- Ligações com partículas de sinal e blending aditivo
- Vignette + film grain; HUD glass compacto

### Polish visual
- Dock com glow ativo violet→cyan
- MemoryGraph empty state + fundos cósmicos (nunca pure black)
- Classes CSS `mnem-universe-grain`, `mnem-graph-empty`

### Prioridades técnicas
- Firestore `shares`: schema cifrado obrigatório (sem plaintext)
- Rules tests: cápsulas encrypted + transmissions E2E (emulator)
- Rate limit client web research (`clientRateLimit` + fair-use/hora)
- App Check opcional via `VITE_FIREBASE_APPCHECK_SITE_KEY` (`initAppCheckIfConfigured`)

### Validação
- Unit tests: 75 passed
- `npm run build` a validar

## Update — PIN local + Cognitive Pulse (sessão 2026-07-18)

- **PIN local opcional**: vault AES-GCM + PBKDF2 em `utils/localPin.ts`; UI em Definições → Privacidade; unlock overlay `PinUnlockModal` após idle lock
- **Cognitive Pulse**: ritual diário em `services/cognitivePulse.ts` + painel `CognitivePulsePanel` (tensões, ecos, órfãs, constelação do dia)
- Botão **Pulso** no header; abre 1×/dia após desbloquear com memórias
- Teste planLimits alinhado a Founder Preview (fair-use 5 GB, não “Sovereign unlimited”)
- Testes: 72 passed; build a validar localmente

## Update — pack multi-memória + aviso de assimilação

- Pack: checkbox “incluir memórias ligadas” na cápsula (até 12)
- `importCapsuleAsMemory` expande packs em N memórias
- `capsuleImportNotices` + toast “Cápsula assimilada” ao autor
- Rules: importCount em shares + coleção notices
- Deploy hosting + firestore rules: https://mnemosyne-one.web.app

## Update — QR cápsula + importar para universo

- ShareModal: QR code da cápsula + download PNG
- ShareView: **Assimilar cápsula** → `importCapsuleAsMemory` (embeddings/autolink)
- Tags `capsula` / `importada`; botão **Ver no grafo** com deep-link
- Deploy: https://mnemosyne-one.web.app

## Update — replay onboarding + cápsulas públicas

- Definições → Privacidade → **Repetir onboarding** (`resetOnboarding` + `forceOpen`)
- Painel memória: **Link privado** + **Cápsula cifrada** (ShareModal)
- Cápsula: opcional `#k=` no fragmento (não vai ao servidor); auto-unlock no ShareView
- `buildCapsuleDeepLink(shareId, passphrase?)`
- Deploy: https://mnemosyne-one.web.app

## Update — performance + onboarding + deep-links

- `utils/graphPerformance.ts` — LOD high→ultra-low (até 10k, renderiza subset ranqueado)
- Grafo mostra badge `LOD · N de M · detail`
- `OnboardingTour` — 6 passos, localStorage `mnemosyne.onboarding.v1.done`
- Deep-links: `/?memory=ID` e `/universe?memory=ID` + copiar link no painel/detalhe
- Deploy: https://mnemosyne-one.web.app

## Update — polish total (visão cognitiva)

- Grafo: empty state real, birth flash em nós novos, partículas nos links, legendas
- Universo 3D: `spawnedMemoryId` flash ao criar, halo cyan/violet, ligações mais vivas
- Command palette: PT, ↑↓ Enter, Universo/Comms/Definições, secções
- Painel de ação do grafo: glass violet, título
- Deploy hosting OK

## Update — Flow + Universo + deploy

### Flow (`CognitiveInput`)
- Auto-focus, rascunho em sessionStorage
- Chips de ação sempre visíveis (scroll mobile)
- Preview de “ecos” no grafo enquanto escreves
- Banner pós-cristalização + toast com nº de ligações
- Foco no nó no grafo após criar (`onMemoryCreated`)
- Footer com contagem de palavras / atalhos

### Universo
- `MemoryInputPanel` em PT, toast, foca memória após lançar
- `MemoryDetail` em PT, painel glass, ligações clicáveis
- `UniverseHUD` compacto (tipo + observatório)
- Search dock com lista de resultados clicáveis (Ctrl+K)
- Tips de navegação dismissíveis

### Deploy
```
firebase deploy --only hosting --project mnemosyne-one
→ https://mnemosyne-one.web.app
```

---

## O que foi feito nesta sessão (ownership full-stack)

### Segurança / Zero-Knowledge
- Mnemónica só em `sessionStorage` via `utils/sessionMnemonic.ts`
- Idle lock ~45 min + aviso ~5 min antes (`mnemosyne:session-idle-warn`)
- Scrub de chaves legadas em `localStorage` no boot
- Warm-up não bloqueante do modelo de embeddings após unlock
- **Links públicos em texto claro removidos**
  - `ShareModal` gera apenas **cápsula cifrada** (AES-GCM + PBKDF2, passphrase out-of-band) ou export local
  - Preferência UI: Comms E2E
  - `ShareView` desbloqueia com passphrase; links legados mostram aviso
- Privacy policy atualizada com secção honesta “ZK — o que é e o que não é”
- Fair-use técnico: `config/fairUse.ts` + limites Founder Preview em `planLimits.ts`

### Free-first / mercado
- Default continua `free-first`
- Pricing page: hero Founder Preview + features honestas
- Login hero: badge Founder Preview
- Anexos: teto por ficheiro via `FAIR_USE.maxAttachmentMB` (25 MB)

### UI/UX
- Header da app: brand, contagem de memórias/ligações, badge Founder Preview, Definições + Sair
- Dock inferior (`mnem-dock`) — scroll horizontal em mobile, estados ativos, Web/Universe/Comms
- Insights panel: labels PT, títulos de memórias, fechar, stats órfãs, dicas acionáveis
- Universe HUD: PT, glass bar
- Login About: copy ZK honesto

### Ficheiros novos
- `frontend/src/config/fairUse.ts`
- `frontend/src/utils/sessionMnemonic.ts`
- `frontend/src/utils/encryptedShare.ts`

### Ficheiros principais alterados
- `App.tsx`, `index.css`, `ShareModal.tsx`, `ShareView.tsx`
- `InsightsPanel.tsx`, `LoginPage.tsx`, `PricingPage.tsx`, `PrivacyPage.tsx`
- `planLimits.ts`, `AttachmentUploader.tsx`, `CognitiveInput.tsx`, `UniverseHUD.tsx`

## Ainda em aberto (próxima sessão)
1. **Migrar functions.config → defineSecret/params** (urgente — ver doc Big Tech §5)
2. Teste multi-user real Comms (2 contas / 2 browsers) + vídeo demo
3. ~~Emulator tests rules~~ ✅ código; correr com emulator se necessário
4. App Check: site key produção + enforce
5. Entitlements server-owned (subscription não editável pelo cliente)
6. ~~PIN opcional~~ ✅ · ~~Node 22~~ ✅ · ~~rate limit server~~ ✅ · ~~deploy~~ ✅
7. Playwright E2E no CI (além do pipeline vitest)
8. Play closed testing mobile pairing
9. Export soberano + threat model formal

## Como validar localmente
```powershell
cd W:\real\Mnemosyne\frontend
npm run build
npm run lint
```

## Notas de produto
- Comunicação: Founder Preview gratuito — **não** “grátis para sempre”
- ZK de conteúdo ≠ anonimato total (Firebase Auth/metadados)
- Stripe permanece latente até `VITE_MONETIZATION_MODE=paid` ou `VITE_ENABLE_CHECKOUT=true`
