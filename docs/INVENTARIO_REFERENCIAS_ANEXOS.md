# Inventário de referências de anexos — 2 de outubro de 2026

## Problema e decisão

O purge canónico procura o descritor exato por `array-contains`. Uma consulta vazia não deteta um descritor para o mesmo objeto com nome/campos alterados, URLs antigas, uma versão fora do namespace suportado ou referências noutras coleções. O marcador `referenceSchemaVersion:1` de um registry não transforma esses casos em prova de ausência.

Foi implementado um inventário Admin de leitura das coleções conhecidas: `sessions`, collection group `versions`, collection group `memories` e `attachmentUploads`. `functions/src/attachmentReferenceInventory.ts` não é exportado pelo entrypoint de produção nem é callable. `scripts/audit-attachment-references.js` exige projeto explícito e não possui modo de aplicação. Não foi executado com credenciais de produção neste incremento.

Não se faz backfill de ownership com base numa URL, nem se acrescenta `referenceSchemaVersion` a registos antigos depois de uma consulta exata vazia. O inventário identifica os casos a resolver; a reparação tem de observar o conteúdo/binding real, o cliente que possui as chaves e os escritores ainda ativos.

## Leituras e paginação

Cada página tem 1–100 documentos e cursor por caminho de documento. Collection groups incluem documentos fora do namespace esperado: esses casos são contados e bloqueiam a verificação, não são ignorados. Uma página exatamente cheia requer a leitura seguinte para provar o fim. A retoma pode voltar a percorrer as coleções: não há escritas, recibos ou marcadores de migração.

As queries das memórias/versões projetam apenas `uid`, `teamId`, `keyEpoch`, `keyId` e `attachments`. A projeção não lê `text`, `title`, `enc`, prompts ou pesquisa web. Lookups de pais usam a mesma metadata sem a lista de anexos. Os registries têm projeção do protocolo de upload: inclui header/envelope de chave cifrada, digest, caminhos de objetos, estados de quota/purge e gerações; são dados sensíveis transitórios, sem export de valores. Nunca se lê o corpo dos objetos Storage ou a chave em claro.

Listas até 200 entradas são verificadas integralmente, com lookup dos IDs únicos por `getAll` e field mask. Uma lista maior é contada como `oversizedList` e bloqueia; não se trunca para depois apresentar um resultado limpo. Este limite é do operador e não aumenta o limite das mutações do produto. Listas malformadas, entradas sem URL ou URLs demasiado grandes também bloqueiam. URLs não são visitadas.

Lookups de registry usam o mesmo parser do protocolo de upload para validar header, digest, UID, ID, paths, bytes, estado e campos de purge. Comparam os campos exatos do descritor, scope da memória/pai, existência do uploader/marcador e existência de equipa/época com keyId correspondente. Uma referência de ficheiro de época histórica pode ser válida numa memória já recifrada para uma época posterior; não se exige que a época da memória seja igual à época imutável do ficheiro.

Erros de leitura/permissão abortam o inventário. Não são convertidos em registos malformados nem em ausência de referências. O CLI imprime uma mensagem fixa e não apresenta o scan parcial como uma verificação concluída.

## Interpretação dos resultados

| Categoria | Significado / passo necessário |
|---|---|
| namespace ou IDs inesperados | Rever documentos que os workers não conseguem tratar; conservar dados até existir migração |
| `legacyMemoryNamespace` / `legacyOwnerMismatch` | Memórias aninhadas antigas e UID diferente do caminho; não inferir ownership pelo caminho ou pelo campo isolado |
| `orphanVersion` / `historyAuthorMismatch` | Falta do pai ou UID histórico incoerente; exige revisão e política para metadata histórica |
| referências inline/remotas/tokenizadas | Percurso legado; exige migração no cliente e verificação da revogação/retention real |
| `descriptorMismatch` / `duplicateObject` | A consulta canónica não cobre todo o estado ou há duplicação; reparar sem perder metadata/chaves |
| registry ausente/inválido ou objeto não pronto/em purge | Referência não pode ser tratada como objeto vivo utilizável; resolver o protocolo correspondente |
| `missingReferenceSchema` | Registry sem prova do schema de referências; não promover por uma query exata vazia |
| scope/autor/equipa/época incoerentes | Binding não provado; rever sem trocar UID/AAD nem apagar conteúdo de outro autor |
| uploader ausente/em eliminação | Completar/rever o percurso de eliminação e referências remanescentes |

`scanned` conta documentos por fonte. `references` conta entradas das listas, incluindo listas maiores que o limite. `canonicalReferences` conta correspondências sintáticas exatas com o descritor do registry: **não significa referência utilizável ou autorizada**; outros flags podem bloquear o mesmo documento. Cada reason conta os documentos afetados naquela fonte, uma vez por reason. `affectedDocuments` conta documentos com pelo menos um problema; a soma de fontes pode incluir registry, memória e versões do mesmo objeto. Não são contagens de objetos/utilizadores únicos.

Os estados de uploads são apenas metadata observada. Não comprovam que os objetos existam/estejam ausentes em GCS nem validam quota agregada. Um upload pronto sem referências pode ser legítimo enquanto aguarda associação; este inventário não o elimina nem o classifica automaticamente como órfão físico.

O helper devolve o cursor privado ao chamador; o CLI não imprime cursores, UIDs, nomes, IDs de objetos, paths, URLs, tokens, digests ou conteúdo. Para localizar casos individuais é necessária uma sessão de operador controlada; o output agregado não é um relatório de reparação por documento.

## Operação

Compilar Functions e escolher o projeto isolado explicitamente:

```powershell
node scripts/audit-attachment-references.js --project=<projeto-isolado>
node scripts/audit-attachment-references.js --project=<projeto-isolado> --page-size=25 --require-clean
```

`--require-clean` sai com código 1 se houver documentos afetados; não é um gate de lançamento completo. Flags de aplicação, projeto repetido ou tamanho de página inválido são recusados antes de inicializar os SDKs. O CLI é só de leitura, mas uma execução real tem custos de Firestore: varredura das quatro fontes e lookups adicionais de registry/conta/equipa/época por objeto/documento. Preparar contagem/custo e janela operacional antes da execução real.

Não existe snapshot global entre páginas, coleções, Auth ou GCS. O inventário de schema só pode sustentar um corte com escritores incompatíveis suspensos, execução esgotada de todas as fontes e nova verificação após a reparação. O perfil/marker Firestore não substitui verificação Auth real. A API não escreve flags de schema ou de autorização.

## Migração e rollback

1. Inventariar as fontes conhecidas e conservar export recuperável antes de reparações.
2. Classificar as exceções numa sessão privada; escolher migração no cliente para conteúdo/chaves e reparação metadata apenas quando o binding está provado.
3. Não trocar UID/scope de um header: o AAD inclui essas identidades. Conservar bytes numa equipa após eliminar o uploader exige o protocolo de transferência/recifragem, não alteração de campos.
4. Resolver versões órfãs, referências não canónicas e escritores legados; voltar a inventariar com esses escritores suspensos.
5. Só depois verificar as restantes condições de quota, GCS/retention, dispositivos e rollout. Um scan sem flags não prova essas condições.

O inventário não tem alterações a reverter. Rollback de uma migração posterior deve conservar marcadores de eliminação/revogação e repetir os checks de autoridade; restaurar referências cegamente de um export pode reintroduzir acesso ou dados eliminados.

## Evidência e limites

Os testes novos verificam classificação sem URLs/conteúdo no resultado, listas maiores que o limite, scope pessoal versus autoria de equipa, cursor inválido antes de acesso, 26 memórias e 26 versões paginadas, projeção real sem texto/cifra, preservação dos documentos, descritor alterado invisível à query exata, URLs legadas, duplicados, registry inválido/ausente, referências a objetos reservados/em purge, falta de schema, versões órfãs/namespaces inesperados, UIDs incoerentes, IDs incompatíveis, épocas e uploader ausentes e falha de leitura que aborta.

Validação final:

- **136 unitários Functions passaram**, build TypeScript incluído; o caso de rules fica em skip fora do emulador.
- **99 Functions +22 frontend passaram na suite completa de emulador**, sem skips, saída zero. Inclui todos os casos novos deste inventário e a asserção Admin de convites acrescentada no incremento anterior. Processos terminaram e emuladores encerraram normalmente.
- A primeira execução encontrou falta de `status:active` no documento de época da fixture da equipa. Corrigiu-se a fixture; a admissão real do upload manteve a condição da época ativa. A execução final também incluiu os novos checks de IDs e UID histórico/aninhado.
- CLI: sintaxe/ajuda e recusa de `--apply`, projeto repetido e page size zero/vazio/acima de 100 verificadas. Contextos inválidos saíram com código 2 antes de inicializar SDKs. Não houve execução real Auth/Firestore/GCS neste incremento.
- Não houve alterações frontend: builds/testes gerais/lint frontend anteriores conservam a cronologia própria; não se declara uma repetição desses comandos aqui. A suite de regras frontend foi efetivamente repetida no comando completo.

Logs locais em `%TEMP%`: `mnemosyne-attachment-inventory-unit-final.log` e `mnemosyne-attachment-inventory-rules-final.log`; a falha inicial fica em `mnemosyne-attachment-inventory-rules.log`. Node 22.23.3, JBR 21.0.6, projeto `demo-mnemosyne-rules`. Storage dos protocolos das fixtures é sintético; o inventário novo não acede a Storage.

Limites restantes: referências em campos/coleções desconhecidos ou dentro de conteúdo cifrado não são cobertas pela projeção; objetos Storage sem registry exigem inventário GCS separado; quota/soft delete/versões/backups e Auth reais exigem piloto. A metadata de editor/uploader/recibos/tombstones também precisa da política de retenção da área. Não se declara o inventário real, a migração ou a fase 4 concluídos. Estado global: [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).
