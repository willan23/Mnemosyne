# Ligações recíprocas de equipa com recuperação

Implementação local de 14 de outubro de 2026. O gate de equipa continua fechado. Este contrato substitui o percurso SDK dos callers atuais; a compatibilidade das regras antigas ainda não equivale a cutover global. O estado completo das fases 0–6 está em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

## Intenção revista

O painel do detalhe/sidebar apresenta apenas pares de memórias legíveis da mesma equipa. Antes da confirmação, compara digest integral, texto, título guardado e autoria das duas memórias com a versão decifrada e captura as suas versões Firestore numa única transação de leitura. A mesma base inclui versão da equipa/época, owner, época/ID ativos e contextos criptográficos anteriores.

A confirmação identifica o par e a operação. A submissão revalida a base; não adota uma leitura posterior. Alteração seguida de reposição de qualquer memória/equipa/época continua a ser recusada. Conta/cofre, geração de chaves, seleção e digests da vista são guardados durante os awaits. A geração é verificada diretamente antes de feedback, inclusive antes de o React renderizar um evento de mudança. Não há atualização otimista do grafo.

## Pedido e cifra

`teamConnectionRecovery` conserva um diário AES-GCM do cofre pessoal em `mnemosyne:team-connection:v1:<uid>`. Contém UUID estável, link/unlink, duas bases ordenadas, duas cifras anteriores exatas e duas novas cifras v2, ou duas entradas `null` quando o par já está no estado pedido. Não contém mnemónica/chave nem plaintext de memória fora das cifras. Valida o diário por decifragem e readback; Web Locks e comparação exata dos bytes recusam substituição, quota insuficiente e outra operação no mesmo UID.

O cliente decifra ambas as memórias sob a época anterior e cifra o mesmo texto/título sob a época ativa, com AAD de equipa/época/ID. Não faz inferência, acrescenta metadados arbitrários nem muda outros vizinhos. Retoma usa os mesmos UUID/cifras e não recifra. Texto/título/embeddings/metadados não são enviados a um fornecedor de IA por este percurso.

## Comandos e atomicidade

| Callable EU | Comportamento |
| --- | --- |
| `prepareTeamConnection` | Captura duas bases e a mesma autoridade numa transação de leitura |
| `applyTeamConnection` | Deriva a alteração de um único par e aplica todas as escritas atomicamente |
| `getTeamConnectionStatus` | Confirma apenas o pedido ligado a ator/UUID/digest/par |
| `cancelTeamConnection` | Cancela pedido desconhecido ou confirma o resultado já terminal |

Todos recebem `{actorUid, request}` e comparam o ator capturado com o token antes de limites ou acesso à base. Membro atual pode ligar/desligar o par; não recebe direito de mudar autor, timestamp ou outro âmbito. Contas/marcadores do ator, dos dois autores, owner e equipa são relidos. Admissão exige gate operacional, rotação concluída, época/wrap ativos, versões integrais e cifras antigas correspondentes. O servidor volta a verificar os limites de época ao aplicar; não confia numa preparação fornecida pelo cliente. A guarda partilhada foi alargada às revisões genéricas e aprendidas.

A transação cria duas versões determinísticas `team-connection-<UUID>`, dois pais recíprocos, recibo privado `teamConnectionChanges`, evento sem conteúdo `teamConnectionEvents` e contadores. Preserva autor/timestamp, cifras/contextos anteriores, anexos, aprendizagem/proveniência, todos os outros vizinhos e campos do pai que não altera. Campos legados de nós/ligações/prompts em claro são recusados para migração explícita; não são limpos implicitamente.

Uma reparação de ligação de apenas um lado continua explícita e cria ambos os arquivos. `unlink` retira apenas o peer escolhido. O servidor deriva as listas e não aceita um patch arbitrário do grafo. Não pode provar igualdade de plaintext entre cifras; a implementação do cliente preserva-o, e o membro já possui o direito de edição de conteúdo da equipa.

Quando o par já está no estado pedido, cria recibo/evento e debita uma operação, sem recifrar, criar versões ou alterar os pais. O resultado `changed:false` deve corresponder às cifras novas `null`; resultado terminal incompatível conserva o diário. Replays não debitam novamente.

## Orçamentos, recuperação e purga

Ligações partilham `memoryEditBudgets` e `memoryEditTeamBudgets` com os editores: 200 operações/20 MiB de cifras por UID/equipa/dia e 1.000 operações/100 MiB por equipa/dia. Uma ligação conta como uma operação; contabiliza as duas cifras anteriores e, quando existem, as duas novas. No-op conta como uma operação e o transporte das cifras anteriores. Até 100 vizinhos por memória, IDs até 128 caracteres pelo contrato partilhado e pedido até 4.100.000 bytes. Limites de transporte/armazenamento local podem recusar pedidos grandes antes de qualquer admissão. Rate limit: 60 admissões ou 120 outras chamadas por minuto/UID. Quotas/custos globais continuam na fase 2.

Recibo terminal próprio pode ser recuperado após remoção/rotação. Consulta/cancelamento de um pedido desconhecido verificam pertença/owner/marcadores, sem exigir a chave ativa durante uma rotação pendente. Isso não permite admitir uma ligação. Revogação definitiva sem recibo devolve `revoked` só de leitura; encerra apenas o pedido próprio após confirmação. Conta do ator eliminada continua recusada. Cancelar não desfaz um par já admitido.

O painel global funciona sem a seleção original. Falha, corrupção, outro UID/cofre, digest/par/resultado incompatível ou mudança de bytes conserva o pedido. Os conjuntos privados recusam SDK read/list/write. Purga de equipa inclui os novos recibos/eventos e contadores partilhados. Purga de conta inclui ator, owner e ambos os autores por `authorUids`; limpeza local usa a chave exata do UID e conserva outras contas.

## Validação e rollout

Evidências: `W:/real/mnemosyne-launch-evidence/team-connections-validation-20261014/`. Testes de servidor, cliente e UI incluem atomicidade/arquivo, concorrência, no-op/replays, ABA, direitos/markers, actor-token, cifragem/AAD, contexto tardio, recuperação/cancelamento e purgas. O emulador usa `demo-mnemosyne-rules` com JDK 21 e portas privadas. Chromium usa painéis/factory, AES, localStorage/Web Locks e executor reais, Auth/acesso às chaves/base sintéticos; não equivale a um piloto Firebase/dispositivo real.

`teamConnectionsLegacy` conserva exclusivamente o algoritmo SDK para os testes de compatibilidade das regras antigas; o wrapper e os callers da app usam o novo serviço. Esses testes positivos serão substituídos por recusas SDK e admissões de servidor quando houver cutover compatível da manutenção/migração. Servidor/leitores de recuperação devem existir antes do cliente; rollback conserva diários e status/cancelamento de pedidos admitidos.

Continuam pendentes: backfill semântico ainda ativo por SDK, migração pessoal/conflitos/manutenção histórica, encerramento compatível das regras antigas, gráficos/referências de objetos apagados e pilotos. Cloud/segredos/alertas/restauração, qualidade multilingue, agentes/acessibilidade e gates de lançamento continuam obrigatórios. Nenhum deploy ou mutação de produção ocorreu neste incremento.
