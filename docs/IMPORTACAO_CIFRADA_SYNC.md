# Importação cifrada de sincronização — 4 de outubro de 2026

**Atualização posterior:** [PUBLICACAO_RECUPERAVEL_SYNC.md](PUBLICACAO_RECUPERAVEL_SYNC.md) implementa o envio com journal/índice cifrados e a confirmação independente do gate na interface. As secções abaixo conservam a cronologia e a evidência do incremento de importação; o estado atual está no documento de publicação e no estado de lançamento.

## Estado e âmbito

Implementados o protocolo de admissão no servidor e a importação pessoal nos clientes mobile/desktop. A importação usa lotes, comparação de estado, histórico, quota e recibos atómicos. Os clientes conservam um journal cifrado para confirmar operações após perda da resposta. A escrita direta de sessões pelo importador, o ACK separado e a limpeza que confiava em `pulled`/`tombstoneIds` foram retirados.

**A sincronização completa e a fase 4 continuam por concluir.** `MOBILE_SYNC_WRITES_ENABLED=false` e `MOBILE_SYNC_IMPORT_ENABLED=false`. A consulta/preparação server-side tem admissão própria; não autoriza novas escritas. O frontend normal recusa operações enquanto o seu gate está fechado, incluindo a importação com journal pendente. A confirmação independente desse gate e a descoberta de recuperação na interface ainda precisam de integração. Não houve deploy, alteração de regras/Functions de produção, contacto com fornecedores ou eliminação real.

## Fronteiras de privacidade

- O canal transporta memórias pessoais do UID atual. Os builders excluem memórias estrangeiras, de equipa, partilhadas e de âmbito ambíguo antes de serializar ou verificar conteúdo bloqueado.
- ECDH P-256/AES-GCM transporta o payload; o cofre cifra texto/título antes de preparar a escrita em repouso. A RPC de aplicação recebe apenas a cifra e metadata permitida. Nenhuma chave privada é enviada.
- Tags, embeddings, categoria, conexões e posições continuam visíveis no modelo de metadata existente. Este incremento não declara esses campos cifrados.
- A projeção de preparação contém apenas identidade do alvo, existência, hash de estado, revisão, timestamp, estado de eliminação e envelope cifrado. Exige `uid` próprio, `teamId:null` e ausência de partilha antes de devolver a cifra. Anexos e outros campos privados não são devolvidos.
- O servidor autentica o UID e lê a conta/dispositivo atuais. Clientes pareados usam a mesma identidade Firebase do dono; o recibo não constitui atestação do dispositivo ou prova de que um cliente adulterado respeitou o payload cifrado.

## Contrato

| Percurso | Entrada | Resultado e autoridade |
|---|---|---|
| `getMobileSyncImportStatus` | `envelopeId`, `deviceId`, `direction`, `payloadDigest` | Cursor/counters/estado ligados ao envelope e cifra exatos; sem conteúdo |
| `prepareMobileSyncImportBatch` | Identidade anterior, cursor e até dez IDs únicos | Projeção cifrada de alvos pessoais; a ausência de um documento não abre uma regra global de leitura |
| `applyMobileSyncImportBatch` | Identidade, cursor e até dez planos estritos | Sessões/histórico/quota/recibos e ACK final na mesma transação |

O digest é SHA-256 do payload cifrado `{iv,data}` canónico, não do texto em claro. A entrada tem campos exatos e limites de tamanho; IDs não podem conter `/`, nem ser `.`/`..`. O lote aceita `create`, `tombstone`, `update`, `delete`, `conflict` e `skip`. Cifra v1 e metadata permitida são validadas antes de qualquer trabalho de base de dados.

O cliente valida **todo** o payload decifrado antes do primeiro lote: versão, UID, fonte/direção, deviceId do delta, counts, IDs únicos, revisões/timestamps, limites de texto/título/metadata, operação de eliminação, cursor do delta e igualdade exata dos IDs tombstonados. Campos como `uid`, `teamId`, partilhas e anexos dentro de uma memória são recusados. Não existe propagação de um objeto recebido arbitrário para `sessions`.

Máximos atuais: 2500 registos por envelope, dez por lote, payload cifrado de 900 mil caracteres e requests normalizadas de oito milhões. Há buckets server-side de 60 chamadas por minuto por UID e modo. Um envelope grande pode exigir retoma após rate limiting; os limites de latência/memória e o comportamento de todos os dispositivos continuam a exigir piloto.

## Comparação de estado e reconciliação

O hash esperado liga os dados decodificados e o **`updateTime` público do snapshot Firestore**, fornecido pelo servidor. A serialização canónica distingue mapas, listas, números, timestamps, GeoPoints, bytes e referências. Referências criadas localmente incluem projeto/base de dados/caminho. O SDK Admin atual perde projeto/base de dados estrangeiros ao decodificar uma referência guardada; o `updateTime` evita que essa perda permita aprovar uma escrita concorrente. Qualquer alteração após preparação, incluindo uma regravação equivalente, invalida o lote.

- Alvo ausente: criar cifra pessoal ou tombstone com recibo permanente. Receipts anteriores impedem reutilizar um ID já criado/apagado.
- Alvo eliminado: `skip`; um upsert recebido não o ressuscita.
- Conteúdo recebido mais recente: `update`, mantendo UID, âmbito, timestamp original, anexos e autoria; dados derivados incompatíveis são invalidados.
- Conteúdo recebido mais antigo/da mesma revisão e divergente em texto/título: cópia de conflito com ID determinístico por envelope/índice. O original permanece.
- Eliminação recebida: só aplicar se o alvo vivo não for mais recente; um alvo mais recente permanece.
- Conexões existentes exigem alvos pessoais próprios, não partilhados nem eliminados. IDs ausentes são permitidos para importação progressiva do grafo.

Update/delete arquivam a **cifra anterior exata** e metadata/anexos permitidos numa versão determinística antes de modificar a sessão. Não há decifragem no servidor. Comparações de texto/título para conflitos acontecem apenas depois da projeção de âmbito validada, no cofre local.

## Commit, quota e ACK

| Documento | Utilização |
|---|---|
| `mobileSyncImports/{envelopeId}` | UID/dispositivo/direção/digest, início, cursor e counters agregados |
| `mobileSyncImports/{envelopeId}/batches/{cursor}` | Pedido e resultado imutáveis de cada lote confirmado |
| `memoryCreationReceipts/{sessionId}` | Impede nova criação após eliminação; também existe para tombstones |
| `memoryUsageReceipts/{sessionId}` | Contabilização única de memórias vivas/criações de conflito |
| `sessions/{id}/versions/{idDeterministico}` | Histórico cifrado exato de update/delete |

A quota paga/free é lida e incrementada na mesma transação das criações. Tombstones novos não consomem quota de novas memórias; o trigger existente também os ignora. Uma cópia de conflito viva consome quota. Repetir um lote idêntico devolve o resultado imutável sem criar, alterar ou contabilizar novamente, mesmo se o alvo já foi apagado ou o dispositivo revogado. Um lote diferente para o mesmo cursor é recusado.

`mobileSyncEnvelopes.status='pulled'` só é gravado pelo **último lote confirmado** na mesma transação. Um estado legado declarativo `pulled` não é convertido em prova de importação. Conta em eliminação, dispositivo revogado, quota esgotada, colisão de recibos, mudança de estado ou erro abortam o lote sem progredir o cursor nem emitir ACK.

## Recuperação local e interface

O journal cifrado fica em `mnemosyne:sync-import:v1:<UID>:<dispositivo>:<direção>`, com versão, UID, identidade/digest e count. Não guarda texto, título ou chave privada em claro. Um Web Lock com essa identidade impede duas operações concorrentes entre separadores; falha de suporte/storage/readback impede a primeira aplicação.

1. Ao retomar, decifrar e validar o journal para a conta/cofre/canal atuais.
2. Consultar o receipt agregado. Se estiver completo, confirmar/retirar exatamente esse journal; não exigir dispositivo ativo, chave privada ou decifragem repetida do payload.
3. Se estiver pendente, verificar fonte/dispositivo/chave novamente e preparar a partir do cursor confirmado. Não repetir o lote cuja resposta se perdeu.
4. Após o último lote, reler o receipt agregado e comparar counters/estado antes de remover o journal. Substituição do journal, ACK inválido ou transição de contexto conserva recuperação.

Conta/cofre são observados e uma mudança continua a invalidar a operação mesmo se o utilizador regressar imediatamente à conta/chave inicial. O cliente observa revogação/mudança de chaves e faz nova leitura do dispositivo antes de cada aplicação; a transação do servidor verifica novamente a autoridade. Mensagens de conclusão nas duas interfaces são descartadas após mudança de conta/cofre, fecho de painel ou saída da vista. O carregamento assíncrono da credencial mobile já não instala uma credencial tardia de outra conta nem regista o erro bruto.

O resultado inclui os counters confirmados do envelope completo, incluindo lotes anteriores recuperados. Não representa necessariamente apenas criações ocorridas no clique atual. O importador processa no máximo vinte envelopes por invocação. Um envelope inválido interrompe a operação e preserva a fonte; não declara sucesso parcial do conjunto.

## Regras, limpeza e eliminação de conta

Os clientes não podem fabricar receipts, provenance de sync, ACK `pulled` ou eliminar envelopes/dispositivos. A revogação não pode ser revertida nem o ID apagado/recriado pelo cliente. Tombstones de sync não podem ser restaurados pela atualização pessoal legada. Criações para IDs com receipt anterior são recusadas.

As regras só permitem expiração terminal `queued -> failed/expired` quando já expirou, sem receipt de importação e sem alterar payload/identidade. O importador atual **recusa e conserva** uma fonte expirada sem início confirmado; integrar esse tratamento sem bloquear a fila continua pendente. Uma importação iniciada pode retomar após expiração dentro da janela server-side de trinta dias desde o início. Nenhum tombstone/envelope é eliminado com base numa lista declarativa de ACKs. Retenção, cobertura de dispositivos, restore explícito e purge são trabalho obrigatório antes de ativar sync completo.

A eliminação de conta inclui `mobileSyncImports` por UID e elimina filhos dos receipts antes dos pais. O teste de conta com receipts de Alice/Bob confirmou que os dados de outro utilizador permanecem. A limpeza local inclui os journals de importação pelo prefixo com fronteira exata do UID; preserva journals de outras contas e IDs com prefixo semelhante.

## Migração, rollout e reversão

Primeiro concluir envio/journals/cursors, expirações/retenção, demais escritores, migração legada e pilotos. Alvos históricos sem `teamId:null` ou sem cifra v1 são recusados; a migração pessoal/cifra tem de preceder o corte. O inventário real anterior identificou dados/índices ainda por migrar.

Publicar Functions/regras/clientes compatíveis faz parte do rollout completo já autorizado, condicionado aos critérios de todas as fases. Publicar o novo cliente não migra instalações mobile/desktop antigas. Os antigos importadores que fabricam ACKs/provenance deixam de funcionar sob as novas regras; precisam de atualização/pausa controlada, inventário e piloto. Não abrir um dos dois gates sem a versão compatível do outro lado.

Em reversão, fechar novas escritas e conservar ciphertext, journals e receipts. Não voltar ao importador antigo, não apagar receipts e não chamar uma repetição com novos IDs/cifras para ocultar uma resposta perdida. A consulta de receipts continua disponível no servidor; falta o percurso independente de confirmação na interface quando o gate frontend fecha. Um deploy anterior só é elegível se preservar o contrato/regras de recuperação e a janela operacional tiver sido validada.

## Verificações e limites

Os ensaios são locais e sintéticos. Functions exercitam o executor diretamente; o emulador comprova transações e regras reais no projeto `demo-mnemosyne-rules`. O ensaio Chromium executa o **cliente/cifra/cofre/storage/Web Locks reais**, com Auth, dispositivo e RPC simulados em localhost. Não comprova Firebase Auth/App Check/rede de produção, push, native key store ou todos os dispositivos.

A suite completa anterior à última alteração do hash passou 125 testes Functions e 22 frontend no emulador. A primeira execução tinha 124 Functions verdes e dois testes frontend que esperavam ACK/delete legados; foram atualizados para verificar a recusa e expiração/revogação permitidas. A comparação entre projetos encontrou primeiro mistura de duas instalações do SDK no fixture, depois a perda de identidade no decoder Admin e, após incluir `updateTime`, uma expectativa de CAS antiga no fixture. Os casos específicos foram corrigidos e repetidos; nenhuma regra foi aberta para acomodar os testes.

Resultados gerais: **607 frontend /115 ficheiros**, **187 unitários Functions /uma suite de regras ignorada fora do emulador**, **cinco casos focados de sync no emulador após o hash final**, Chromium real e quatro testes do procedimento de deploy. Após acrescentar o journal à limpeza local e ajustar a guarda de feedback/assinaturas desativadas, os **33 testes focados /quatro ficheiros** passaram novamente; lint terminou com **zero erros e os 23 avisos anteriores**. A primeira passagem do lint encontrou quatro argumentos não usados e um aviso novo na guarda; ambos foram corrigidos. Os builds/evidência final e seus hashes ficam no registo privado verificado. Warnings conhecidos de frontend/rules não são apresentados como validação de produção.

## Próximo trabalho para fechar sincronização

Envio com journal cifrado/ID estável, confirmação após perda de resposta e cursor ligado ao UID/cifra enviada; autenticação/cofre/dispositivo em todos os awaits desse percurso; confirmação independente do gate e descoberta de recuperação na UI; expirações/retomas grandes; snapshots/metadata/conexões e compatibilidade de todas as instalações; retenção/cobertura de ACKs/restauração; matriz mobile/desktop/nativa e pilotos reais. Obsidian, restantes escritores semânticos, migrações e critérios das outras fases continuam no [estado completo](ESTADO_LANCAMENTO_COMPLETO.md).
