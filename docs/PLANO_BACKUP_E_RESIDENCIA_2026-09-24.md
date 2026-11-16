# Backup e residência dos dados — preparação do lançamento

**Atualização de 18 de outubro de 2026:** o responsável indicou `mnemosyne-one` para o ensaio. O export de 24 de setembro foi importado e validado na base temporária `mnemosyne-restore-20261018`, em `eur3`, no mesmo projeto. Duas verificações concordam em **359 documentos/13 grupos**, incluindo subcoleções; dez índices compostos ficaram `READY` e as regras do destino recusam todo o acesso SDK. A base temporária foi eliminada e a listagem final contém apenas `(default)`. [Procedimento, evidência e limites](ENSAIO_RESTAURO_FIRESTORE_2026-10-18.md).

O bucket privado e o export foram criados com autorização em 24 de setembro. O ensaio não importou em `(default)`, não mudou PITR, IAM ou configurações da aplicação e não migrou anexos. O isolamento é entre bases no mesmo projeto, com IAM/Auth partilhados. A recuperação integral do sistema continua pendente.

## Estado verificado

| Recurso | Estado observado | Consequência |
| --- | --- | --- |
| Firestore `mnemosyne-one/(default)` | `eur3`, modo Native; PITR e proteção contra eliminação desligados | Um export normal não fixa um instante anterior recuperável por PITR. |
| Bucket usado pelo cliente para anexos | `mnemosyne-one.firebasestorage.app`, `US-CENTRAL1` | Não se pode afirmar residência exclusivamente europeia para anexos existentes. |
| Bucket de backup | Criado em `EUROPE-WEST1`; Public Access Prevention `enforced`, Uniform Bucket-Level Access ativo e sem bindings públicos diretos; soft delete de sete dias | Destino privado do export; ainda falta decidir retenção e testar restauração. |
| Export Firestore | `SUCCESSFUL` em 24 de setembro, das 18:52:17 às 18:53:02 UTC; importado com 359 documentos em 18 de outubro e conferido por leitura recursiva/agregações | Recuperação dos documentos deste export ensaiada numa base separada. Não comprova desencriptação, alterações posteriores ou consistência de um instante. A listagem atual tem três ficheiros físicos; a contagem antiga de oito entradas fica conservada na evidência original. |

O nome do bucket de anexos está configurado em `frontend/src/firebase.ts` e `frontend/.env.template`. O texto público passou a distinguir a localização do Firestore da localização dos anexos. A localização de um bucket Firebase já provisionado não deve ser presumida alterável; qualquer mudança requer um plano de transferência, validação de referências e URLs e verificação das funcionalidades Firebase afetadas. Ver [localizações de Cloud Storage for Firebase](https://firebase.google.com/docs/storage/locations) e [opções de transferência de dados entre buckets](https://docs.cloud.google.com/storage/docs/moving-buckets).

## Decisões pendentes antes do ensaio de restauração e da migração

Atualização somente de leitura de 3 de outubro: o bucket de anexos voltou a ser verificado com binding ao projeto. O inventário paginado encontrou objetos vivos legados com metadata de tokens, sem CORS e com soft delete de sete dias; a localização permanece `US-CENTRAL1`. Não houve backup novo de bytes ou alteração de bucket. Evidência e limites de IAM/ACL: [POSTURA_STORAGE_E_ANEXOS_LEGADOS_2026-10-03.md](POSTURA_STORAGE_E_ANEXOS_LEGADOS_2026-10-03.md).

1. Definir retenção de longo prazo, acesso humano ao bucket e uma política operacional para novos exports. O bucket usa atualmente soft delete de sete dias; isto não substitui retenção deliberada.
2. Para um próximo export com consistência temporal verificável, aprovar uma janela sem escritas de clientes **e de Admin SDK/Functions**, ou ativar PITR e esperar por um `snapshot-time` válido. O export já concluído foi normal e pode incluir alterações ocorridas durante a operação. A janela sem escritas é uma medida operacional inferida dessa limitação, não uma garantia fornecida pelo comando.
3. O destino foi definido pelo responsável: base temporária separada dentro de `mnemosyne-one`, com a mesma edição/localização e regras fechadas antes do import. O ensaio dos documentos/índices passou e a eliminação foi confirmada; conservar a evidência. O IAM do projeto permanece partilhado. Um próximo ensaio deve usar outro ID/pasta e nunca `(default)`.
4. Decidir se o lançamento aceita anexos históricos nos EUA com divulgação explícita ou se a migração de Storage para a Europa é pré-requisito. Não prometer residência só na UE enquanto o bucket atual estiver em `US-CENTRAL1`.

## Sequência operacional de referência

O bucket e o primeiro export já foram executados com autorização. Os comandos seguintes ficam como modelos PowerShell para um **novo** export; não os voltar a correr sem escolher uma janela e um novo prefixo:

```powershell
$backupBucket = 'gs://mnemosyne-one-firestore-backup-euw1'
$exportPrefix = "$backupBucket/firestore/<prefixo-unico-datado>"
gcloud storage buckets describe $backupBucket --project=mnemosyne-one --format=json
gcloud firestore export $exportPrefix --database='(default)' --project=mnemosyne-one --async
```

No primeiro export, o nome da operação, URI, horário, contagem reportada e verificações do bucket foram registados em `W:\real\mnemosyne-backup-evidence\firestore-export-20260924T185215Z.json`, fora do repositório. A operação terminou sem erro e o manifesto geral está presente. O agente Firestore pode aceder por defeito a um bucket no mesmo projeto; se o projeto usar uma identidade legada ou o ensaio atravessar projetos, confirmar a identidade de import/export e conceder só o acesso necessário no bucket aprovado. Ver [export/import oficial](https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import).

Para repetir o ensaio, seguir o [executor revisto](ENSAIO_RESTAURO_FIRESTORE_2026-10-18.md): plano com hash, ID de base temporária explícito, regras fechadas, import, leitura recursiva, contagem independente e eliminação ligada ao UID da base criada. Não é necessário copiar o export para outro bucket ou conceder IAM para o destino escolhido no mesmo projeto. O export Firestore não cobre bytes do Firebase Storage, utilizadores Firebase Auth, configurações de índices nem chaves locais dos proprietários; preparar cópias e recuperação separadas quando necessárias.

```powershell
# Referência do destino usado; não repetir sobre uma base existente.
gcloud firestore import 'gs://mnemosyne-one-firestore-backup-euw1/firestore/export-20260924T185215Z' --database='mnemosyne-restore-20261018' --project=mnemosyne-one --async
```

O ensaio passou para o export de setembro. Antes de aplicar a migração cliente do texto/título histórico e o backfill de `teamId: null` de [MIGRACAO_ESCOPO_SESSOES.md](MIGRACAO_ESCOPO_SESSOES.md), obter uma cópia atual, decidir consistência/janela de escritas, executar os pilotos e satisfazer os restantes gates. O ensaio não autoriza sozinho um backfill. Uma cópia local gerada pela aplicação não substitui o backup operacional; a divulgação da localização dos anexos não resolve bytes em claro nem URLs antigos.

## Critério de saída

O restauro dos documentos deste export Firestore foi ensaiado. O lançamento continua dependente de backup atual/consistência e retenção, recuperação de Auth/Storage/chaves, plano para conteúdo legado e demais critérios das fases 0–6. Não está comprovada recuperação integral da aplicação nem um ponto exato no tempo. Para uma promessa de residência apenas europeia é necessária também migração verificada do Storage; a atualização do texto público por si só não a concretiza.
