# Recuperação de envios e criação inicial com anexos

Atualização de 2 de outubro: purge e integração do apagamento de conta avançaram localmente; evidência e gates ainda abertos em [ELIMINACAO_ANEXOS_E_CONTAS.md](ELIMINACAO_ANEXOS_E_CONTAS.md). A cronologia e pendências abaixo representam o estado anterior a esse bloco, sem declarar concluída a fase 4 ou o lançamento.

Data: 1 de outubro de 2026. Implementação e validação locais. **A fase 4 e o lançamento completo continuam em curso.** Não ocorreu deploy, import, migração, alteração de bucket/configuração ou eliminação de objetos de produção neste bloco.

## Decisão e ameaça

Uma resposta perdida não prova que uma operação falhou. Repetir o POST pode substituir a geração que um worker está a publicar; criar outra memória com `addDoc` pode duplicar a primeira. Apagar um rascunho antes de confirmar o cancelamento pode perder a única cópia de uma gravação.

Escolheu-se guardar o envelope cifrado e um checkpoint pessoal cifrado **antes da reserva**, recuperar sempre o mesmo ID/cabeçalho, conservar recibos e tombstones permanentes, e gravar memória/referências/uso/recibo numa transação. Não há sucesso otimista nem associação automática a uma memória por se ter encontrado um envio local.

O cliente, a rede e o Storage podem falhar ou ser adulterados. IDs e metadados públicos continuam observáveis; nome, MIME original e bytes não são enviados em claro pelo pipeline. A política `never-cloud`, política desconhecida e consentimento recusado impedem pedidos de recuperação, criação e cancelamento ao servidor. Recuperação **local** do ficheiro usa apenas o cofre e chaves de equipa já em cache; não obtém autorização/chaves na cloud.

## Journal do envio e recuperação

- IndexedDB `mnemosyne-attachment-upload-journal-v1`, object store `uploads`, chave `[uid, UUID]`.
- Valor `{envelope, bytes}`: `envelope` cifrado pela chave pessoal e `bytes` contendo exclusivamente o envelope cifrado do ficheiro, em `ArrayBuffer`. Não se guarda `File` original nem nome em claro.
- Checkpoint cifrado `{v:1, uid, header, name, phase, bytesDigest}`. Fases locais `pending`, `posting`, `ready`; digest SHA-256 do envelope completo.
- Uma escrita só é confirmada no `transaction.oncomplete` do IndexedDB e tem leitura de confirmação. Aborto depois do sucesso de `put` continua a ser falha. Web Lock por UID/ficheiro; ambiente sem Locks ou lock ocupado recusa a operação.
- Antes de cada pedido são verificados conta, cofre, contexto/época, política, schema, ID, tamanho, cabeçalho canónico e digest. Contexto perdido conserva o journal e suprime a resposta tardia.
- `posting` é persistido antes do POST. Na recuperação desse estado chama-se o finalizador para o mesmo ID; **o POST já tentado não é repetido cegamente**. `verifying` respeita a lease, e `expired` exige recuperação local/novo envio explícito.
- `ready` liberta os bytes cifrados locais e conserva o pequeno checkpoint cifrado até existir recibo de associação/criação. A limpeza local falhada conserva também o journal da operação confirmada, permitindo repetir apenas essa limpeza.
- Inventário local paginado a 50 IDs por conta, sem carregar os outros ficheiros. Um checkpoint ilegível/transplantado fica conservado e sinalizado; não oculta os restantes. Lock, conta, equipa, política e troca de vista limpam nomes da UI e invalidam respostas antigas.

O browser pode remover armazenamento local, perder dados em modo privado ou ficar sem quota. Isto não é um backup fora do dispositivo. O nome e os bytes originais existem transitoriamente em memória depois de abrir o cofre; buffers controlados de plaintext são preenchidos com zeros e os URLs de download são revogados.

## Status e cancelamento do upload

Callables regionais `getAttachmentUploadStatus` e `cancelUnconfirmedAttachmentUpload`; autenticação, limites de 60/20 chamadas por minuto e erros fixos. Aceitam somente `{header}` canónico, com UID do caller. Não devolvem URL assinado, nome original ou conteúdo.

Status `{id,digest,status,bytes,expiresAt,postExpiresAt,retryAt}`: `unknown`, `reserved`, `verifying`, `ready`, `cancelled` ou `expired`. `unknown` não é confirmação de cancelamento. `ready` permanece consultável depois dos prazos de reserva. Equipas exigem pertença/wrap atuais e epoch/keyId/wrap históricos correspondentes; uma rotação não transforma automaticamente um ficheiro histórico confirmado em inválido.

Cancelamento antes da reserva cria `attachmentUploadCancellations/{UUID}` com `{v,uid,id,digest,status:'cancelled',createdAt}`. A reserva lê o tombstone na mesma transação e rejeita um `begin` atrasado. Não há TTL. Reserva/verificação já existente é cancelada sem libertar quota antes da remoção real, depois dos prazos POST/worker e margem de 60 segundos. Objeto `ready` devolve `ready` e é conservado. Status/cancelamento permanecem disponíveis com o gate de escrita fechado, respeitando conta/ACL atuais.

Coleção nova explicitamente negada nas regras de cliente; sem índice composto adicional neste bloco. Os índices de limpeza existentes continuam necessários.

## Guardar o ficheiro local antes de repetir

O painel oferece **Guardar ficheiro local** para checkpoints com bytes. Verifica digest, cabeçalho, unwrap, AAD, tag GCM e política de conteúdo; entrega exclusivamente download local com tipo opaco. Não reserva, assina, envia, cancela nem apaga o journal. A mensagem diz que o download foi iniciado, e exige verificar o ficheiro descarregado antes de cancelar/repetir; a aplicação não afirma que o utilizador já tem uma cópia verificada em disco.

Isto permite conservar gravações cujo POST nunca chegou ao servidor ou cuja reserva expirou. Depois de confirmar o ficheiro local, o utilizador pode cancelar o envio antigo e escolher o original para um envio novo. Não existe reenvio automático com um UUID novo nem reencapsulamento automático para outra época.

Para equipas, a recuperação local requer a chave histórica ainda em cache. Se ela não estiver disponível, o journal é conservado e não há fallback de rede. Objeto já `ready`, cujos bytes locais foram libertados, usa o percurso normal autorizado de leitura após associação. A obtenção deliberada de chaves históricas e a migração dos ficheiros entre épocas têm de ser verificadas no piloto de equipa.

## Criação inicial durável

`attachedMemoryContract.ts` é puro e partilhado. Request exato `{sessionId,teamId,keyEpoch,keyId,enc,attachmentIds,metadata}`: UUID fixo, um a vinte IDs únicos, cifra v1 pessoal ou v2 de equipa, IV/base64 e comprimentos limitados. Metadata tem allowlist e limites; não aceita texto/título em claro, URLs, prompts, UID fornecido pelo caller ou alterações arbitrárias do documento. Ordenação canónica liga todos os campos ao digest. Ligações/parent pessoais são autorizados por proprietário; criação de equipa não aceita referências a pais pessoais.

`createAttachedMemory` continua fechado por `ATTACHED_MEMORY_CREATION_ENABLED=false`. A operação interna verifica conta não em apagamento, config/bucket, plano, ready registry de **todos** os ficheiros e âmbito exato. Equipas exigem gate, época ativa fresca, ausência de rotação pendente e wraps consistentes. Na mesma transação:

1. Recusa sessão ou contabilização preexistente sem recibo correspondente.
2. Cria a memória E2EE e os descriptors opacos a partir do registry confiável, sem usar nomes/URLs fornecidos pelo cliente.
3. Atualiza o contador mensal e cria `memoryUsageReceipts/{sessionId}`.
4. Cria `memoryCreationReceipts/{sessionId}` `{v,uid,teamId,sessionId,digest,status:'committed',createdAt}`.

Uma repetição exata recebe o mesmo recibo, inclusive depois de fechar config/entitlement/gates. Mudança do payload ou caller não é um retry. O recibo confirma **a criação histórica**; não recria uma memória entretanto apagada nem afirma que o seu conteúdo atual é igual ao pedido original.

`getAttachedMemoryCreationStatus` e `cancelAttachedMemoryCreation` usam o pedido completo/digest e verificam conta/pertença atuais. Cancelamento `unknown` cria um recibo permanente `cancelled`, serializado com a criação. Se o commit vencer, cancelamento confirma `committed`; se o cancelamento vencer, criação atrasada falha. Não apaga ficheiros `ready` partilhados ou por associar.

Ambas as coleções de recibos são server-only, sem TTL ou índices compostos novos. As regras recusam criação direta num ID com recibo de criação ou utilização. `onMemoryCreated` passou a contabilizar com recibo transacional, evitando cobrança duplicada por redelivery ou pela criação já contabilizada; não recria perfis inexistentes/em apagamento. O gate de 30 memórias desta **nova operação** é atómico. Os escritores legados sem anexos ainda usam o gate de regras baseado no contador do trigger; não se declara resolvida a concorrência de todos esses escritores.

## Cliente e chamadores

Uma criação pendente por UID, Web Lock e journal pessoal cifrado em `mnemosyne:attached-memory-creation:v1:{uid}`. Guarda pedido/ID/cifra exatos com readback antes do callable. Nunca substitui uma operação pendente por uma proposta nova. Recuperação consulta status antes de tentar novamente; resposta malformada, desconhecida, erro ou perda de contexto conservam o journal. Consentimento descreve o tamanho efetivo do request cifrado e a presença de memória; preparação de equipa tem consentimento próprio antes da leitura fresca.

Capture e `persistLearnedMemory` usam este percurso para anexos. Não criam uma memória vazia com `addDoc` para depois tentar associar o ficheiro. A captura de equipa sem anexos passou a `persistTeamSession`, com época/keyId frescos; equipa selecionada indisponível não cai silenciosamente no cofre pessoal. Upload de imagem falhado nesta captura não é convertido silenciosamente numa criação sem anexo. O painel de recuperação aparece no componente de captura usado pelo App, com cofre/conta/contexto e confirmação de cancelamento.

Sem anexos, os escritores pessoais existentes mantêm o percurso anterior; não se declara recuperação durável de todos esses fluxos. Importações em lote ainda precisam de checkpoints próprios para hubs/hierarquias e ligações recíprocas: recuperar a criação de um documento não retoma automaticamente todo o lote.

Um teste grande encontrou `RangeError` na conversão antiga de ciphertext para Base64, por expansão de todos os bytes em argumentos. A conversão passou a blocos de 8192 bytes, conservando o formato AES-GCM. Testes verificam cifra/decifra de payload grande e journal de request com 390 mil caracteres de ciphertext, com consentimento do tamanho correto.

## Validação e falhas registadas

Dados exclusivamente sintéticos. A execução geral anterior passou **434 testes frontend/94 ficheiros**, **109 Functions** e **44 Functions + 22 frontend** no emulador. Chromium confirmou persistência IndexedDB depois de reload, isolamento de conta, paginação, aborto transacional depois de `put` e libertação dos bytes em `ready`.

A integração encontrou dois testes falhados de persistência da barra lateral (`stopAuth is not a function`) e chaves React repetidas. O mock global foi corrigido para devolver o unsubscribe real do contrato Auth; o painel continua renderizado nos testes. As chaves passaram a `attachments:{id}`. Depois passaram 31 testes focados e os 434 gerais. Um comando anterior de seleção de testes foi interpretado pela shell como pipe e terminou com erro; não é declarado verde.

Os primeiros testes do download local falharam por assertions de fixture: nome do valor `download-only` e adulteração fora do comprimento do buffer. Foram corrigidos sem retirar verificações de conteúdo/digest. Lint encontrou control characters no regex de filename; sanitização passou a verificar os códigos dos caracteres. Depois passaram **37 testes focados** e lint do escopo.

Criação/integração: **111 Functions** passaram (uma suite ignorada fora do emulador); **48 testes Functions + 22 frontend** passaram nos emuladores reais. Depois da integração passaram **451 testes frontend/98 ficheiros**, Chromium, build **3237 módulos** e lint completo **zero erros/23 avisos**. O teste grande acrescentado depois desse run reproduziu `RangeError`; a correção passou em **20 testes focados**, TypeScript e lint do escopo.

Verificação final depois da correção de Base64 e do isolamento de checkpoints ilegíveis: **454 testes frontend/98 ficheiros**, **111 Functions** (uma suite ignorada fora do emulador), Chromium com IndexedDB real, build **3237 módulos** e lint completo **zero erros/23 avisos**, todos com saída zero. A regra adicional que impede pai pessoal numa criação de equipa passou no contrato unitário; os **dois testes de criação selecionados por `attached`** voltaram a passar no emulador depois da recompilação. O ensaio geral de equipa/contabilização continua incluído nos 48 + 22 anteriores. Emuladores/browser foram encerrados normalmente. `git diff --check` do escopo rastreado passou; não se afirma que o repositório inteiro esteja limpo.

Uma suite nova de integração de learningService falhou inicialmente antes de executar testes porque o mock de memoryCrypto não oferecia os exports exigidos pelo uploader importado. Foi isolado o uploader, que não é usado por esses testes de persistência; as assertions que impedem fallback para `addDoc` foram conservadas e os dois testes passaram. Signing/copy/delete GCS continuam simulados; não houve ensaio num bucket real, testes de dispositivos ou teste de restauração neste bloco.

## Migração, publicação e rollback

Não migra registos, objetos nem memórias existentes. Não apaga tokens históricos. Novas coleções exigem regras negando cliente e Functions antes de ativar UI; ausência de config nega escrita. Não reutilizar o bucket de export Firestore para upload. Não publicar só o cliente ou abrir uma flag isoladamente.

Rollback fecha uploads/criação/associação/equipas, conserva journals/recibos/objetos/quotas e mantém status, cancelamento e limpeza. Não elimina tombstones para “desbloquear” IDs nem reabre upload em claro.

**Ainda necessários antes da ativação/deploy completo:** ciclo de eliminação e órfãos `ready` com referências atuais/históricas; integração do bucket/quotas/novos recibos no apagamento de conta; corrigir falha de Storage que atualmente permite prosseguir para apagar Auth; recuperação de lotes e ficheiros de épocas antigas; GCS/IAM/CORS/assinaturas/precondições reais; backup/migração de Storage e restauração isolada; matrizes web/desktop/mobile/App Check e limites de memória. AES-GCM de ficheiros continua a processar o ficheiro inteiro. Demais fases e gates do prompt mestre permanecem obrigatórios.

A autorização humana para deploy completo já existe e mantém a condição de concluir todas as áreas e validações. Este documento não altera essa condição nem abre gates.
