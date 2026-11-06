# Leitura autorizada de anexos legados

Implementação local de 1 de outubro de 2026. Este documento cobre a leitura de referências existentes; o pipeline de novos uploads ainda não está concluído e `ATTACHMENT_WRITES_ENABLED` permanece falso. Não houve alteração de regras, objetos, metadados, tokens ou dados de produção.

## Correções e contrato

Antes desta alteração, o uploader podia ignorar a ACL da sessão, o frontend reutilizava URLs com token permanente e a cache não identificava a conta. A resolução agora exige sessão e autorização nova para qualquer ficheiro cloud, incluindo o seu uploader. Não há cache global de URLs nem fallback para a referência antiga quando a autorização falha.

`mintAttachmentReadUrl` aceita `sessionId` e `objectPath` (ou URL Firebase estrita do bucket configurado). Recusa campos desconhecidos, IDs/pastas inválidos, traversal, caracteres de controlo, esquemas/hosts estrangeiros e referências de outro bucket. O servidor lê perfil, sessão e equipa numa transação consistente. Exige conta existente fora de apagamento, sessão viva, ACL pessoal ou pertença atual à equipa, e referência exata ao objeto no documento. Autoria, partilha e propriedade do caminho não sobrepõem a pertença à equipa. O mesmo UID uploader removido não obtém acesso por esta Function.

O limite do endpoint é 60 pedidos por UID/minuto, atómico e com recusa se o limitador falhar. A autorização é verificada antes de consultar o objeto e novamente depois da assinatura. Respostas de erro têm mensagens fixas; não registam URL, tokens ou objetos de erro. A URL v4 dura dois minutos e impõe `application/octet-stream` e `Content-Disposition: attachment; filename="attachment"`. O SDK oferece esses overrides através de [`responseType` e `responseDisposition`](https://cloud.google.com/nodejs/docs/reference/storage/7.3.1/storage/getsignedurlconfig); isso não prova validação de conteúdo nem todos os headers do objeto.

As regras de Storage locais recusam leitura direta, download tokens via SDK e eliminação dos caminhos legados pelo cliente, mesmo para o uploader. Esses caminhos não identificam âmbito pessoal/equipa, pelo que não permitem decidir ACL atual com segurança. A leitura passa pelo servidor; purge administrativo de conta continua a usar Admin SDK. Um cliente antigo não pode ser usado como fallback para esta política.

## Cliente e prévias

O frontend exige cofre desbloqueado, valida bucket/path e a URL assinada recebida, recusa URLs expiradas ou com validade excessiva e não publica ACK depois de mudanças de conta/cofre. As subscrições temporárias são removidas ao terminar. Logout seguido de login na mesma conta ou lock/unlock não recupera uma resposta antiga.

A grelha começa sem referências resolvidas e só mostra o resultado autorizado do contexto atual. Mudança de sessão/conta/cofre limpa prévias e lightbox; URLs são renovadas antes da expiração. Recusas ficam ocultas com aviso genérico e ação de tentar novamente. Não apresenta referências recusadas como documentos apenas escondidos pelo limite da grelha. Descarregar faz nova autorização, omite credenciais/referrer/cache, recusa redirects e verifica o contexto depois de receber os bytes, antes de iniciar o download no browser.

Blobs da própria origem e anexos locais de transmissões continuam locais. Data URLs de imagem/áudio/vídeo têm allowlist, limites por categoria e assinatura inicial compatível; documentos locais permitidos são servidos como bytes opacos. SVG/HTML, MIME desconhecido e imagens com assinatura incompatível são recusados. Esta proteção local não é o validador de uploads do backend nem uma análise completa do ficheiro.

## Garantias e limites

Atualização local de 3 de outubro: a autorização transacional acrescenta recusa quando a conta do namespace do caminho está em eliminação/revogada, quando existe marcador/estado de eliminação da equipa ou quando a conta do dono da equipa está revogada. Não atribui propriedade pelo caminho; o check serve para recusar nova capacidade num namespace revogado. Um dono ausente/inválido no schema não autoriza a equipa. A dupla autorização observa também marcadores surgidos enquanto se assina. Os testes novos reproduziram aceitação indevida antes da correção; contrato, evidência e inventário real em [RECONCILIACAO_ANEXOS_LEGADOS.md](RECONCILIACAO_ANEXOS_LEGADOS.md). Os tokens permanentes observados no bucket não foram removidos.

Uma URL temporária já emitida é uma capacidade portável durante a validade; pertença removida depois da resposta não invalida retroativamente essa URL. Bytes já descarregados ou em cache não podem ser retirados. As regras novas **não revogam tokens de download antigos já emitidos**: é obrigatória uma migração administrativa recuperável dos metadados/tokens e das referências. Não se afirma que os anexos de produção já estejam protegidos por esta mudança local.

Os objetos antigos podem continuar em claro e sem scan/magic bytes verificados no backend. Permanecem pendentes: cifra e formato de novos uploads, allowlist comum cliente/servidor, quota de bytes, quarentena/scan com política de privacidade explícita, headers completos, migração de URLs/tokens/Storage, recuperação e ensaio das plataformas. Cifra ponta a ponta não permite ao servidor verificar a assinatura do conteúdo original sem receber esse conteúdo; o novo pipeline terá de distinguir validação do envelope cifrado, inspeção local e eventual inspeção cloud expressamente consentida. Nenhuma inspeção cloud é permitida em `never-cloud`.

## Schema, migração, índices, publicação e rollback

Não muda o schema persistido de `Attachment` nem exige índice novo: leituras são por ID. `readSourceUrl/readExpiresAt` são campos transitórios da grelha, não dados de sessão. A assinatura não é persistida nem devolvida como substituição para gravar no documento. O contrato da callable passa a exigir sessão também para o uploader; refs externas/ativas/incompatíveis não são abertas.

Antes do deploy completo: concluir o pipeline e restantes gates; preparar cópia dos bytes e metadados do Storage (o export Firestore não os cobre), inventário sem conteúdo em logs, plano recuperável de troca/revogação de tokens, teste de ACL no projeto isolado e piloto de leitura/download. Publicar a Function compatível, frontend e regras coordenados, mantendo novos uploads fechados até o seu gate passar. Verificar MIME/headers/CORS/assinatura reais: o emulador não implementa a assinatura GCS de produção.

Rollback deve conservar autorização por sessão e ausência de fallback; não voltar a URLs permanentes ou leitura direta só porque um cliente antigo falha. Pode fechar temporariamente a leitura cloud mantendo os dados e referências. Não eliminar objetos nem tokens em massa sem evidência de recuperação validada.

## Evidência

Cinco testes Functions comprovam parsing estrito, ACL por pertença, sessão obrigatória mesmo para uploader, rate, headers/TTL, dupla autorização e mensagens fixas. O emulador executa a transação de autorização real: uploader/autor removido, membro atual/removido, referência/bucket incorretos, sessão inexistente/apagada e conta inexistente/em apagamento. Confirma recusa de leitura/delete/upload diretos no Storage.

Doze testes frontend do escopo cobrem autorização sem cache, parâmetros/resposta inválidos, ausência de fallback, logout/login, lock/unlock, assinatura local, grelha sem URL original antes do ACK, mudança de contexto, expiração, lightbox/cofre, nova autorização no download e bloqueio antes de gravar bytes depois de mudança de contexto. O primeiro ensaio de logout revelou que o mock resolvia URLs com UID nulo: a grelha passou a impedir explicitamente resolver sem conta. O teste de lightbox corrigiu o seletor para o nome acessível real do botão.

Suite completa frontend: **395 testes em 89 ficheiros**, zero falhas. Build TypeScript/Vite passou com **3222 módulos** e avisos conhecidos de imports mistos/chunks grandes. ESLint do escopo e TypeScript passaram. Functions: **99 testes passaram**, uma suite de regras ignorada fora do emulador. Execução integrada de regras com JDK 21/Firebase CLI 15.32.0, projeto `demo-mnemosyne-rules` e credenciais removidas: **36 Functions + 22 frontend**, saída zero e emuladores encerrados. Todos os dados/URLs/chaves de teste são sintéticos; não se afirma scan de conteúdo, migração real ou piloto de produção.
