# Comms — expiração e reconciliação da sinalização P2P

Data: 12 de outubro de 2026. Implementação local, sem ativação em produção.

## Decisão de retenção

Uma sala v2 é uma sessão de sinalização com prazo de 10 minutos. O prazo deriva de createdAt + COMMS_P2P_SESSION_MS; o worker não aceita uma data arbitrária como autorização de apagar a sala. Quando chega ao prazo, elimina atomicamente o root e as duas coleções conhecidas de candidatos. Não prolonga a sala, não reabre propostas e não devolve quotas. SDP/answer/ICE são metadata de rede sensível.

Recibos de sinalização, recibos de conteúdo e budgets são conservados. Após a remoção do root, uma consulta de operação histórica pode devolver applied com roomStatus unknown: prova a operação passada, sem declarar um canal ainda ativo. Um conteúdo já admitido continua a poder receber ACK do destinatário; a ausência da sala não recria nem apaga a cópia pessoal.

O worker só elimina rooms v2 com UID/participantes/fingerprints/digest e timestamps válidos, status conhecido e contadores limitados. Salas ativas antes do prazo, documentos legados, metadata inválida e mais de 64 candidatos numa coleção são retidos. Uma transação nunca elimina apenas metade dos candidatos quando encontra overflow. Registos legados e candidatos órfãos sem root precisam do inventário/reconciliação próprios antes do lançamento completo.

## Worker e cursor

cleanupCommsP2PExpiry é uma função EU agendada a cada cinco minutos, com timeout de 120 s. COMMS_P2P_CLEANUP_ENABLED permanece false e integra o preflight do rollout. Com o gate fechado, a função termina antes de ler ou escrever Firestore.

Cada passagem lê até 51 candidatos por expiresAt positivo e já vencido, ordenados por expiresAt e ID, e processa até 50. A query projeta só expiresAt; cada remoção relê o root e os dois conjuntos de candidatos na transação. Não há delete recursivo, listagem sem limite ou confiança em metadata fornecida pelo cliente.

O cursor privado em commsP2PCleanup/state avança mesmo quando uma linha tem de ser retida. Isto evita que 50 registos antigos impeçam alcançar as salas seguintes. Timestamps iguais usam também o ID; valores positivos fracionários inválidos para uma sala continuam válidos para posicionar o cursor e passar a linha. Valores nulos, ausentes, negativos e NaN não autorizam limpeza. No fim da varredura, o cursor volta ao início para tentar novamente as falhas e alcançar inserções anteriores. O padrão segue a [documentação oficial de cursores do Firestore](https://firebase.google.com/docs/firestore/query-data/query-cursors).

O estado do cursor usa releitura transacional e CAS por revision/valor integral. Duas execuções podem repetir a tentativa da mesma sala; somente uma elimina o root e nenhuma regride o cursor gravado por outra. Uma falha antes de guardar progresso pode repetir o trabalho no próximo ciclo, de forma idempotente. SDK não lê nem escreve o estado. Logs contêm somente contagens agregadas de falhas, sem IDs, participantes, SDP ou ICE.

A varredura não garante que todo o backlog seja apagado em cinco minutos. Custo, atraso, falhas persistentes e volume precisam de calibração/alertas no rollout. Cursor inválido ou relógio recuado falham explicitamente. O worker conserva os dados quando não consegue provar o contrato; não converte registos inválidos em autorização de purga.

## Referência local

O cliente consulta o estado autenticado da operação guardada, usando o diário cifrado, UID, vínculo e digest originais. Se a sala está closed, expired, unknown ou revoked, retira apenas a referência local da sala. Mantém o diário de conteúdo, as cópias recebidas e qualquer sinalização pendente. Uma sinalização pendente impede essa reconciliação até ser confirmada/cancelada.

A observação de uma sala terminada faz esta verificação antes de retirar o peer. Se o canal/processo já se perdeu, Verificar sala P2P guardada permite consultar manualmente o mesmo estado, mesmo com admissão fechada. Sala offer/active mantém a referência e exige fecho explícito para outra negociação. Não se inventa uma operação close/cancel nem se assume que o PeerConnection sobreviveu ao reload.

Conta/cofre/vista/bytes e alterações entre separadores são guardados durante decifragem e RPC. Resposta tardia após ida e volta de conta ou substituição do handle não pode limpar a referência atual. Metadata indisponível conserva a referência e apresenta erro recuperável.

## Validação e limites

Prova privada: W:\real\mnemosyne-launch-evidence\comms-p2p-cleanup-local-validation-20261012.json. Os resultados anteriores conservam hashes/data próprios e não são reclassificados como uma nova suite geral.

Testes focados validam prazo exato, quatro tentativas concorrentes, replay, metadata inválida/legado/overflow, guarda de recibos/budgets, reconciliação terminal sem write, preservação de conteúdo pendente e respostas tardias/ABA. O emulador valida os SDKs bloqueados, páginas 50+1 com empate de timestamp, cursor após registo fracionário retido e ACK de conteúdo depois da purga do root.

Chromium usa painel/serviços/executores/RSA/AES/IndexedDB/Web Locks e dois peers WebRTC nativos. Auth/RPC/DB são fronteiras sintéticas localhost. Passou retirada automática da referência remota, consulta manual depois de root purgado sem write, anexo 192 KiB interrompido/retomado e regressões de inbox/relay/paginação. Nenhum fornecedor real, pedido externo ou mutação de produção.

39 gates / 20 fontes permanecem fechados. Esta decisão substitui a pendência de limpeza automática de sinalização v2 e de reconciliação de referência terminal; legado, órfãos, pilotos/cloud/native/cutover e restantes fases 0–6 continuam pendentes. O email operacional é wgftechnologies@gmail.com; o plano não foi ativado nem teve entrega verificada. O deploy completo está autorizado depois da conclusão de todas as áreas.

Rollback fecha o gate do worker. Não reconstitui SDP/ICE apagado e não retira cópias já recebidas. Recibos históricos, budgets e diários cifrados não são apagados por rollback.
