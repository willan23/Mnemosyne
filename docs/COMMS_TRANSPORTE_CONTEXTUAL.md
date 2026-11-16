# Transporte Comms com contexto e limites — 11 de outubro de 2026

## Contrato do cliente

`commsTransport.ts` prepara o envelope a partir de uma cópia de texto, File, PEM e fingerprint. Confirma SHA-256 do PEM e uma chave RSA-OAEP/SHA-256 de 2048–4096 bits/expoente 65537. O guard é verificado antes e depois de cada fronteira assíncrona de crypto/leitura do ficheiro. Uma mudança observada de UID/cofre/vista permanece invalidada após regressar. O envio no painel captura também a revisão do destinatário e recusa uma chave editada sem nova resolução.

Limites de política do cliente: texto UTF-8 de 32 KiB, anexo original de 256 KiB, payload cifrado de 384 KiB e envelope/JSON de 600 KiB. Os limites não constituem quotas de projeto nem substituem admissão no servidor. Descodificação verifica base64 canónico, IV de 12 bytes, chave AES de 32 bytes, schema do payload/attachment e igualdade do tamanho original com os bytes abertos. Mensagens RSA antigas continuam aceites dentro dos limites. Formatos legados maiores precisam de inventário e de um percurso explícito de leitura/migração; não se altera o ciphertext armazenado.

O MIME recebido não decide a navegação: HTML, SVG, JavaScript e restantes tipos fora da lista de imagens raster/texto/PDF recebem `application/octet-stream` no URL de download. O nome cifrado é validado contra campos de caminho/caracteres de controlo; o nome exterior continua a existir no formato anterior, pelo que este incremento não elimina essa fuga de metadados.

## Peer, sinalização e estado

Cada ligação guarda roomId, UID local, UID do peer, identidade capturada e instância de RTCPeerConnection. Mensagens P2P exigem tipo/schema e ambos os UIDs desse vínculo antes de desencriptar. Um canal já aberto para outro destinatário é recusado e não faz fallback silencioso para relay. Só o DataChannel esperado pode instalar handlers. Abrir o peer não equivale a confirmar receção.

Offer/answer são capturados, validados e protegidos após cada await; ICE usa o UID capturado, candidatos do peer esperado e a instância original. A fila permite no máximo 64 candidatos remotos e 64 locais, incluindo candidatos recebidos antes do remoteDescription. Os handlers retirados não escrevem através de uma conta posterior. Fechar/desmontar ou trocar identidade retira handlers, subscrições e peers locais. Fecho remoto pode continuar sem confirmação em caso de falha; limpeza de rooms órfãs continua pendente.

Antes de colocar bytes no DataChannel, o cliente verifica o tamanho máximo negociado, o estado aberto e a quantidade de bytes em fila. Máximo desconhecido/zero ou payload maior são recusados conservando a composição. Não há fragmentação nem retoma durável P2P. Texto de sucesso significa colocação no canal; não promete entrega. Relay confirma aceitação da escrita existente, sem prometer desencriptação remota.

Outbox/rooms usam a autoridade capturada, retiram callbacks tardios e conservam o ID real do documento após os dados. Listas ainda não estão paginadas. Após desencriptação bem-sucedida, perda do ACK de atualização não marca a mensagem como falhada. Chave indisponível, formato recusado ou falha de desencriptação ficam locais; não produzem automaticamente uma decisão terminal `failed` para o remetente.

## Validação e limites da prova

Passaram 983 testes gerais/147 ficheiros, antes das duas asserções adicionais de ACK e três casos de tamanho negociado/buffer. O build web posterior já contém a política final de ACK; TypeScript passou. Lint completo: zero erros/23 avisos anteriores. Passagem focada: 40 testes/quatro ficheiros (crypto/transporte, handlers e regressões de contactos/importação), incluindo os dois casos de ACK. Passagem final de handlers: 12 testes/um ficheiro, incluindo os três casos adicionais de máximo negociado pequeno/desconhecido e buffer cheio. TypeScript e lint final do escopo passaram. RSA/AES reais testam o limite de 256 KiB, fingerprints substituídos, base64/schema, metadados/size falsificados e MIME ativo. Os testes React de handlers usam Auth/Firestore/WebRTC/crypto de fronteira sintéticos e exercitam conta/cofre/close durante crypto, offer/answer, ICE antigo, peer falso e ACK tardio.

Chromium testa o serviço de transporte e RSA/AES reais com dois RTCPeerConnections locais e sem ICE servers externos. Texto/anexo atravessam o DataChannel; chave errada e peer falsificado são recusados. **Esse ensaio não percorre os handlers do painel**, nem prova Auth, relay ou dispositivos reais. A regressão Chromium de contactos percorre painel/controller/executores reais com Auth/RPC/DB/streams sintéticos localhost.

Prova privada e logs: `W:\real\mnemosyne-launch-evidence\comms-transport-local-validation-20261011.json` e `comms-transport-validation-20261011`. Backend, rules, índices e manifestos de dependências permanecem iguais aos da prova de contactos; os emuladores e audits dessa prova são históricos e não foram repetidos para este incremento do cliente. As primeiras falhas de tipos, lint (regex com control characters) e teste que tratava um IV válido como malformado foram corrigidas; logs existentes são conservados. 33 gates/16 fontes continuam fechadas. Nenhum deploy, ativação de alertas, chamada a fornecedor ou alteração de produção foi realizado.

## Trabalho seguinte

Concluir envio durável/idempotente por relay, diário cifrado/UUID/status/cancelamento, admissão por fingerprint/contas ativas e quotas transacionais, ACK vinculado ao destinatário e protocolo P2P com confirmação/fragmentação/retoma. Coordenar alteração de rules/clients para impedir bypass por escrita direta e tornar a recuperação visível. Depois: leitura/inbox autorizada e paginada, tratamento de revogação, legado/retensão/rooms órfãs, piloto entre dispositivos e critérios restantes das fases 0–6. Este incremento não conclui o Comms ou a fase 4. O deploy completo está autorizado após concluir e validar todas as áreas; alertas para wgftechnologies@gmail.com continuam sem ativação/entrega.
