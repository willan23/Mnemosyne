# Contactos Comms recuperáveis — 11 de outubro de 2026

Atualização posterior: os [comandos com UID capturado](COMMS_CONTACTOS_UID_CAPTURADO.md) ligam os cinco endpoints ao token, mantendo o digest/diário/recibo existentes. As métricas abaixo pertencem às passagens históricas.

Atualização posterior: a [remoção de contactos aceites](COMMS_REMOCAO_CONTACTOS_RECUPERAVEL.md) suporta duplicados históricos, bloqueio do par e retoma; criação/respostas respeitam o bloqueio. As métricas abaixo são históricas.

Atualização posterior: a [lista independente e procura de contactos aceites](COMMS_DIRETORIO_CONTACTOS_ACEITES.md) e os incrementos de transporte/relay/P2P citados no índice já foram validados localmente. Os resultados abaixo pertencem ao incremento de 11 de outubro. Remoção aceite, recuperação entre instalações e rollout continuam pendentes.

## Resolução pontual do destinatário

`lookupCommsRecipient` substitui a query por emailHash que as rules recusavam. A callable EU aceita apenas um email ou UID exato, valida Auth do caller e destinatário, recusa self/contas inexistentes ou desativadas e verifica os marcadores de eliminação numa transação. Os perfis privado/público têm de corresponder ao UID e à mesma chave RSA canónica. A resposta contém apenas UID, nome público, chave pública e fingerprint. Não devolve email/hash de email nem listas de utilizadores. As rules continuam a recusar listagem de `publicProfiles`.

O email é normalizado antes do lookup Auth; não serve uma pesquisa parcial. Existe rate limit de 20 consultas/minuto por caller e 200/minuto por projeto. Erros são genéricos, sem conteúdo do lookup nos logs. A descoberta revela que um destinatário exato tem perfil público válido; não constitui anonimização ou proteção absoluta contra enumeração de endereços conhecidos. App Check e calibração global continuam no programa de lançamento.

## Pedido, recibo e autorização

O cliente captura UID, destinatário/fingerprint e UUID antes de preparar o diário AES-GCM do cofre pessoal. Conserva esse pedido cifrado por UID antes de chamar criação e usa Web Lock e comparação exata dos bytes locais. Status/retoma reutiliza o mesmo pedido; uma perda de ACK não cria outro UUID. Uma mudança observada de conta/cofre/caller/armazenamento permanece invalidada mesmo após regressar. Uma falha inicial de leitura também retira os observers.

O servidor vincula o pedido ao caller, UUID, destinatário e digest. A criação compara a chave pública atual do destinatário, deriva os labels de perfis validados e grava `friendRequests`, o par e orçamento numa transação. Não aceita labels, autoridade ou campos privados fornecidos pelo cliente. Os pedidos novos são v2; a versão anterior continua legível. Replay confirmado não consome novo orçamento nem altera timestamps.

`commsContactPairs/<sha256(JSON dos UIDs ordenados)>` impede dois pedidos ativos opostos ou com IDs diferentes. O orçamento diário admite 20 novos checkpoints por caller, incluindo cancelamento anterior à criação; cancelar/repetir um pedido existente não cobra novamente. Pair e budget são privados, sem get/list/write pelo SDK cliente.

Só o destinatário pode aceitar/rejeitar. A resposta confirma o estado desejado repetido e recusa uma decisão contraditória após estado terminal. Também aceita IDs legados já existentes, com a autoridade capturada e novamente verificada na transação. Cancelar um pedido pendente liberta o par; cancelar depois de aceite confirma o contacto aceite e não o retira. Conta eliminada/desativada é recusada em lookup, criação, status, cancelamento e resposta.

## Legado, regras e limpeza

Quando ainda não existe um par, o servidor procura pedidos legados nas duas direções com consultas limitadas a 51 linhas. Um pedido pending/accepted existente impede nova criação; a aceitação de um legado recusa outro pedido ativo. Mais de 50 linhas numa direção recusa a operação porque a descoberta seria incompleta. Inventário/reconciliação e retenção desse histórico são pré-requisitos para contas que excedam o limite; não se escolhe silenciosamente uma linha.

As rules deixam de aceitar create/update/delete direto de `friendRequests`. Leitura continua limitada aos participantes e a contas ativas. A UI usa as callables para pedir/responder. O índice `friendRequests(fromUid,toUid)` foi adicionado ao manifesto; **não foi criado em produção**. O rollout exige Functions/regras/clientes/índice coordenados e tratamento dos clientes antigos. Os emuladores não provam prontidão do índice em produção.

A eliminação da conta abrange budgets por UID, pares nas duas direções e o diário local do próprio UID. Os testes verificam que pares de outras contas e cópias locais de outros UIDs permanecem.

## Interface e estado

O painel e o compositor global oferecem recuperação/cancelamento. O cofre fechado desativa esses controlos; cancelamento pede confirmação e não promete desfazer um contacto já aceite. Feedback tardio é recusado. A pesquisa captura uma revisão da entrada: editar o destino invalida a resposta antiga antes de a selecionar. O pedido captura o fingerprint confirmado; não usa um destinatário lido depois dos awaits.

O Comms monta uma vista nova ao mudar UID/cofre/contexto e desmonta-a ao fechar. Estado de composição, contactos, outbox/rooms e identidade deixa de ser adotado pela vista seguinte; o mesmo `initialDraft` em claro não é reutilizado após perda de contexto. Subscrições/peers locais são retirados na desmontagem. Isto não revoga dados/chaves já conhecidos, não garante zeroização de strings JavaScript e não prova que todos os handlers de envio/sinalização estejam protegidos.

## Validação

Passaram **962 testes gerais frontend/145 ficheiros**, antes do ajuste final de cleanup do observer de leitura e do teste adicional. A passagem focada final cobre esse ajuste: **60 testes/cinco ficheiros**, TypeScript, lint do escopo sem avisos e build web. O lint completo reporta zero erros/23 avisos anteriores. Functions: **256 unitários**, um teste separado de rules ignorado, e quatro testes do preflight/pipeline. Audits de produção dos dois packages: zero vulnerabilidades.

No emulador `demo-mnemosyne-rules`, passaram **165 testes Functions**. A primeira suite frontend falhou num teste que ainda autorizava escrita direta de contactos. O contrato do teste foi atualizado para provar leitura de participantes e recusa de mutações/estranhos. A passagem final passou **cinco testes backend focados**, incluindo limpeza de pares nas duas direções, e **todos os 23 testes frontend de rules**. Backend, rules, índice e cliente foram alterados; não se reutiliza a alegação de fontes inalteradas das provas anteriores.

Chromium usa painel/controlador/recuperação/executores reais, RSA/AES, localStorage e Web Locks. Auth, RPC, DB e streams são fronteiras sintéticas localhost. Verifica resolução pontual, ACK perdido, pedido cifrado, lock entre abas, retoma com gate fechado sem duplicado, cofre errado, confirmação de cancelamento e mudanças de conta durante lookup/ACK já confirmado no servidor. Não prova Auth real, entrega entre dispositivos ou configuração de produção. Falhas iniciais de import não usado, matcher da fixture, sintaxe do harness, verificação antes de terminar a resposta simulada e contrato antigo de rules são conservadas nos logs. O ensaio final sincroniza explicitamente a resposta de criação antes de verificar o recibo.

Prova privada: `W:\real\mnemosyne-launch-evidence\comms-contact-local-validation-20261011.json`; logs em `comms-contact-validation-20261011`. **33 gates/16 ficheiros fechados**, zero pedidos externos no browser/fornecedor/mutações de produção/deploy. Sem binário nativo para esta fonte.

## Pendências que continuam a condicionar o lançamento

- Envios recuperáveis por relay/P2P, validação e limites de envelopes/anexos, associação do canal ao peer, guards de offer/answer/ICE e confirmação de entrega.
- Paginação/limites das listas Comms, inventário/reconciliação de históricos acima do cap, remoção de contactos aceites, retenção e recuperação entre instalações.
- Uma entrada histórica ligada a uma conta revogada pode fazer a query inteira falhar pelas rules atuais; concluir o percurso de inbox autorizado e apresentar o estado sem descartar silenciosamente contactos.
- Migração/cutover dos clientes antigos, índices reais, pilotos Auth/dispositivos e todos os critérios restantes das fases 0–6.

O destinatário operacional continua wgftechnologies@gmail.com, com alertas ainda sem ativação/entrega. O objetivo permanece o produto completo, seguido do deploy autorizado depois de concluir e validar todas as áreas.
