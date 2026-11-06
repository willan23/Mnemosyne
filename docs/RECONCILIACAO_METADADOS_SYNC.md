# Reconciliação de metadados de sincronização — 4 de outubro de 2026

## Falha corrigida e contrato

O importador comparava texto/título ao decidir `skip` para uma revisão recebida igual ou anterior. Tags, categoria, conexões, posição, importância, tipo celestial, cluster e embedding/modelo podiam diferir sem serem aplicados ou conservados. O recibo de importação completa permitia depois ao remetente confirmar o fingerprint desse payload. Esse percurso foi corrigido.

A projeção `prepareMobileSyncImportBatch` acrescenta `metadataHash`: SHA-256 da representação canónica normalizada dos nove campos sincronizáveis. Não devolve os valores dos metadados, conteúdo, anexos ou campos de autorização. Alvo ausente usa `metadataHash:null`; alvo existente exige hash de 64 caracteres hexadecimais. O cliente recusa respostas antigas sem o campo, campos extra e hashes malformados antes de preparar/aplicar um lote.

O hash não anonimiza metadados. Continua ligado a uma memória sensível e só é fornecido depois de validar conta ativa, dispositivo, proprietário, âmbito pessoal sem partilha e cifra. Texto/título continuam cifrados; a decisão existente de guardar certos metadados em claro no servidor não foi alterada.

## Normalização e decisão

`SYNC_MEMORY_METADATA_FIELDS` é a allowlist única partilhada pelo parser, comparação e substituição. A normalização para comparação:

- Ignora UID, equipa, conteúdo, anexos e restantes campos não sincronizáveis.
- Trata valores opcionais `null` como ausência.
- Trata tags/conexões ausentes como listas vazias, coerentes com a vista local.
- Trata vetor vazio/ausente e um model label sem vetor como ausência de embedding.
- Valida os restantes valores/limites sem reparar silenciosamente dados malformados.

Ordenação de listas é preservada; diferenças podem produzir conflito conservador. Uma projeção com metadados inválidos falha integralmente, sem devolver resultados parciais nem criar progresso; dados legados inválidos exigem reconciliação/migração.

| Estado | Decisão |
|---|---|
| Alvo ausente | Criar cifra pessoal/tombstone segundo o protocolo existente |
| Alvo eliminado | Ignorar; não ressuscitar |
| Upsert com revisão mais recente | Atualizar cifra e estado completo dos metadados sincronizáveis |
| Revisão igual/anterior; texto, título e hash normalizado iguais | Ignorar como equivalente |
| Revisão igual/anterior; qualquer diferença de texto/título/metadados | Conservar como conflito cifrado com ID determinístico |

A comparação nova mantém a guarda de conta/cofre depois do await do hash. Mudanças de conta/cofre ficam latched mesmo se o utilizador voltar ao estado inicial. O CAS do servidor continua a ligar todos os dados e `updateTime`: alteração de posição sem mudar `updatedAt` invalida um plano preparado anteriormente.

## Substituição, histórico e quotas

Um update mais recente representa estado completo dos nove campos, não um patch parcial. Campos omitidos são removidos com `FieldValue.delete()`, incluindo tags/conexões/categoria/posição e campos vetoriais. Isto impede que metadados removidos reapareçam a partir do alvo antigo. Os callers precisam de fornecer a vista completa, validada pelo builder de snapshot; não usar este percurso com um objeto parcial inventado.

Antes de substituir, a transação arquiva cifra, todos os metadados anteriores selecionados e anexos. UID/equipa, timestamp original e anexos operacionais ficam preservados no alvo. Atualizar não consome quota de criação. Um conflito conserva o original e recebe uma criação/contabilização própria uma única vez; um replay não duplica memória, histórico ou quota.

Conexões existentes a memórias estrangeiras, de equipa, partilhadas ou eliminadas são recusadas antes de qualquer escrita. A semântica global de relações dirigidas/recíprocas, tombstones e os demais escritores continuam a precisar de revisão; este incremento não inventa alterações nos peers nem conclui essa matriz.

## Compatibilidade e reversão

O novo cliente e servidor de preparação precisam de rollout compatível. Cliente novo com resposta antiga falha antes de aplicar. Os pedidos/recibos de lotes existentes não mudaram; confirmação histórica/replay exato continuam disponíveis sem recifrar ou repetir a operação. Gates de publicação/importação continuam fechados.

Envelopes e instalações antigos precisam de inventário/migração/piloto antes da abertura. Não assumir que payloads históricos parciais representam o novo contrato de substituição. Em reversão, conservar journals/recibos/histórico/cifra e fechar novas escritas; não regressar à comparação que ignorava metadados ou à criação/ACK direto pelo cliente.

## Validação atual e limites

- **53 testes frontend focados /seis ficheiros**, incluindo oito classes de diferença de metadados em revisões iguais/anteriores, igualdade normalizada, metadata hash inválido, atualização mais recente e troca de conta durante hashing.
- **19 testes focados backend** e **196 unitários Functions**; uma suite de regras ignorada fora do emulador.
- **13 testes de sincronização no emulador** `demo-mnemosyne-rules`, incluindo três casos novos de projeção/hash/CAS, remoção real de campos/arquivo exato e conflito/ligações/quotas atómicos.
- **Dois ensaios Chromium** com cifra, cofre, storage, Web Locks e clientes reais contra RPC sintética localhost. O percurso de publicação/importação cobre agora conflito só de metadados na mesma revisão e substituição mais recente; mantém recuperação/ACK/cifra nas duas direções e confirmação com gate fechado.
- Builds Functions/web, TypeScript e lint: **zero erros/23 avisos anteriores**. A suite geral frontend e a suite completa de regras desta etapa não foram repetidas; os resultados anteriores conservam a sua cronologia, sem serem apresentados como novos resultados.

As provas são locais/sintéticas. Não demonstram Auth/App Check/RPC de produção, store nativo, instalações antigas ou pilotos. Evidência com hashes: `W:\real\mnemosyne-launch-evidence\mobile-sync-metadata-local-validation-20261004.json`. `releaseReady=false` e `allPhasesComplete=false`; nenhuma escrita de produção, chamada real a fornecedor ou deploy.

Retenção/expiração, compatibilidade/migração, grandes cofres e matriz de plataformas, Obsidian/escritores semânticos e demais fases permanecem no [estado completo](ESTADO_LANCAMENTO_COMPLETO.md).
