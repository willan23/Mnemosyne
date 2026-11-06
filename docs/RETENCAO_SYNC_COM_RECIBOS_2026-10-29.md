# Retenção de sincronização com recibos — 29 de outubro de 2026

A candidata substitui a limpeza antiga por purga transacional de envelopes com prova de conclusão. Retira a eliminação de tombstones baseada em ACKs legados limitados. Corrige um risco de perda de dados; expiração de filas, importações pendentes, purga de memórias e recuperação operacional continuam exigidas.

## Problema reproduzido

O job antigo lia no máximo 200 dispositivos e tratava o subconjunto como completo. A premissa de que limitar leituras apenas atrasaria a limpeza era incorreta: omitir um dispositivo ativo podia autorizar a purga. Um replay isolado da função anterior, com hash da imagem anterior verificado, demonstrou que 200 dispositivos com ACK devolviam `true`, mas incluir o 201.º sem ACK devolvia `false`.

Um segundo cenário não exige 201 dispositivos ativos: com 200 registos revogados nas primeiras posições e apenas um ativo omitido, o subconjunto vazio de ativos também autorizava a purga, enquanto a coorte completa a recusava. Ambos os casos são sintéticos e não descrevem dados observados de produção.

Os ACKs guardavam apenas IDs, sem provar a revisão de uma eliminação posterior. A decisão também estava separada do batch que apagava os documentos, permitindo alterações entre leitura e eliminação. Apagar o pai de uma memória não demonstrava limpeza/recuperação de versões, relações e anexos dependentes.

## Decisão e garantias

O scheduler conserva nome, região, periodicidade e timeout. Usa páginas de 50 envelopes e cursor privado com CAS, para conseguir avançar para além dos registos retidos. A descoberta projeta expiração/ID. Cada candidato e os seus recibos são relidos numa transação; a verificação da conta e a eliminação do envelope atual pertencem à mesma transação.

Só são elegíveis envelopes `pulled` com importação privada `complete`, ligada ao proprietário, envelope, dispositivo, direção, hash da cifra, contagem/cursor e timestamps coerentes; ou cancelados com recibos de publicação e cancelamento v2 concordantes, ligados aos bytes cifrados atuais e sem importação iniciada. Expiração e conclusão/cancelamento têm ambas de ter mais de trinta dias. Conta em eliminação, estado legado/desconhecido/recente/pendente, campos inesperados ou prova contraditória conservam o envelope. Alterar a cifra invalida a prova de purga.

Novos recibos de publicação/cancelamento recebem `v:2` e `payloadDigest`. Recuperação de v1 continua disponível, mas v1 não autoriza purgar envelopes cancelados. Não há promoção automática de provas antigas nem mudança do resultado público das callables. Os recibos permanecem depois da eliminação da cifra para impedir recriação por replay.

O cursor `mobileSyncCleanup/state` guarda metadata operacional de paginação, timestamp e revisão. As Rules existentes recusam acesso SDK. O CAS impede uma execução concorrente de recuar o cursor. Cursor inválido/futuro provoca recusa, sem reset silencioso. Um candidato com falha não bloqueia os seguintes; um ciclo posterior volta a avaliar os retidos. O orçamento é de sete minutos e a paginação pode continuar no dia seguinte; não prova drenagem de todo o backlog numa invocação.

**Este job não lê nem apaga `sessions`, versões de memórias, anexos, recibos ou budgets.** Tombstones ficam conservados até existir protocolo separado de dependências, ACK de revisão e recuperação. Ausência de dispositivos numa query limitada não autoriza eliminar memórias.

## Validação

- Replay sintético do predicado antigo com 201 dispositivos: subconjunto limitado permite purga, coorte completa recusa; sem acessos de produção.
- **16 testes focados Functions** passaram: conclusão/cancelamento, payload, legado, corrupção, recência, conta eliminada, idempotência, preservação, páginas 50+10, CAS e cursor inválido.
- Suite geral Functions: **599 passaram**, zero falhas, uma omissão prevista de Rules fora do emulador; TypeScript passou.
- Repetição integral: **325 Functions/Rules +25 frontend/Rules**, zero falhas/omissões, saída zero e emuladores encerrados. Node 22/JDK 21, projeto demo isolado.

Os três casos novos de emulador verificam a purga com Admin SDK real, preservação de tombstones/versões/recibos, cifra alterada, conta eliminada, paginação, privacidade do cursor e recuperação/replay depois da purga. A primeira tentativa também aprovou 325+25, mas o wrapper atingiu quinze minutos antes de obter o fecho; ficou preservada sem contar como comando terminal aprovado. A repetição alterou apenas o prazo do wrapper para trinta minutos, sem alterar código, testes ou os seus timeouts, e confirmou o fecho. Frontend não mudou: 2.137 testes/229 ficheiros, build e browser são evidência anterior, com bytes conservados.

## Migração, rollout, reversão e limites

Não há migração de memórias. Só novas publicações/cancelamentos recebem v2; v1 é conservado. O cursor nasce na primeira execução do scheduler. Não se alteraram índices, Rules, gates ou periodicidade na consola e não se executou o job contra produção.

Publicar backend compatível antes de abrir sync. Instâncias antigas que só conhecem v1 recusam v2; a recuperação deve aguardar a revisão nova durante a substituição. Rollback deve conservar a leitura de v2 e a retirada da purga antiga de tombstones. Não apagar recibos para contornar recusas.

Permanecem: expiração de `queued` sem início para desobstruir filas; destino de importações iniciadas além da janela de retoma; recuperação/custódia antes de eliminar cifra; migração legada; purga de tombstones/dependências; quotas/retention operacionais e pilotos autenticados/offline/dispositivos. Retenção conservadora aumenta armazenamento e não equivale a recuperação comprovada.

Prova privada: `W:/real/mnemosyne-launch-evidence/sync-retention-local-validation-20261029.json`, descendente da captura semântica. Inclui a descoberta OpenRouter e os dois ensaios sintéticos anteriores à instrução de aguardar saldo. **49 gates fechados, fases 0–6 incompletas e zero deploy.**
