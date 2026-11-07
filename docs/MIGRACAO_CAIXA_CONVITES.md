# Migração da caixa de convites — 2 de outubro de 2026

## Motivo e âmbito

A listagem por destinatário em `teamInvites` não consegue provar o estado da equipa nas regras. O cliente passou a listar ponteiros em `teamInviteInbox`, sem envelopes, e a pedir cada convite individualmente ao servidor. Convites anteriores à mudança podem não ter ponteiro. Este incremento fornece inventário e reconstrução verificáveis; não executa a migração em produção nem declara concluída a fase 3.

## Contrato de manutenção

`functions/src/teamInviteInboxMigration.ts` é uma API Admin privada, sem callable nem export no entrypoint de produção. Uma página recebe coleção (`teamInvites` ou `teamInviteInbox`), cursor, limite de 1–100, instante e modo de escrita explícito. As páginas ordenam pelo ID e devolvem cursor/exaustão; a retoma pode começar de novo porque criar e remover ponteiros é idempotente. Uma página exatamente cheia exige a leitura da página seguinte para provar o fim.

Cada linha é relida numa transação. A decisão observa:

- estado/validade temporal do convite, IDs e formato canónico do envelope RSA;
- conta/perfil e marcador permanente do destinatário, emissor e proprietário;
- presença do emissor entre membros e autoridade atual de owner/admin;
- equipa ativa, sem eliminação/rotação pendente, com capacidade e sem destinatário já admitido;
- época/identificador, documento da época e envelopes consistentes com os membros atuais;
- UID/emailHash do perfil público e fingerprint da chave usada para cifrar o convite;
- ponteiro existente, incluindo ausência de campos adicionais e correspondência exata com convite/UID/equipa.

A verificação Auth por UID ocorre antes da transação; identidades e marcadores Firestore são relidos depois. **Não é uma transação entre Auth e Firestore.** O piloto e o corte coordenado continuam obrigatórios. Falha Auth ou conta desativada bloqueia a admissão. Não se resolve um convite antigo pelo email atual nem se inventa o fingerprint de uma chave antiga.

| Classificação | Ação de aplicação | Condição para o corte |
|---|---|---|
| válido, sem ponteiro | criar apenas `{v,uid,inviteId,teamId}` | nova verificação confirma o ponteiro |
| válido, ponteiro correto | nenhuma | manter leitura individual sob ACL atual |
| aceite/revogado/expirado | retirar ponteiro correto | convite original permanece inalterado |
| ponteiro órfão correto | retirar | segunda passagem prova ausência |
| identidade/época sem prova | retirar ponteiro correto; classificar `reissue` | emitir novo convite com prova; resolver o antigo antes do corte |
| conta/equipa/autoridade indisponível | retirar ponteiro correto; classificar `unavailable` | revisão ou revogação autorizada, seguida de inventário |
| documento malformado ou ponteiro em conflito | conservar conflito e bloquear | reparação verificada de metadados |

O helper não altera status, nomes, envelopes, auditoria ou membros. Um legado pendente sem prova continua a impedir o corte mesmo sem ponteiro. Convites antigos precisam de reemissão pelo percurso do cliente, que possui a chave, e resolução/revogação autorizada ou expiração do convite anterior. Não há reemissão de envelopes no servidor.

## Revogação da leitura do envelope

A revisão encontrou que a exceção de leitura por destinatário deixava reler um convite aceite/revogado/expirado, de época antiga ou enviado por um admin entretanto sem autoridade. Corrigiu-se a regra para exigir convite pendente, prazo posterior ao tempo do servidor, época/identificador atuais, fingerprint com formato válido, emissor atualmente membro e owner/admin, contas ativas e equipa sem eliminação/rotação. Não se usa o relógio do cliente para a expiração da ACL.

Um membro atual conserva o percurso de leitura da equipa, com proprietário ativo e equipa sem eliminação. Depois de sair/perder membership, a exceção do convite aceite não restitui a leitura. Isto revoga leituras futuras do servidor; não apaga envelopes já descarregados. As regras não calculam SHA-256 do PEM: a comparação criptográfica da identidade permanece na migração e na aceitação transacional; o fingerprint das regras é apenas validação de formato. Não declarar que esta condição prova identidade por si só.

Os testes positivos antigos que construíam convites no instante sintético `1000` receberam prazo futuro explícito quando testam a ACL pelo relógio real do emulador. Os testes de expiração mantêm prazo já terminado; a regra não ganhou tolerância para aceitar datas expiradas.

## Operação

Compilar Functions antes de usar o script. O comando exige projeto explícito, rejeita flags repetidas/desconhecidas e é de leitura por omissão:

```powershell
node scripts/backfill-team-invite-inbox.js --project=<projeto-isolado>
node scripts/backfill-team-invite-inbox.js --project=<projeto-isolado> --require-complete
```

Depois de export recuperável e preflight sem casos por resolver:

```powershell
node scripts/backfill-team-invite-inbox.js --project=<projeto-isolado> --apply --expected=<alteracoes-do-inventario> --backup-uri=<gs://bucket/export>
```

`--backup-uri` regista o requisito operacional; o script não certifica que esse export foi restaurado. Aplicar exige inventário fresco com a contagem esperada e zero casos por resolver. Passa pelas duas coleções e volta a inventariar depois das escritas. `--require-complete` devolve falha se faltarem alterações ou existirem casos por resolver. Falhas parciais não autorizam o corte; repetir recompõe os ponteiros válidos e mantém os envelopes originais.

O output contém contagens agregadas, sem wraps, UIDs ou IDs de documentos. `scanned` e classificações contam visitas às duas coleções, podendo incluir duas visitas ao mesmo convite. `changesNeeded` conta as alterações da primeira passagem e os órfãos da segunda, evitando contar duas vezes a mesma remoção. O cursor é interno e não é emitido pelo CLI. As mensagens de erro não imprimem paths dos SDKs. Não existe relatório de diagnóstico por documento neste incremento; resolução individual exige uma sessão de operador controlada.

As passagens não constituem um snapshot global. É necessário manter escritores incompatíveis suspensos durante inventário/aplicação/corte e voltar a verificar depois de alterações de época/identidade/estado. A migração de épocas pode invalidar convites anteriores e exige reemissão; correr antes da verificação final desta caixa. Não restaurar ponteiros de backup sem voltar a validar a autoridade.

## Cliente e custos

`watchPendingInvites` limita a quatro leituras individuais em curso por watcher, inclusive entre snapshots. Uma fila anterior deixa de ser despachada quando chega um snapshot novo; respostas antigas não são apresentadas. Mudança de Auth, desmontagem e falhas de ACL conservam os guards existentes. A fila nova espera pelas leituras já despachadas em vez de exceder o limite.

Isto limita concorrência, não o número total de ponteiros/custos por conta, nem a soma entre dispositivos/watchers. Paginação da interface, quotas por destinatário/equipa, limpeza periódica de ponteiros e alertas de custos continuam nos critérios da fase 2.

## Evidência e critérios restantes

Os testes novos cobrem classificação sem fabricar bindings legados, épocas/envelopes inconsistentes, contexto inválido antes do acesso, paginação com 26 convites, repetição, leitura real do destinatário, ponteiros terminais/órfãos/conflituosos, conta revogada depois de Auth, conta Auth desativada, alteração de chave pública e falha transacional seguida de retoma. O cliente verifica o limite de quatro leituras em dois snapshots e a supressão da fila antiga.

O primeiro ensaio de emulador encontrou uma fixture que usava `FieldValue.delete()` em `set` sem merge. Corrigiu-se a construção da fixture; não se flexibilizou o contrato da migração. Essa execução terminou com 94 casos aprovados e uma falha, antes dos ajustes finais.

Validação final:

- **132 unitários Functions passaram**; o teste de rules fica marcado como skip nesse comando sem emulador.
- **96 Functions +22 frontend passaram na suite completa de emulador**, sem skips, saída zero e encerramento normal dos emuladores. Inclui o caso de referência tardia do incremento anterior.
- **Um caso focado posterior passou** com a asserção adicional da consulta real Admin por `teamId`, além da caixa do destinatário e da paginação. A suite completa anterior já cobria os restantes passos desse caso; a asserção Admin foi acrescentada depois de o processo ter carregado os testes.
- **14 testes frontend focados passaram**, incluindo concorrência entre snapshots; lint dos dois ficheiros sem erros/avisos.
- Build Functions e web com saída zero; o build web mantém o aviso conhecido de chunks acima de 1000 kB. A suite geral frontend de 495 testes pertence ao incremento anterior, não foi repetida aqui.
- CLI: sintaxe, ajuda, falta dos argumentos de aplicação e projeto duplicado verificados. Os dois contextos inválidos saíram com código 2 antes de inicializar os SDKs. Não foi executado o CLI com credenciais reais.

Logs locais em `%TEMP%`: `mnemosyne-inbox-migration-unit-final.log`, `mnemosyne-inbox-migration-rules-final.log`, `mnemosyne-inbox-migration-query.log`, `mnemosyne-inbox-migration-frontend.log`, `mnemosyne-inbox-migration-lint.log`, `mnemosyne-inbox-migration-build.log`; a falha de fixture permanece em `mnemosyne-inbox-migration-rules.log`. Auth é injetado nos testes de migração; Firestore/Storage e as regras usam apenas `demo-mnemosyne-rules`.

Permanecem: inventário real, tratamento dos casos por resolver, reemissão no cliente quando necessária, piloto Auth/Firestore, migração de épocas e corte coordenado; todas as restantes áreas em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md). Gates de escrita continuam fechados. Nenhuma chamada real Auth ou escrita de produção foi feita por este incremento.
