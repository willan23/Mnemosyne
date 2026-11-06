# Resolução recuperável de conflitos de sincronização — 15 de outubro de 2026

## Contrato atual

O painel entrega os hashes integrais dos documentos que originaram a vista. A callable de preparação exige o dono autenticado, âmbito pessoal explícito (`teamId:null`), ausência de partilhas, conta ativa e envelopes pessoais v1. Captura as versões completas do conflito e, para aplicar, do original. O servidor compara conteúdo e `updateTime`, incluindo mudanças que voltam ao valor anterior. Documentos legados sem âmbito explícito ou sem cifra válida aguardam a migração pessoal.

Antes de aplicar, o cliente guarda uma intenção AES-GCM com UID interno, UUID e base capturada. Usa Web Locks, comparação de bytes e leitura de confirmação; mantém a guarda da conta/cofre por toda a operação. Quatro callables em `europe-west1` recebem o UID capturado e recusam um token de outra conta antes de tocar na base ou nos limites. Não recebem texto/título decifrados nem chaves. A cópia do envelope recebido usa a mesma chave pessoal e não exige decifração no servidor.

| Ação | Efeito atómico |
|---|---|
| Aplicar | Arquiva integralmente os dois documentos, copia a cifra recebida para o original, conserva autoria/data inicial/anexos/conexões do original e marca o conflito como apagado |
| Ambos | Arquiva integralmente o conflito, retira os marcadores de conflito e mantém a cifra e os restantes campos |
| Descartar | Arquiva integralmente o conflito e marca-o como apagado; mantém a cifra para recuperação |

Aplicar conserva tags/categoria recebidas e invalida embeddings, cluster, nós/ligações extraídos e prompts derivados no original. Os valores anteriores, incluindo campos desconhecidos e prompts legados em claro, permanecem no arquivo completo. Este incremento não cifra esses campos históricos: a migração pessoal continua necessária antes do corte global das escritas antigas. Os anexos do conflito continuam associados ao conflito arquivado; não são copiados para o original.

Arquivos determinísticos, decisão, evento e contador diário são gravados na mesma transação. Até 200 aplicações por UID/dia neste protocolo, com limite adicional por callable; a calibração global de quotas permanece na fase 2. Falhas de limites de tamanho do Firestore recusam a transação inteira. O cancelamento de uma intenção desconhecida grava um resultado terminal e impede uma aplicação posterior. Uma decisão já gravada devolve sempre o seu recibo, mesmo após remoção dos pais. Sem recibo e com autoridade revogada, consulta/cancelamento devolvem revogação apenas de leitura.

O painel global permite recuperar ou cancelar o pedido. Uma resposta perdida deixa o mesmo UUID e a mesma base no diário; a recuperação consulta o recibo antes de considerar aplicar. A remoção local só ocorre após duas respostas terminais concordantes. Funciona com admissão fechada quando já existe recibo, e permite cancelar uma intenção desconhecida. O diário de outra conta nunca é adotado. Feedback tardio é invalidado por troca de conta/cofre ou desmontagem.

`syncConflictDecisions`, `syncConflictEvents` e `syncConflictBudgets` recusam todo o acesso SDK e entram na purga da conta. O diário local tem namespace por UID e entra na limpeza local. A aplicação usa os gates existentes de revisões pessoais, ainda fechados; as regras SDK antigas continuam pendentes de corte após as migrações restantes.

### Validação do incremento

Nove testes do servidor e catorze do cliente/painel passaram. O ensaio Chromium usa a factory, painel de recuperação, AES, localStorage/Web Locks e executor reais com Auth/base sintéticos. Verificou aplicação atómica, arquivos decifráveis, resposta perdida, reload com gate fechado, cancelamento e token trocado, sem pedidos externos nem mutações de produção.

O frontend geral passou 1.313 testes/172 ficheiros; Functions geral passou 398, com uma omissão por não usar emulador. Duas regressões adicionais foram aprovadas depois dessas passagens gerais, nos conjuntos específicos finais. Build/TypeScript, lint sem erros e quatro smokes públicos locais passaram. A primeira suite completa de Firestore teve 233 aprovações e uma falha: duas fixtures usavam o mesmo UUID. A correção foi validada numa repetição dos quatro cenários de conflitos, todos aprovados, seguida pelos 23 testes de regras do frontend, também aprovados. Não houve uma nova passagem completa única depois da correção da fixture; a CI completa atual continua exigida para o lançamento. Emuladores demo encerrados.

Resultados e limites estão no [estado do lançamento](ESTADO_LANCAMENTO_COMPLETO.md) e em `W:/real/mnemosyne-launch-evidence/sync-conflict-local-validation-20261015.json`. O objetivo completo continua ativo e os gates de novas escritas permanecem fechados.

## Histórico — incremento de 3 de outubro de 2026

## Atualização posterior

A pendência de recibo/journal da captura de clips indicada neste incremento recebeu a implementação e os testes de [RECUPERACAO_CIFRADA_CLIPS.md](RECUPERACAO_CIFRADA_CLIPS.md). Novas capturas têm gates próprios fechados e recuperação/consulta/cancelamento ligados à conta. Os limites abaixo conservam o estado do primeiro incremento; pilotos/dispositivos e ingressos legados de clips continuam pendentes na revisão seguinte.

## Falha e correção

O painel escrevia o texto/título decifrados na memória original e apagava o conflito numa segunda operação. Substituiu-se esse percurso por `resolvePersonalSyncConflict`: a UI entrega IDs e revisões, o serviço lê o conteúdo atual do servidor e prepara envelopes pessoais antes da transação. Não recebe o texto da vista para fazer a escrita.

A operação exige o dono atual, âmbito pessoal, ausência de partilhas e uma revisão numérica válida. Recusa memórias apagadas, envelopes bloqueados, IDs incompatíveis e metadata de conflito inválida. A guarda observa conta e cofre desde a preparação até à confirmação; alterações observadas ficam retidas mesmo que a conta/chave anterior volte a aparecer. Estas verificações não constituem atestação do dispositivo.

## Contrato de cada ação

| Ação | Escritas |
|---|---|
| Aplicar | Arquiva o conteúdo anterior num envelope cifrado, atualiza o original com o conteúdo recebido recifrado e marca o conflito como apagado, na mesma transação |
| Ambos | Retira os marcadores de conflito e avança a revisão; conserva o conteúdo existente |
| Descartar | Marca o conflito como apagado e avança a revisão; conserva o conteúdo existente |

Antes das escritas, a transação relê ambos os documentos necessários e recusa qualquer diferença em relação às leituras que produziram a cifra, inclusive metadata sem avanço de revisão. A comparação serializada é conservadora: uma diferença na ordem de campos também pode exigir atualizar a vista. Não reprocessa automaticamente um conflito com conteúdo diferente.

Aplicar conserva autoria, âmbito, data inicial, anexos e conexões do original. Copia as tags/categoria recebidas e invalida embeddings, agrupamento, nós/ligações extraídos e prompts antigos para impedir que o conteúdo substituído continue indexado como atual. O arquivo usa uma lista explícita de metadata permitida e conserva as referências dos anexos anteriores. Não associa automaticamente anexos do conflito ao original.

O painel esconde conflitos de outra conta, equipa, partilhados, apagados ou bloqueados. As ações ficam indisponíveis enquanto há uma operação pendente. A confirmação visual só aparece após acknowledgement; feedback tardio deixa de aparecer depois de sair da vista ou mudar de conta. Erros visuais têm texto fixo, sem diagnóstico de transporte ou conteúdo privado.

## Captura de clips

Aplicou-se a mesma guarda a `persistClippedMemory`, incluindo revalidação depois da cifra e do acknowledgement. O hook ignora respostas após desmontagem/mudança de conta e não devolve à fila global uma operação invalidada pela conta/cofre. As devoluções por limite de plano ou falha de transporte ficam marcadas com o UID: apenas essa conta pode consumir a entrada. Clips novos recebidos antes do login mantêm o comportamento de atribuição à conta que os captura.

O campo de dono é validado ao ler e retirar a fila; um marcador inválido não permite reatribuir o conteúdo. A fila continua local à sessão do browser e não é um journal cifrado de recuperação. O feedback de transporte passou a ser fixo.

## Limites e pendências

- Um acknowledgement perdido ou uma revogação depois do commit pode deixar a transação já aplicada. A mensagem pede atualizar/verificar antes de repetir; não promete rollback nem idempotência por recibo.
- Ambos/Descartar não migram conteúdo legado em claro. As regras continuam a exigir o contrato cifrado; a migração de legado permanece necessária.
- Os conflitos apagados mantêm um tombstone com cifra. A retenção/purge, confirmação entre dispositivos e políticas de histórico continuam por concluir; este percurso não remove fisicamente documentos/objetos.
- A guarda de conta/cofre destes serviços não conclui o inventário de escritores. A importação mobile/desktop, importação Obsidian e escritores semânticos ainda exigem revisão específica.
- Clips continuam sem recibo idempotente/reconciliação do servidor: uma falha de transporte com commit já aplicado pode deixar uma entrada da mesma conta na fila. É necessário concluir esse protocolo e a recuperação local cifrada antes de considerar fechado o percurso completo.
- Nenhum gate de lançamento foi aberto, nenhuma configuração foi alterada em produção e nenhum deploy foi executado.

## Validação

Os testes usam exclusivamente dados sintéticos. Os testes do serviço usam cifra real e um adapter transacional local; o caso de regras executa uma transação equivalente no Firestore Emulator com fixtures de envelopes, sem contactar fornecedores. Os resultados finais e hashes do incremento são registados no estado de lançamento e na evidência local fora do repositório.

Validação local concluída com Node **22.23.3** e JBR **21.0.6**:

- **40 testes focados** em cinco ficheiros antes da extensão da fila ligada ao UID; a suite geral seguinte inclui os dois testes adicionais dessa fila.
- **569 testes frontend /111 ficheiros**, build web e lint geral com **zero erros/23 avisos preexistentes**.
- **116 testes Functions +22 frontend** na suite completa Firestore/Storage Emulator, incluindo a nova transação; build Functions e encerramento normal dos emuladores.
- Preflight local AST: **dez gates fechados**. Diff do escopo sem erros. Nenhuma mutação de produção.

A primeira compilação detetou um import de biblioteca de toast inexistente; foi corrigido para a biblioteca já usada no produto. O primeiro lint focado detetou um parâmetro não utilizado no fixture; também foi corrigido. A suite geral de 557 testes pertence à revisão anterior deste incremento; o resultado de 569 acima inclui as alterações finais de clips/fila.
