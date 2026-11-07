# Novos anexos cifrados — implementação em curso

Data: 1 de outubro de 2026. Estado: bases implementadas e testes locais; **ativação e fase 4 ainda não concluídas**. `ATTACHMENT_WRITES_ENABLED=false`, `ATTACHMENT_UPLOADS_ENABLED=false` e escrita de equipa fechada. Não houve publicação, migração de objetos nem configuração de bucket de produção neste bloco.

## Problema e ameaça

O uploader antigo transmitia o ficheiro e o seu nome em claro e devolvia uma URL persistente com token. Uma extensão ou MIME fornecidos pelo cliente não provam conteúdo seguro; um URL permanente também não verifica a pertença atual a uma equipa. Envios concorrentes, POST repetido, cancelamento, perda de ACK e mudança de época podem deixar objetos ou contadores inconsistentes.

O desenho assume cliente potencialmente adulterado e servidor sem chaves do cofre. Um administrador do projeto pode ler metadados e substituir ciphertext, mas não recebe a chave do ficheiro. Um membro que já descarregou conteúdo/chaves mantém esses dados; esta implementação não oferece revogação retroativa. O servidor não consegue verificar magic bytes ou o tag GCM do conteúdo original sem receber a chave ou o conteúdo.

## Decisão criptográfica e conteúdo

Cada ficheiro usa uma chave AES-GCM-256 nova, encapsulada pela chave pessoal ou da época da equipa. Nome, MIME e bytes ficam dentro do payload cifrado. AAD da chave liga UUID, uploader e âmbito; AAD do payload inclui o cabeçalho completo. Trocar equipa, época, keyId, uploader, ficheiro, chave encapsulada ou ciphertext invalida a abertura.

Formato binário `MNEMATT1`: oito bytes de magic, comprimento uint32 big-endian do cabeçalho, JSON canónico e ciphertext GCM. Cabeçalho limitado a 2048 bytes; metadata cifrada limitada a 4096. Campos públicos: versão, UUID, uploader, âmbito, categoria, comprimentos, IV e chave encapsulada. Categoria/tamanhos/UID/associação à equipa continuam a ser metadados sensíveis.

`functions/src/attachmentEnvelope.ts` é um módulo puro partilhado pelo cliente e Functions. Valida schema exato, base64/comprimentos, limites, cabeçalho canónico e assinatura inicial do conteúdo local. Limites: imagem/documento 25 MiB, áudio 50 MiB, vídeo 200 MiB. MIME vazio do Windows é suportado quando extensão e assinatura correspondem. Texto conhecido exige UTF-8; UTF-16 não é suportado neste formato. Contentores Office/ZIP/OLE são classificados pela assinatura inicial, sem análise completa interna.

Raster e formatos multimédia admitidos podem ter preview local. Código, PDF, documentos Office, SVG/HTML e formatos sem preview seguro ficam como `application/octet-stream` e download. A política é verificada novamente depois de decifrar; metadata ou tipo fornecidos pelo documento Firestore não prevalecem sobre o resultado verificado. A compressão de imagem produz agora extensão `.jpg` e MIME JPEG coerentes com os bytes.

**O backend verifica magic/schema/tamanho do envelope cifrado; isso não é scan antivírus nem validação dos magic bytes originais no servidor.** O cliente verifica o original antes da cifra e depois da decifragem. Não há scan cloud do original neste bloco. A alternativa de scan opt-in exigirá consentimento específico, regras de retenção e testes próprios antes de ser anunciada. `never-cloud` e política desconhecida impedem todo o percurso de rede, incluindo preparação de âmbito e autorização de leitura. `confirm-cloud` pede consentimento por operação.

Buffers temporários de chave/plaintext são preenchidos com zeros também nas falhas. Isto reduz a retenção nas cópias controladas pelo código; não é uma garantia de eliminação de todas as cópias do runtime/browser.

## Reserva, quarentena e publicação

1. O cliente autoriza política cloud, valida/cifra localmente, confirma o journal cifrado e os bytes cifrados no IndexedDB, e chama `beginAttachmentUpload` com o cabeçalho. Não envia nome/MIME original nem bytes em claro.
2. Transação lê conta, estado de apagamento, entitlement, config, equipa/época e quotas antes de escrever. A equipa tem de estar ativa, sem rotação pendente, e corresponder exatamente à época/keyId com wraps do uploader.
3. Reserva durável `attachmentUploads/{UUID}`, digest SHA-256 do cabeçalho e quota por utilizador e, se aplicável, equipa. Repetição exata não duplica quota nem prolonga prazos; UUID cancelado não é reutilizável.
4. POST GCS assinado por dois minutos, caminho `quarantine/{uid}/{UUID}`, tipo opaco e intervalo de bytes exato. A SDK documenta [políticas POST assinadas](https://googleapis.dev/nodejs/storage/latest/File.html); o protocolo aceita [`content-length-range`](https://cloud.google.com/storage/docs/xml-api/post-object-forms). O cliente rejeita host/path/policy/expiração diferentes e campos de redirecionamento.
5. `completeAttachmentUpload` lê metadata e prefixo limitado da geração recebida, compara schema/digest/tamanho e reclama uma lease de verificação de três minutos. O timeout da Function é 120 segundos. Só um worker com lease válida publica; outro recebe estado `verifying`.
6. Cópia para `encrypted/{UUID}` exige geração de origem e destino inexistente. A abordagem usa [precondições de geração GCS](https://docs.cloud.google.com/storage/docs/request-preconditions). Destino existente só é aceite quando metadata de digest, tamanho, MIME, cache e ausência de tokens correspondem. A transação final volta a verificar ACL/época/config/lease antes de confirmar `ready` e transferir quota.
7. O cliente só devolve `mnemosyne-attachment:v1:{UUID}` depois do ACK `ready`, com nome persistível fixo `Anexo cifrado` e MIME opaco. Filename do POST é `attachment.bin`. Progressos são marcos de operação, não contagem contínua de bytes. Os chamadores de imagem gerada, importação e uploader usam o descriptor; o uploader antigo fica permanentemente fechado.

Estados: `reserved → verifying → ready` ou `cancelled`. Reserva: 15 minutos. POST: dois minutos. Tombstones não têm TTL e a limpeza não apaga o registo. Cancelamento do uploader permanece disponível com uploads fechados e nunca elimina um objeto já `ready`.

## Quota e limpeza

`attachmentQuotas/user_{sha256(uid)}` e `attachmentQuotas/team_{sha256(teamId)}` só são acessíveis pelo servidor. Defaults: 1 GiB por utilizador e 4 GiB por equipa; config administrativa admite até 20 GiB. Máximo de dez reservas/cópias pendentes de limpeza e dez mil ficheiros armazenados.

A reserva cobra duas cópias do envelope para cobrir quarentena e destino. Publicação troca `reservedBytes/reservedFiles` por `storedBytes/storedFiles` e `cleanupBytes/cleanupFiles`. Cancelamento mantém a reserva até expirar POST/lease, passar margem de 60 segundos e confirmar remoção dos objetos. Limpeza de `ready` liberta só a cópia de quarentena; conserva a quota e o objeto publicado. Falha de remoção conserva a cobrança e permite retry.

`cleanupAttachmentQuarantine` percorre páginas limitadas a 50 reservas expiradas e 50 limpezas vencidas a cada cinco minutos. Remoção usa geração observada. Novos índices compostos: `attachmentUploads(status, expiresAt)` e `attachmentUploads(cleanupPending, cleanupAfter)`. Coleções novas são explicitamente negadas pelas regras de cliente.

O adaptador de Storage exige bucket em `europe-west1`, acesso uniforme e prevenção de acesso público; novos POSTs também recusam versionamento. MIME/disposição/cache do destino são opacos, download fixo e `private, no-store`. As operações externas de GCS não são atómicas com Firestore. O teste real de assinatura, CORS, IAM, precondições, duração/cancelamento dos workers e reconciliação de órfãos continua pendente.

## Leitura e previews

`mintEncryptedAttachmentReadUrl` exige ID e sessão exatos, conta existente e não em apagamento, `config/attachmentSecurity.readsEnabled=true`, registo `ready`, bucket configurado e referência opaca presente numa sessão viva. Uma referência pessoal exige `teamId:null`, UID da sessão e caller iguais ao UID do cofre; partilha pessoal não substitui a chave pessoal por outra chave. Equipas exigem pertença atual e wrap tanto da equipa como da época histórica, com keyId/epoch correspondentes. A época de um ficheiro histórico não precisa ser a época atualmente ativa.

O servidor valida metadata do objeto e assina a geração registada por dois minutos, com download/opacidade, e volta a autorizar antes de devolver o URL. Uma URL já entregue continua uma capacidade portável durante a validade. Não é persistida em Firestore.

O cliente rejeita host/path/geração/expiração/tamanho/headers/redirecionamentos diferentes; recebe via stream com limite exato, exige tag GCM/AAD/metadata/conteúdo válidos e só depois disponibiliza bytes locais. Perda de contexto, alteração de política, lock/unlock, logout/login e mudança de cache da equipa abortam a operação. Não há fallback remoto ou plaintext.

A grelha cria blob local com tipo verificado e nome decifrado; estes campos são transitórios. Blobs são revogados por mudança de conta/cofre/equipa/política, expiração, substituição de vista e unmount. Downloads fazem autorização nova e libertam o recurso depois da operação. Respostas tardias de views já fechadas também libertam os seus blobs. Os ficheiros locais existentes e o percurso de leitura de anexos legados mantêm os seus contratos.

## Gates por concluir antes da ativação e deploy completo

- Associação recuperável a memórias existentes: [ASSOCIACAO_RECUPERAVEL_ANEXOS.md](ASSOCIACAO_RECUPERAVEL_ANEXOS.md). Criação inicial durável, callers de capture/importação, journal IndexedDB, status/cancelamento e download local acrescentados em [RECUPERACAO_ENVIOS_E_CRIACAO_ANEXOS.md](RECUPERACAO_ENVIOS_E_CRIACAO_ANEXOS.md). **As regras atuais ainda congelam alterações diretas de anexos; não ativar o cliente só por estes serviços estarem implementados.**
- Recuperação dos lotes completos e das ligações/hierarquias, migração de ficheiros entre épocas e matriz de plataformas. Um novo UUID não recupera automaticamente a reserva anterior; POST já tentado não é repetido cegamente.
- Eliminação de objetos publicados, órfãos `ready`, referências históricas e contadores; integrar coleções/bucket novos no apagamento de conta antes de abrir uploads.
- Bucket privado real, IAM mínimo, CORS das plataformas, lifecycle compatível, alertas/limpeza e ensaio real com dados sintéticos num projeto isolado. O bucket de backup Firestore não deve ser reutilizado para uploads.
- Backup de bytes/metadados Storage, migração recuperável de referências/tokens legados e restauração testada. O export Firestore existente não inclui esses bytes.
- Matriz web/desktop/mobile/App Check, upload máximo e impacto de memória. AES-GCM atual processa um ficheiro inteiro; não é um formato streaming cifrado.
- Demais endpoints, Sentry, política e gates de todas as fases do prompt mestre.

## Publicação, migração e rollback

Não há alteração de dados existentes neste bloco. Config nova precisa de bucket e gates `writesEnabled/readsEnabled`; ausências negam acesso. Objetos/coleções/índices são novos. Publicação futura deve coordenar Functions/índices/regras/cliente e abrir operações apenas depois dos gates acima. Leituras dos objetos legados não convertem implicitamente o seu conteúdo.

Rollback fecha novos uploads e escrita de equipa, mantém cancelamento e limpeza das reservas, preserva objetos/registos/quotas e oferece recuperação ao utilizador. Não reabre o uploader em claro, tokens persistentes ou autorização apenas por uploader. Mudanças destrutivas de tokens/objetos exigem backup e restauração comprovados.

## Evidência e limites de teste

Testes usam exclusivamente conteúdo e identidades sintéticos. A suite de regras com JDK 21 e projeto demo executou **39 testes Functions e 22 frontend**, saída zero. Inclui quotas concorrentes, retry/tombstones, retenção de cobrança até limpeza, envelope adulterado, revogação/rotação antes de confirmar, personal/team ACL, época histórica e revogação depois da assinatura. Signing/copy/remove GCS são adaptadores simulados; Firestore/transações/regras são reais do emulador.

Functions: `npm test` compilou e passou **104 testes**, uma suite de regras ignorada fora do emulador. Testes frontend do fluxo comprovam cifra real, transplantes/tag inválido, zero pedidos com política negativa, POST exclusivamente cifrado, perda de ACK, streams truncados/excessivos, contexto expirado e limpeza dos previews. A execução final frontend passou **412 testes em 92 ficheiros**; build TypeScript/Vite passou com **3226 módulos**, incluindo o chunk real de leitura cifrada, e avisos de imports mistos/chunks grandes. Lint completo: **zero erros, 23 avisos**; lint do escopo passou.

O primeiro run completo teve **409 passes e um timeout de cinco segundos** em `EmbeddingReindexPanel`, sem falha de assertion. Limitou-se a concorrência a quatro workers na config, conservando os mesmos testes/timeouts. Uma repetição enquanto a correção de compressão ainda era editada carregou a implementação anterior e falhou no teste novo do nome JPEG; esse run não representa uma verificação de snapshot estável. O teste focado passou e o run final, após estabilizar código/config, passou os 412 testes. Não se declaram os runs anteriores verdes.

A auditoria atual detetou vulnerabilidades novas/transitivas; a correção e a validação da árvore de dependências são um gate separado de lançamento. Os resultados acima precedem a reinstalação dessa árvore.

Depois da correção/reinstalação, Node **22.23.3** passou **412 testes frontend/92 ficheiros**, **105 testes Functions** (uma suite de regras ignorada fora do emulador) e **39 testes Functions + 22 frontend** no emulador JDK 21. Auditorias dos dois packages: zero vulnerabilidades. O SDK real instalado detetou a forma incorreta de metadata de cópia; foi corrigida e ganhou teste de contrato de precondições/metadata/retry/remoção. Detalhes e evidência final de build/lint: [DEPENDENCIAS_NODE22_2026-10-01.md](DEPENDENCIAS_NODE22_2026-10-01.md). Isto não fecha os gates funcionais/de produção acima.

Após associação/recuperação de memórias existentes: **424 testes frontend/94 ficheiros**, **107 Functions** (uma suite ignorada fora do emulador), **41 Functions + 22 frontend** no emulador e depois **7 testes focados de anexos**, incluindo a nova disputa de cancelamento, passaram. A ligação final a CognitiveSidebar foi seguida por **14 testes focados**, lint do escopo, build final **3231 módulos** e lint completo **zero erros/23 avisos**. Detalhes e limites: [ASSOCIACAO_RECUPERAVEL_ANEXOS.md](ASSOCIACAO_RECUPERAVEL_ANEXOS.md). Criação inicial, recuperação de upload e ciclo de eliminação permanecem gates separados.

Atualização posterior de recuperação/criação: **454 testes frontend/98 ficheiros**, **111 Functions**, **48 + 22 no emulador** e **dois testes de criação focados depois da recompilação**, Chromium com armazenamento real, build **3237 módulos** e lint completo **zero erros/23 avisos** passaram. Criação inicial e recuperação de upload estão implementadas localmente; ciclo de eliminação, lotes/hierarquias, piloto real, migração/restore e plataformas mantêm a ativação fechada. Decisões, schema e limites atuais: [RECUPERACAO_ENVIOS_E_CRIACAO_ANEXOS.md](RECUPERACAO_ENVIOS_E_CRIACAO_ANEXOS.md).
