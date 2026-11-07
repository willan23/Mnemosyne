# Remoção recuperável de contactos — 12 de outubro de 2026

## Âmbito e confirmação

O painel permite retirar um contacto aceite mediante confirmação do nome e UID. A operação abrange pedidos aceites e pendentes do mesmo par nas duas direções, incluindo duplicados históricos. Conserva os documentos, campos adicionais e mensagens já entregues; altera somente estado/data dos pedidos e metadata privada de controlo. Não bloqueia o utilizador, fecha salas P2P ou revoga chaves já entregues.

O cliente envia um UUID estável, UID capturado do titular, UID do peer, ID real da relação aceite e updatedAt capturado. O UID do pedido tem de corresponder ao token antes de Auth/rate limit/Firestore. A autoridade vem dessa conta autenticada e dos participantes atuais do documento, verificados no servidor. A comparação de updatedAt recusa uma seleção entretanto alterada; não confere autoridade a um timestamp do cliente.

## Lotes e concorrência

Quatro callables EU permitem iniciar, consultar, avançar e cancelar uma intenção não admitida. Iniciar usa o gate existente de escritas de contactos, que permanece fechado. Consultar, concluir uma operação já admitida e cancelar uma intenção desconhecida são percursos de recuperação disponíveis com admissão fechada. UID desativado ou marcador permanente do chamador impede a operação; um marcador/ausência do perfil do peer devolve revoked sem recriar referências. Desativar Auth do peer, sem eliminação permanente, não impede o titular ativo de retirar o seu contacto.

Cada transação consulta as duas direções com ambos os UIDs, status in pending/accepted, ordenação por ID e limite de 26 por direção. Junta os IDs em ordem UTF-8 e retira no máximo 25 documentos. Retirar significa status cancelled; campos desconhecidos e conteúdo entregue ficam intactos. A data de atualização não reduz datas históricas válidas: o recibo conserva o tempo do servidor/runtime da operação, enquanto metadata antiga futura pode permanecer futura.

O par privado fica bloqueado pelo UUID da remoção entre lotes. Criação de novos pedidos e respostas mutáveis não atravessam esse bloqueio. O diretório e a procura não expõem o perfil de um par em remoção. Como as linhas retiradas deixam de cumprir o filtro ativo, o lote seguinte pode partir do início sem cursor, cutoff temporal ou backfill. Queries e escritas pertencem à mesma transação.

O recibo privado liga actor, peer, UUID, anchor e digest, e regista estado/datas/contagem cumulativa. Um retry de begin devolve o primeiro progresso sem admitir outra operação; advance percorre o próximo lote. Quando não há mais candidatos, o par passa a cancelled e o bloqueio é retirado. Um UUID concluído continua terminal e não cancela uma relação nova admitida depois. Um UUID concorrente ou autoridade/par alterado é recusado.

## Intenções não admitidas

Uma intenção pode falhar antes de ser admitida por seleção obsoleta ou resposta perdida. Cancelar intenção não admitida exige confirmação no cliente e grava um checkpoint terminal para o mesmo UUID. Um begin atrasado não atravessa esse checkpoint. Se begin ganhou a corrida, o cancelamento devolve o progresso existente sem desfazer documentos retirados; o titular pode continuar até concluir.

Este cancelamento nunca anuncia que um contacto foi retirado. A resposta cancelled tem contagem zero. Marcadores permanentes impedem criar novo checkpoint com referência à conta eliminada. Os endpoints partilham limites de 60 consultas/operações por UID/minuto e 600 por projeto/minuto; calibração de custo, retenção temporal e quotas operacionais continuam pendentes.

## Cópia local e interface

Antes do primeiro RPC, o cliente conserva apenas um envelope AES do cofre com UID e pedido imutável em mnemosyne:comms-contact-removal:v1:{UID codificado}. Usa o mesmo Web Lock por UID dos pedidos de contacto. Uma intenção pendente recusa outra seleção/UUID. Troca de conta/cofre, alteração da cópia em outra aba ou saída da vista recusa respostas tardias e conserva a cifra.

Cada clique de recuperação executa no máximo um novo lote. A cópia não é apagada em pending ou falha; só após confirmar complete, cancelled ou revoked. Cofre errado e cifra transplantada não são adotados. O painel e o compositor global têm recuperação; contactos são recarregados com um controlador novo após progresso para retirar callbacks de páginas anteriores. A seleção do destinatário é limpa; o texto da composição é conservado.

## Eliminação, índices e rollout

SDK não pode ler, listar, criar, atualizar ou eliminar commsContactRemovals. A eliminação da conta abrange recibos nas direções actorUid e peerUid e a chave local exata do próprio UID, preservando outras contas. Não foi acrescentado TTL dos recibos; retenção/backup e recuperação entre instalações continuam pendentes.

É usado o índice de friendRequests fromUid/toUid/status declarado no incremento anterior. A descoberta de pares antigos também filtra estados ativos antes do cap; históricos terminais não impedem novo pedido por excederem 50 documentos. Índices e gates não foram publicados/abertos. O rollout exige índice READY, Functions/rules/clientes coordenados e tratamento dos clientes antigos.

Rollback com remoções admitidas deve conservar consulta/continuação/cancelamento e o schema de lock/recibo. Repor uma versão anterior que ignore o bloqueio pode permitir reativação concorrente. Não se restauram estados aceites automaticamente para desfazer um lote já confirmado.

## Verificação

As suites gerais passaram com 1.076 testes frontend/154 ficheiros e 329 Functions +um skip de rules sem emulador, antes do último reforço do UID no pedido. Após esse reforço passaram 92 testes frontend focados/sete ficheiros, TypeScript, lint do escopo sem erros/avisos e build web; 40 testes backend/pipeline focados; cinco testes finais no emulador. Lint geral anterior ao último reforço: zero erros/23 avisos anteriores. A suite integral de rules, audits e CI remota não foram repetidos neste incremento.

Chromium final usa o contrato com UID no corpo e passa ACK perdido, cifra estável após reload, progresso 25/50/61, retoma com admissão fechada, replay terminal sem writes e confirmação do cancelamento desconhecido. Uma segunda tentativa begin é a intenção obsoleta recusada, não uma segunda admissão do lote. Inclui as regressões de diretório/procura, relay/P2P, anexo 192 KiB e inbox local. Zero pedidos externos/fornecedor/mutações de produção no ensaio. A rejeição aborted da intenção obsoleta é esperada e fica registada no log. Falhas iniciais de invocação, construção do harness, sincronização e contagem das fixtures foram conservadas.

Resultados, limites dos ensaios e hashes finais constam da prova privada W:\real\mnemosyne-launch-evidence\comms-contact-removal-local-validation-20261012.json. O emulador usa Firestore/transações reais e Auth sintético. O Chromium usa painel, serviços, RSA/AES, IndexedDB, locks e WebRTC nativos com Auth/RPC/DB sintéticos em localhost; não substitui pilotos de Auth, rede externa, Android/Tauri ou validação de índices cloud.

Identidades/retenção/backup, equipas/writers e o restante programa das fases 0–6 continuam por concluir antes do deploy completo autorizado. O email operacional é wgftechnologies@gmail.com; alertas ainda não estão ativados nem têm entrega verificada.
