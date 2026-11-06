# Referências de anexos e eliminação de membros — inventário de 2 de outubro de 2026

## Constatação inicial, antes deste incremento

`purgeAccountAttachmentUploads` enumera `attachmentUploads` pelo UID do uploader e pede purge com motivo `account`, incluindo uploads de equipa de outro proprietário. `requestReadyAttachmentPurge` só exige ausência de referências no motivo `unreferenced`; o motivo `account` pode eliminar um objeto ainda referenciado. O helper não remove os descritores das memórias/versões de outros autores.

`authorizeEncryptedAttachmentRead` observa tanto a conta do autor da memória como a do uploader. Assim que o uploader entra em eliminação, esses ficheiros deixam de poder ser lidos, mesmo numa memória escrita por outro membro que continua ativo. Depois do purge, o descritor pode continuar a ser mostrado embora já não haja registo/objeto utilizável. Esta é uma pendência concreta de produto e integridade; não se resolve abrindo o gate.

## Propriedade e binding comprovados

| Dado | Prova atual | Consequência |
|---|---|---|
| UID do uploader | `header.uid`, igual a `record.uid` | Identifica os bytes sujeitos ao pedido de eliminação da conta |
| Equipa/época | `header.scope` e autorização da sessão/época | O proprietário da equipa não é automaticamente o uploader |
| Chave do ficheiro | AAD de `attachmentKeyBinding` inclui ID, UID e scope | Alterar só `record.uid` ou `header.uid` não transfere a cifra; invalida o binding |
| Conteúdo da memória | `sessions/{id}.uid` e `enc` | A conta do uploader não autoriza apagar a memória de outro autor |
| Referência atual | Descritor canónico de `attachmentDescriptor` em `sessions.attachments` | Pode ser encontrada por `array-contains` sem receber o texto cifrado em claro |
| Referência histórica | Mesmo descritor em `sessions/{id}/versions/{version}` | Remover a referência atual não resolve histórico, versões órfãs ou cópias offline |
| Admissão de novas referências | `liveAccountInTransaction` para uploaders nas associações/criações e touch do registry | Fecha novas adições pelo protocolo; não comprova migração de todos os escritores legados |
| Arquivo de versões pelo cliente | Regras comparam a metadata arquivada com o estado exato anterior | Uma limpeza interna deve atualizar a revisão e ser testada contra arquivos concorrentes |

Fontes inspecionadas: `functions/src/attachmentUploads.ts`, `attachmentEnvelope.ts`, `attachmentMutations.ts`, `encryptedAttachmentAccess.ts`, `accountDeletion.ts` e `firestore.rules`. Não houve scan de dados de produção neste inventário.

## Requisitos derivados do inventário

1. Tornar explícita a consequência de eliminar os ficheiros do uploader que estejam usados por outros membros, preservando as memórias/cifras dos outros autores. A UI atual de equipa explica a eliminação de toda a equipa; o percurso da conta precisa de explicar as suas próprias consequências.
2. Implementar higiene recuperável das referências canónicas atuais e históricas antes de remover o registry, ligada ao marcador permanente da conta e ao pedido de purge. Remover só o descritor do objeto comprovadamente pertencente ao uploader; conservar restantes anexos, `uid`, `enc`, scope e informação de época da memória de outro autor.
3. Incrementar a revisão da sessão sem fabricar uma versão que reintroduza a referência eliminada. Comprovar por transações/regras reais que edições e arquivos antigos falham ou se repetem sobre o estado atualizado. Recifragem de histórico também deve conservar a remoção.
4. Verificar esgotamento de consultas paginadas. Documento/versão fora do namespace esperado, descritor não canónico ou registry sem `referenceSchemaVersion` requer inventário/migração; não é prova de ausência.
5. Testar outro membro ativo que escreveu a memória, histórico, ficheiros pessoais preservados, várias equipas, falhas a meio, mudança de conta, arquivos concorrentes e repetição depois de remover o pai/registry. O resultado deve distinguir bytes ativos, referências removidas e retenção administrativa.
6. Se o produto permitir conservar ficheiros na equipa após eliminar o uploader, isso requer um protocolo de transferência/recifragem aprovado pelo cliente e quota/retenção próprias. Uma troca de campos no servidor não é uma implementação válida desse percurso.

Os requisitos acima mantêm o âmbito da área. O incremento descrito abaixo implementa o percurso canónico; transferência, migração e critérios externos continuam pendentes. A autorização de deploy mantém a condição de concluir todas as áreas e os pilotos correspondentes.

## Implementação do percurso canónico

`functions/src/attachmentReferencePurge.ts` remove referências canónicas do uploader em sessões e versões antes de o worker/scheduler remover o objeto. Exige perfil `deleting`, marcador v1 da conta com `status:deleting/phase:objects`, registry ligado ao mesmo UID/ID/digest/scope, motivo `account` e `referenceSchemaVersion:1`. Não transfere a chave nem troca UID/scope do objeto.

As consultas usam páginas de 50, até 20 páginas por coleção e por execução, e verificam esgotamento. Atingir o limite conserva pendência; versões sem pai, namespace inesperado, scope incoerente e descritor duplicado malformado conservam bytes/registry/quota e exigem revisão. Uma query do descritor exato não deteta todos os dados legados: a verificação/migração de `referenceSchemaVersion` é um requisito do rollout.

Cada remoção relê o pedido, registry e documento numa transação. Memórias de outros autores conservam `uid`, `enc`, equipa/época, restantes anexos e metadata; a revisão `updatedAt` avança. Versões históricas conservam cifra, autor/editor e datas, alterando só a lista de anexos. Não se cria um arquivo com o descritor que acabou de ser removido. `MemorySecretFields` contém texto/título; a lista de anexos deste protocolo está fora do envelope cifrado.

O scheduler usa o mesmo helper de limpeza antes de aceder a Storage. O commit final de quota verifica novamente ausência de referências atuais/históricas. Uma referência tardia conserva o pedido e a quota para repetir; a repetição elimina a referência e liberta quota uma única vez. Registos que já estavam `deleted` com motivo `account` também passam pela higiene antes de remover o registry.

A confirmação da conta em `SettingsModal` explica que ficheiros enviados para equipas de outros donos são retirados das memórias/histórico que os usam, preservando o restante conteúdo desses membros. Não afirma expiração imediata de backups ou cópias descarregadas.

### Evidência local

- Node **22.23.3**, JBR **21.0.6**, projeto de emulador **`demo-mnemosyne-rules`**; sem operações de produção ou Auth/GCS/billing reais.
- Functions finais: **129 unitários passaram**, suite de regras ignorada fora do emulador, build TypeScript incluído.
- Suite completa: **91 Functions +22 frontend passaram**, saída zero. Inclui remoção de **60 referências atuais e 60 históricas**, preservação da cifra/ficheiro de outro autor, recusa de arquivo antigo e aceitação de arquivo fresco por regras reais.
- Caso adicional, escrito depois da suite completa: **um teste focado passou** para referência tardia durante remoção de objeto e quota única após recuperação. Não se apresenta uma execução conjunta de 92 testes.
- Falhas de metadata, scope errado, versão órfã e schema legado conservaram bytes e quota. Recuperação voltou a concluir após corrigir a fixture.
- Build web passou. Lint de `SettingsModal`: **zero erros, um aviso preexistente** de `closeConfirm` no efeito não alterado. Não se ignorou a regra. A suite geral frontend de 495 testes pertence ao incremento anterior; não foi repetida para a alteração textual deste bloco.
- Logs: `%TEMP%/mnemosyne-attachment-reference-{unit-final,rules,late,build,lint}.log`. Emuladores e processos terminaram normalmente.

### Pendências desta área

Permanecem o inventário/migração de referências não canónicas e órfãs, todos os escritores legados, retenção de metadados de editor/uploader e tombstones, casos em vários dispositivos/cópias offline e piloto real de Storage/retention/restauração. Conservar bytes na equipa depois de apagar o uploader requer protocolo de transferência/recifragem e política própria; esse percurso não foi implementado. O gate permanece fechado até concluir os critérios da área e das fases 0–6.

## Incremento posterior de inventário

Foi acrescentado inventário Admin de leitura paginada de `sessions`, collection groups `versions`/`memories` e `attachmentUploads`, com projeção que omite texto/título/cifra das memórias. Deteta descritores alterados que a query exata não encontra, namespaces/IDs inesperados, UIDs incoerentes, versões órfãs, URLs legadas, registries e épocas inválidos/ausentes. Não altera flags de schema, ownership, referências ou objetos. O inventário real e a reparação continuam pendentes. Contrato, interpretação, custos e evidência: [INVENTARIO_REFERENCIAS_ANEXOS.md](INVENTARIO_REFERENCIAS_ANEXOS.md).

Atualização de 3 de outubro: os inventários reais somente de leitura de Firestore/GCS e a reconciliação já foram executados. As referências Storage reconhecidas encontram objetos, mas permanecem objetos sem referência observada, contexto histórico de autor ambíguo, conteúdo/escopo legado e tokens persistentes. Não se aplicou reparação/migração nem se autorizou apagar candidatos. O relato de inventário real pendente acima é histórico. Evidência e correção de liveness da leitura legada: [RECONCILIACAO_ANEXOS_LEGADOS.md](RECONCILIACAO_ANEXOS_LEGADOS.md).
