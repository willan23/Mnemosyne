# UID capturado nos comandos de contactos — 12 de outubro de 2026

Atualização posterior: a [recuperação com destinatário eliminado](COMMS_CONTACTOS_DESTINATARIO_ELIMINADO.md) conclui o diário do remetente perante marcadores permanentes, sem depender de Auth do peer. As métricas abaixo pertencem ao incremento anterior.

## Contrato de transporte

Os cinco endpoints lookupCommsRecipient, createCommsContactRequest, getCommsContactRequestStatus, cancelCommsContactRequest e respondCommsContactRequest recebem agora um envelope exato `{actorUid, request}`. O conteúdo de request é validado pelo parser existente da operação. Campos adicionais, UID inválido, payload incorreto ou envelope ausente são recusados.

O cliente usa o UID passado pela operação capturada. O servidor copia o comando e compara actorUid com o UID do token antes do gate, Auth, rate limit ou Firestore. O UID do contexto é capturado numa variável antes dos awaits. Trocar de conta durante a preparação do SDK não pode fazer o mesmo comando operar com outro titular.

O dispatcher executeCommsContactCall aplica a mesma validação usada pelos callables e encaminha apenas o payload validado para os executores internos. O helper não é exportado pelo index público como endpoint. Participantes, marcadores de conta, chave pública e fingerprint continuam sujeitos às verificações anteriores. Respostas mantêm as projeções anteriores.

## Recuperação e compatibilidade persistente

O envelope de transporte não integra os bytes canónicos do pedido. CommsContactRequest continua a conter requestId, recipientUid e recipientFingerprint; o digest SHA-256 e os documentos v2 conservam a representação anterior. A cópia local continua cifrada no formato v1 com UID exterior e o mesmo request, sob a mesma chave de storage/Web Lock.

Recuperação/cancelamento decifram e verificam o UID do diário antes de construir o novo envelope. Um diário v1 existente pode consultar o recibo antigo e concluir com admissão fechada, sem reescrever a cifra, gerar outro UUID ou admitir outro pedido. Um token incompatível ou resposta tardia conserva a cópia cifrada. Lookup e resposta também capturam UID/payload antes de awaits; não recalculam o titular a partir da conta atual ao enviar.

Não há novo schema persistente, backfill, alteração de rules/índices, dependência ou gate. Novos pedidos/respostas permanecem fechados pelo gate de contactos; status/cancelamento conservam os percursos de recuperação existentes.

## Rollout e rollback

O formato RPC exige Functions e clientes coordenados. Callables atualizados recusam clientes que enviem somente o payload antigo; não há fallback silencioso para uma operação sem UID capturado. O rollout inclui atualização de web/Android/Tauri e dos clientes antigos antes de abrir escritas. O rollback deve conservar um servidor com a verificação de actor e um cliente que produza o envelope, mantendo a representação dos diários/recibos.

## Validação

Passaram 1.078 testes frontend/154 ficheiros, 332 Functions +um skip de rules sem emulador, quatro testes de pipeline, TypeScript/build web e lint geral com zero erros/23 avisos anteriores. Passaram 59 testes frontend focados/quatro ficheiros e lint do escopo sem erros/avisos; 39 backend focados; dez testes finais no emulador. A suite integral de rules, audits e CI remota não foram repetidos neste incremento.

Os testes recusam swaps de token nos cinco endpoints antes de Auth/DB/rate, verificam cópia do pedido antes de Auth await e preservação de UUID/digest/diário v1. O emulador usa Firestore/transações reais e Auth sintético, cobrindo recibos antigos, aceitação, cancelamento e regressões de locks/remoção/SDK privado.

Chromium usa o novo dispatcher com Auth/RPC/DB sintéticos em localhost e recusa os cinco comandos de Alice enviados com identidade de Carol. Verifica criação admitida com ACK perdido, diário v1 cifrado e recuperação sem create/budget adicional, resposta do destinatário e cancelamento desconhecido, além de diretório/remoção/relay/P2P/IndexedDB. RSA/AES, locks, WebRTC e reload são nativos. A rejeição aborted da fixture de remoção obsoleta é esperada. Zero pedidos externos, fornecedor ou mutações de produção. Não prova tokens Firebase reais, dispositivos ou rede externa.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-contact-actor-local-validation-20261012.json; logs comms-contact-actor-validation-20261012. A prova anterior de remoção fica imutável. 40 gates/21 fontes permanecem fechados; sem deploy.

## Trabalho restante

A recuperação dos pedidos ainda exige Auth ativo do destinatário: uma eliminação permanente pode deixar o diário do remetente sem resposta terminal. Esse percurso precisa de ser concluído com marcadores permanentes e sem recriar referências. Também continuam pendentes identidades/retenção/backup entre instalações, equipas/writers, cloud/segredos/quotas/alertas/restauração, qualidade, agentes/acessibilidade e validação integral das fases 0–6 antes do deploy completo autorizado.
