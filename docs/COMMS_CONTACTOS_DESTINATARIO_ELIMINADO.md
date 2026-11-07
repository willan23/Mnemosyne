# Recuperação de contacto com destinatário eliminado — 12 de outubro de 2026

## Estado terminal autorizado

Consulta e cancelamento de um pedido devolvem agora revoked quando existe um marcador permanente de eliminação do destinatário ou o seu perfil está em deletionState deleting. A verificação é transacional e exige a conta do remetente ativa. Um pedido existente tem de corresponder ao remetente, destinatário, UUID, fingerprint e digest; a revogação não mascara um recibo estrangeiro ou corrompido.

A resposta conserva datas válidas do recibo existente. Se o recibo foi purgado ou a intenção nunca foi admitida, createdAt e updatedAt são ambos null. O UUID e o digest continuam ligados ao payload original. revoked é uma projeção da leitura; não se grava esse estado nos documentos antigos.

Não são criados, alterados ou restaurados pedidos, pares ou budgets nessa recuperação. Criação de novos pedidos para um destinatário marcado continua recusada. Marcadores do próprio remetente recusam a recuperação, incluindo quando o seu token ainda existe.

## Auth, marcadores e falhas

O servidor consulta os marcadores antes de exigir Auth do destinatário, permitindo encerrar um diário quando Auth e perfis já desapareceram. Se Auth falhar, os marcadores são consultados novamente. A transação final também os relê após Auth, cobrindo uma eliminação concorrente.

Perfil ausente sem marcador, Auth ausente/desativado sem marcador e falhas transitórias de Auth/Firestore não anunciam revogação. A operação falha e a cifra local é conservada. O helper de conta é usado com requireProfile false apenas para distinguir o marcador/deleting; as operações normais continuam a exigir os perfis e Auth ativos.

## Cliente e interface

O leitor de resultado aceita revoked com datas válidas ou ambas null. Recusa datas parcialmente null, autoridade/digest incompatíveis e respostas adicionais. Só após verificar resposta e contexto atual é removida a chave cifrada exata do próprio UID. Não há novo UUID, create ou cancel depois de uma resposta terminal à consulta.

O painel de recuperação e a resposta ao pedir contacto anunciam que o destinatário não está disponível e que o pedido local foi encerrado. A vista atual recarrega o diretório e limpa a seleção/chave do destinatário; o rascunho e anexo de composição são conservados. Conta/cofre/vista retirados impedem feedback, refresh e limpeza tardios.

Não houve alteração de schema persistente, rules, índices, dependências ou gates. O formato de transporte actorUid/request e o diário cifrado v1 continuam os mesmos. O rollout exige clientes que aceitem o novo estado; um cliente antigo pode conservar o diário até ser atualizado. O rollback não deve voltar a depender de Auth do peer para esta recuperação terminal.

## Verificação e limites

Validação concluída em 13 de outubro: 1.089 testes frontend/155 ficheiros, 337 Functions +um skip e quatro testes de pipeline; 70 frontend focados/cinco ficheiros; 48 backend/pipeline focados; 13 focados finais no emulador. TypeScript/build web aprovados, lint do escopo zero erros/avisos e lint geral zero erros/23 avisos anteriores. Suite integral de rules, audits e CI remota não repetidos.

As passagens gerais iniciais falharam em fixtures: comparação do rascunho sem o cabeçalho de partilha, clique antes da identidade estar pronta e snapshot síncrono no teste de importação. Foram corrigidas para preservar o texto completo, esperar pelo controlo disponível e entregar snapshots imutáveis/assíncronos, sem aumentar timeouts gerais. A passagem geral final passou. Uma regressão P2P teve timeout durante testes concorrentes; o browser final com todos os cenários passou depois. Todos os logs foram conservados.

Os resultados finais são registados na prova privada W:\real\mnemosyne-launch-evidence\comms-contact-revocation-local-validation-20261012.json. Os testes cobrem desaparecimento de Auth/perfis/recibos, marcadores antes e durante Auth, datas preservadas/null, autoridade incompatível, erros transitórios e mudanças de contexto. O emulador usa Firestore/transações reais e Auth sintético.

Chromium conserva um pedido admitido com ACK perdido, purga as referências e Auth/perfis da fixture do destinatário, faz reload e recupera a cifra sem referências ou budget adicionais. Depois repõe apenas a fixture sintética para regressões independentes de relay/P2P; não há operação de remoção de marcador em produção. Auth/RPC/DB são sintéticos; RSA/AES, storage, IndexedDB, locks e WebRTC são nativos. Os ensaios não provam tokens Firebase reais, dispositivos ou rede externa.

Conflitos/backup/retenção de identidades, equipas/writers, cloud/segredos/quotas/alertas/restauração, qualidade, agentes/acessibilidade e validação integral das fases 0–6 continuam pendentes antes do deploy completo autorizado. O destinatário operacional permanece wgftechnologies@gmail.com; alertas ainda não foram ativados nem têm entrega verificada.
