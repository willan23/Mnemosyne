# Propostas de alteração dos agentes — implementação local, 21 de outubro de 2026

Ainda não publicado. Este incremento implementa edição e eliminação lógica de **uma memória existente** por proposta. A [reversão pelo titular](AGENT_MUTATION_REVERSAL.md) foi implementada e validada localmente no incremento de 22 de outubro. O gateway de agentes e a fase 6 não são declarados concluídos. A criação direta por agentes foi retirada.

## Problema e ameaça

Um agente pode recuperar conteúdo hostil, repetir pedidos, trocar o alvo ou perder uma resposta. Nenhum conteúdo recuperado pode autorizar ferramentas ou alterar permissões. Uma credencial de leitura antiga também não pode ganhar autoridade de escrita quando se muda uma flag. A conta, cofre, equipa, época, sessão e memória podem mudar entre proposta, revisão e confirmação.

## Decisão e alternativas

- O scope OAuth explícito `memories:write` permite **propor**, sem aprovar. Exige aplicação registada, PKCE, consentimento do titular e um cofre exato. Chaves permanentes continuam sem scope de escrita.
- Códigos `mne_review_code_` e tokens `mne_review_` distinguem esta autoridade de credenciais antigas. Não podem criar sessões delegadas. A duração máxima continua 15 minutos, sem refresh token.
- A API/MCP recebe ciphertext, baseline e patch de metadata estritamente validado. Nunca recebe texto/título em claro nem interpreta o conteúdo como instruções. Cada UUID v4 identifica um payload imutável por digest; reutilização incompatível é recusada.
- O cliente decifra a fonte atual e o envelope proposto com as chaves do cofre. Mostra os dois conteúdos e metadata. A confirmação exige clique explícito e nova verificação do baseline, dos envelopes e do digest. Não se confia numa descrição de diff produzida pelo agente.
- O servidor revalida a autoridade original e o estado corrente na mesma transação que altera a memória, conserva a versão anterior cifrada e grava os recibos/auditoria. Uma falha da verificação final aborta todos esses efeitos.
- Foram recusadas aprovação pelo agente, escrita direta com chaves permanentes e confirmação automática depois de recarregar a página. A confirmação não prova por si só que a pessoa leu toda a proposta; a interface apresenta o conteúdo completo e exige uma ação explícita.

## Contrato e limites

REST POST: `/api/v1/agent/changes/prepare`, `/propose`, `/status`. MCP: `prepare_memory_change`, `propose_memory_change`, `get_memory_change`. Não existem ferramentas de aprovação/aplicação. O SDK oferece preparação, submissão e consulta; `createMemory` falha localmente sem pedido de rede. O endpoint legado de criação e `create_memory` continuam sempre bloqueados, independentemente do gate de propostas.

`prepare` recebe `{sessionId,teamId}`. `propose` recebe o `MemoryEditRequest` estrito de `agentMutationContract.ts`: UUID, edit/delete, baseline, priorEnc, enc e metadata. Uma eliminação exige `enc:null` e patch vazio. Não há arrays de alterações nem escolha de cofre em argumentos. A preparação recusa fontes legadas sem envelope cifrado; não envia plaintext para migrar uma memória.

Limites de admissão: 640 KiB por pedido; dez propostas pendentes por titular; 50 propostas e 20 MiB por UID/dia; 500 propostas e 100 MiB por equipa/dia. Repetir exatamente um pedido admitido não consome nova quota. A expiração acompanha a sessão original, sem prolongamento pela revisão. A aplicação conserva os limites transacionais do protocolo normal MemoryEdit.

O titular usa callables autenticados `getAgentMutationProposal`, `listAgentMutationProposals`, `rejectAgentMutationProposal`, `approveAgentMutationProposal`, com `expectedUid` vinculado ao Auth antes de rate limit/dados. Aprovar/rejeitar exige `{expectedUid,proposalId,reviewDigest,confirmed:true}`; não aceita um payload substituto.

Recibos: pending/applied/rejected/expired. A consulta do agente exige a sessão original válida e o digest exato; o titular conserva o histórico depois de expirar a sessão. Consultar/rejeitar continua disponível com admissão fechada e cofre bloqueado. Decifrar/confirmar exige cofre desbloqueado. Um evento de conta/cofre/chave retira a revisão, incluindo ABA. Uma resposta perdida exige atualização dos recibos; nunca há nova aprovação automática.

## Schema, retenção e regras

- `agentMutationReceipts/{UUID}`: autoridade e recibo; depois da aplicação inclui versão arquivada e digest do estado resultante. Contém metadata de operação, sem texto/título.
- `agentMutationProposals/{UUID}`: payload cifrado imutável. É apagado na decisão ou ao observar a expiração. `deleteAfter` permite limpeza TTL após expiração + um dia; TTL não é pontual e precisa de ativação/deploy confirmado.
- `agentMutationBudgets`, `agentMutationTeamBudgets`: contadores de admissão por dia. Não são apagados na decisão para impedir recuperação indevida de quota.
- O agregado da equipa não guarda UID/ownerUid. Mantém-se durante a vida da equipa, para uma troca/eliminação de proprietário não repor a quota; a limpeza da equipa elimina-o por teamId.
- Todos os acessos diretos de clientes a estas quatro coleções são recusados pelas regras. As callables/Admin SDK fazem a autorização transacional.
- Índices novos do recibo: uid/status e uid/createdAt descendente. request/authority/receipt não são indexados; deleteAfter tem TTL. A prontidão em produção não foi verificada.
- A eliminação de conta remove dados por uid e referências a autor/owner; a eliminação de equipa remove propostas, recibos e orçamento da equipa. Os eventos são filhos privados da conta e entram na limpeza dessa árvore.

## Migração e rollout ainda não executados

Sem backfill obrigatório: as coleções são novas. Antes de abrir os gates, publicar e confirmar índices/TTL/regras, Functions/callables e só depois Hosting/SDK/opt-in de registos de aplicações. Validar os pilotos de escrita pessoal/equipa e todos os requisitos globais do lançamento. `API_MEMORY_WRITES_ENABLED=false` fecha admissão/aprovação; `AGENT_MUTATION_WRITES_ENABLED=false` fecha a confirmação no cliente. A aprovação exige também o gate do writer pessoal/equipa e a configuração de equipa aplicável.

## Rollback e risco residual

Fechar os gates de propostas conserva consulta/rejeição e recibos terminais. Parar agentes incrementa a época e retira autoridade anterior; retomar não ressuscita sessões. Não fazer rollback para uma versão que aceite escrita direta ou ignore UID, digest, sessão ou âmbito. As credenciais novas têm prefixos distintos para recusa por parsers antigos; o ensaio de compatibilidade não certifica automaticamente qualquer revisão publicada.

O servidor não consegue verificar a qualidade semântica do conteúdo cifrado. O titular precisa rever a proposta. As operações são serializadas pelo estado exato: uma alteração de memória/equipa obriga a nova proposta, podendo reduzir conveniência. Expiração observada e TTL não substituem uma política global de retenção/auditoria. Alterações de produção, CI remota e clientes reais continuam fora da prova deste incremento. A reversão tem uma prova local posterior, ligada no início deste documento.

## Validação

Os testes focados cobrem separação leitura/proposta, gates, UID antes de dados, payloads inválidos, quotas, concorrência, recusa por regras, memória imutável até confirmar, aprovação atómica, falha do finalizador, expiração, revogação, perda de ACK, paginação do histórico e decifragem real pessoal/equipa. Os resultados finais e hashes são registados na prova local do incremento; provas anteriores conservam os seus resultados históricos.
