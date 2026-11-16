# Reversão de alterações dos agentes — 22 de outubro de 2026

Implementação e validação locais. Não publicada; os 49 gates de lançamento continuam fechados. Este protocolo completa a reversão de propostas edit/delete de uma memória existente, associadas à conta que confirmou a alteração. Não disponibiliza uma ferramenta de reversão ao agente nem declara o lançamento completo concluído.

## Continuação: piloto Chromium de 22/10/2026

O executor `node scripts/agent-reversal-browser.cjs` passou sete cenários com o serviço de recuperação, o painel e a cifra reais: revisão/confirmação manual com conteúdo inerte; reload de pedido desconhecido sem apply automático; ACK perdido recuperado apenas por status com writers fechados; exclusão por Web Locks entre dois separadores; ABA de storage com os dois eventos nativos observados; recifragem de equipa da época antiga para a ativa e recusa da chave antiga; mudança de cofre que retira a revisão decifrada.

O journal usa localStorage real e sobrevive ao reload. As primitivas Web Crypto e Web Locks são as do Chromium. A interface só confirma por clique explícito. Auth, documentos, HTTP loopback e recibos do servidor são fixtures sintéticas; a atomicidade e as regras reais continuam cobertas pelo emulador da prova anterior. Não houve rede externa, fornecedor, produção ou dados reais. Não certifica Firebase publicado, Tauri, Capacitor ou outro dispositivo. A etapa foi acrescentada ao job de regras do CI, sem `if` nem `continue-on-error`; execução remota continua pendente.

## Problema, ameaça e decisão

Uma confirmação pode perder a resposta, a memória pode mudar durante a revisão, o agente pode ser revogado e a equipa pode rodar a chave. Copiar cegamente um envelope antigo para a memória atual poderia repor uma chave desatualizada; repetir a aplicação depois de um timeout poderia sobrepor trabalho posterior. Repor valores null para campos que antes não existiam também não conserva o estado anterior.

A reversão é uma operação autenticada do titular original, com nova revisão/decifragem, UUID próprio, digest do pedido exato e recibo transacional. A sessão/grant do agente não é necessária. O servidor exige acesso atual ao cofre; para repor uma memória de equipa eliminada, exige que esse titular continue a ser o proprietário atual. Uma conta diferente não pode apropriar-se do recibo de outra pessoa. Se a memória mudou depois da alteração original, a reversão não a sobrepõe.

## Preparação e confirmação

1. `prepareAgentMutationReversal({expectedUid,request:{proposalId}})` lê o recibo aplicado, a memória resultante e a versão `memory-edit-<proposalId>` na mesma transação. Confere UID, autor, proprietário atual, marcadores de eliminação, revisão, digest resultante e o vínculo à versão. A preparação inclui hashes dos snapshots da memória/versão/equipa/época e a época de controlo da reversão.
2. O cliente lê diretamente a memória atual e compara o digest, o envelope, a projeção de metadata, learning/presença e o tombstone com a preparação. Decifra a memória atual e a fonte arquivada. A fonte é recifrada com IV novo; numa equipa pode usar a chave histórica para abrir a fonte e a chave ativa para produzir um envelope v2 com o contexto ativo. Verifica o resultado por nova decifragem. Não substitui uma chave histórica indisponível por uma chave pessoal.
3. A interface mostra conteúdo e metadata atuais e a versão a repor, incluindo learning e a condição de memória eliminada. O conteúdo é texto inerte; não interpreta HTML nem instruções recuperadas. Um evento de conta/cofre/chave retira a revisão, incluindo ABA observado.
4. Só um clique explícito inicia a confirmação. Antes do pedido de aplicação, o cliente grava e relê um checkpoint cifrado por UID com os bytes exatos do pedido. Não guarda plaintext, a mnemónica, a teamKey ou credenciais do agente nesse checkpoint.
5. `applyAgentMutationReversal({expectedUid,request,reviewDigest,confirmed:true})` revalida toda a preparação na transação. O pedido é `{operationId,baseline,enc}`; não aceita um patch arbitrário de metadata. O novo envelope e o baseline fazem parte do digest. A restauração de metadata deriva da versão arquivada no servidor.

O servidor não tem as chaves para provar equivalência semântica entre os dois envelopes. A confirmação depende da decifragem e comparação no cliente do titular. Um cliente malicioso com Firebase Auth do próprio titular já tem os poderes de escrita desse cofre; a API/MCP de agentes não recebe esses poderes.

## Transação e resultados

A mesma transação conserva a memória substituída numa versão `agent-reversal-<operationId>`, repõe o conteúdo cifrado, metadata e learning anteriores, retira o tombstone, atualiza revisão/key epoch/key ID e grava recibo, auditoria e quotas. Campos de metadata/learning anteriormente ausentes são retirados com `FieldValue.delete`; null e ausência mantêm-se distintos. Os identificadores de autor/cofre, relações, anexos e timestamp de criação não são escolhidos pelo pedido. Revisão e ponteiro de histórico avançam para conservar o encadeamento.

O recibo original passa de applied para **reverted**, conservando o resultado da aplicação original. Uma repetição de aprovação do agente devolve esse estado terminal, sem reaplicar a proposta. O recibo de reversão tem unknown/committed/cancelled/revoked, vinculado ao UUID e digest. Repetições exatas de um recibo admitido não criam outra versão, evento ou débito.

`getAgentMutationReversalStatus` e `cancelAgentMutationReversal` recebem `{expectedUid,request}` e funcionam com gates de escrita fechados. A consulta não aplica nada. Cancelamento e aplicação concorrem pelo mesmo recibo: se a aplicação ganhou, o cancelamento devolve committed; se o cancelamento ganhou, a aplicação é recusada. Depois da eliminação/revogação pertinente, um pedido não admitido pode receber revoked sem criar metadata nova.

## Recuperação e limites

O journal local usa `mnemosyne:agent-reversal:v1:<UID codificado>` e o lock partilhado por UID. Só é removido depois de dois resultados terminais coerentes. Uma resposta perdida, falha de leitura ou falha de remoção conserva o checkpoint. Outro separador a alterar esse checkpoint invalida a operação local, mesmo se repuser os bytes anteriores.

Recuperação de unknown reconstrói a revisão do mesmo pedido e exige outro clique explícito. Não gera outro UUID/IV nem repete apply automaticamente. Um baseline já alterado pode ser cancelado sem decifrar as chaves históricas. Ler o checkpoint local requer o cofre pessoal desbloqueado; os recibos originais permanecem consultáveis no histórico da conta, incluindo com o cofre bloqueado.

Limites: pedido até 640 KiB; preparação até 1.280 KiB; learning até 100 KiB por projeção. A aplicação partilha os limites MemoryEdit de 200 operações/20 MiB por UID/cofre/dia e 1.000 operações/100 MiB por equipa/dia. Rate limit autenticado: 60 aplicações/minuto; 120 preparações, consultas ou cancelamentos/minuto, por endpoint/UID.

Há no máximo **200 novos recibos de cancelamento por UID/dia UTC**; replays não debitam novamente. Ao atingir esse limite, o próximo cancelamento retira autoridade a todos os pedidos desconhecidos incrementando `users/{uid}.agentReversalEpoch` e pausa novas preparações até ao início do dia UTC seguinte. Não cria outro recibo nem outro corpo de pedido. A época permanece incrementada depois da pausa: payloads antigos não ressuscitam. Consultas de recibos já existentes continuam disponíveis. A interface mostra mensagem fixa para limites temporários e descarta diagnósticos remotos.

## Schema, regras, migração e rollback

- `agentMutationReversals/{operationId}` guarda apenas identificadores, digest, estado, revisão e data do recibo; não guarda o pedido cifrado nem o texto.
- `agentReversalCancelBudgets/{hashUID_dia}` guarda UID/dia e o contador limitado. O perfil guarda `agentReversalEpoch` e `agentReversalPausedUntil`; ausência significa zero, sem backfill.
- Clientes Firestore não podem escrever perfis nem ler/escrever estas duas coleções. As regras explicam a recusa; os testes incluem titular, outra conta e cliente anónimo.
- A limpeza de conta remove recibos por UID/authorUid/ownerUid e o orçamento de cancelamento por UID. A limpeza de equipa remove os seus recibos por teamId. O orçamento agregado de UID não contém referências de equipa e não é reposto quando uma equipa é eliminada.
- Não foi acrescentado índice composto ou dependência. As consultas deste protocolo usam IDs diretos; limpeza usa índices simples existentes. As coleções e regras ainda não foram publicadas.

Rollout: preservar a ordem Functions/regras antes de Hosting e validar os writers pessoais/equipa, recuperação entre dispositivos e os requisitos globais antes de abrir gates. Reversão usa os gates normais de escrita, sem depender do gate de novas propostas nem de retomar agentes. Fechar gates conserva status/cancel. Não fazer rollback para um parser que não reconheça reverted, que retire a época de controlo ou que volte a aplicar pedidos em recuperação sem nova confirmação. Não repor contadores/épocas de perfis para contornar limites: isso poderia revalidar pedidos antigos.

## Validação e risco residual

Passaram **84 testes focados Functions**, **83 testes frontend em cinco ficheiros** e **25 testes focados no emulador**, sem omissões. A passagem do emulador incluiu a limpeza de conta, os protocolos de proposta e a reversão. TypeScript e lint dos ficheiros afetados passaram. A primeira compilação do novo módulo encontrou uma perda de narrowing numa closure e foi corrigida; a primeira verificação frontend encontrou um parâmetro sem uso e foi corrigida. Os logs foram conservados.

Os testes incluem AES real/IV novo, recifragem entre épocas, fonte sem chave/AAD errado, tombstones pessoais/equipa, field absence/learning, snapshot ABA, timestamps Firestore reais, UID e proprietário atuais, autor eliminado, raw rules deny, replays, perda de ACK, corrida apply/cancel, falha do gate final, quotas e pausa com invalidação permanente após mudança de dia. A UI foi testada com DOM; não substitui o piloto em browsers/dispositivos reais.

Metadata e learning têm de respeitar os contratos suportados; formatos legados incompatíveis são recusados, sem conversão silenciosa de campos.

As suites gerais de 1.595 testes frontend e 552 Functions da prova anterior são baseline histórico e não foram repetidas neste incremento. Não se certifica uma revisão antiga publicada. Nenhum deploy, mutação de produção, acesso a payload de secrets ou chamada generativa foi feito aqui. O produto completo continua dependente dos dados, fornecedores, Stripe, alertas, CI remota e pilotos registados no estado de lançamento.
