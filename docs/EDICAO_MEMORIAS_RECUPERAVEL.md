# Edição, metadados e apagamento recuperáveis de memórias

Implementação local de 13 de outubro de 2026. As escritas pessoais e de equipa continuam fechadas nas fontes. O estado integral das fases 0–6 está em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

## Capturar antes de editar

Sidebar, detalhe da memória e modo de estudo usam o mesmo editor. A leitura do Firestore conserva o digest integral do documento e o título realmente guardado, separado do título de apresentação. Antes de abrir uma edição nova, o cliente compara texto, título e autoria apresentados com o documento decifrado e captura as versões da memória, equipa e época numa transação de leitura.

A base inclui autor, owner, revisão, digest do estado e versão de escrita do Firestore. Para equipas inclui também as versões da equipa/época, contexto criptográfico anterior e época/ID ativos. A submissão compara novamente essa base. Uma alteração seguida de reposição do mesmo conteúdo continua a ser recusada; o cliente não adota automaticamente uma leitura recente.

O título de apresentação não substitui um título guardado como `null` até haver uma edição explícita do título. O texto mantém espaços, linhas vazias e formatação. A inferência semântica ocorre localmente, depois de confirmar que a base continua válida. Não acrescenta ligações automaticamente. Falha semântica retira os dados derivados obsoletos e conserva o novo conteúdo cifrado para processamento posterior.

## Rascunho cifrado durável

`mnemosyne-memory-editor-drafts-v1` é uma base IndexedDB separada, com chave `[uid, sessionId]`. O corpo AES-GCM conserva base, texto/título originais e editados, indicação de edição explícita do título e patch de metadados. A cifra usa o cofre pessoal do ator, inclusive quando a memória pertence a uma equipa; o novo conteúdo remoto de equipa usa a chave de equipa.

A gravação usa Web Locks, comparação da revisão anterior e leitura de confirmação. Fechar ou mudar a seleção conserva o rascunho. Uma resposta tardia não limpa uma edição diferente. Trocas de conta/cofre/geração das chaves retiram a vista anterior. Uma alteração remota assinala a base antiga e impede submissão direta ou pelo botão. Reabrir a memória atual depois de eliminar o rascunho exige confirmação explícita e elimina apenas a cópia revista.

A eliminação local da conta inclui esta base. A purga é transacional, verifica o UID durante a iteração e conserva chaves identificadas como pertencentes a outra conta, mesmo que o cabeçalho esteja malformado. A interrupção antes de completar a transação reverte as eliminações.

## Comandos e admissão

| Callable em europe-west1 | Contrato |
| --- | --- |
| `prepareMemoryEdit` | Captura a base autorizada, sem devolver texto ou título |
| `applyMemoryEdit` | Aplica `edit` ou `delete` com a base e as cifras capturadas |
| `getMemoryEditStatus` | Confirma exclusivamente o pedido identificado pelo UUID/digest |
| `cancelMemoryEdit` | Cancela um pedido desconhecido ou confirma o resultado terminal |

Todos recebem `{actorUid, request}`. O servidor compara o ator capturado com o token antes de limites ou acesso à base. Um diário AES-GCM em `mnemosyne:memory-edit:v1:<uid>` conserva UUID, pedido e cifras estáveis antes de qualquer submissão. Retoma não volta a inferir, cifrar ou criar uma operação. Leitura/decifragem do diário e comparação dos bytes protegem contra substituição ou corrupção.

Para memórias pessoais, apenas o proprietário pode editar/apagar; um destinatário de partilha não recebe esse direito. Membros atuais da equipa podem editar, preservando o autor original; apenas o owner atual pode apagar. Autorização, conta do ator, autor, owner, equipa, época/wrap, gate, versões e cifra anterior são relidos dentro da transação. Legado pessoal em claro é cifrado localmente para o arquivo; campos legados incompatíveis em memórias de equipa exigem migração explícita.

A transação cria o arquivo `sessions/<id>/versions/memory-edit-<UUID>`, atualiza o pai, cria recibo/evento privados e debita os contadores de UID/âmbito e, quando aplicável, equipa. Falha ou concorrência não deixa versões órfãs. O arquivo conserva a cifra e época anteriores, autoria/timestamp, metadados conhecidos de aprendizagem/proveniência e contexto do grafo. Campos do pai que o patch não altera continuam conservados.

O patch admite tags, categoria, cluster, posição, importância, tipo celestial, embedding/modelo, método, taxonomia, estado de projeto, entidades, cor, escala e órbita. Não permite modificar autoria, partilhas, anexos, parent, ligações ou autoridade de aprendizagem. Vetor/modelo devem ser fornecidos ou retirados em conjunto. Embeddings e metadados continuam a ser dados sensíveis; este contrato não os torna anónimos.

Limites: texto novo de 500 KB, título de 2 KB e pedido de 2.100.000 bytes; 200 operações/20 MiB de cifras por UID/âmbito/dia, 1.000 operações/100 MiB por equipa/dia, 60 admissões e 120 outras chamadas por minuto. A calibração de custo e os alertas globais continuam na fase 2.

## Apagamento e recuperação

`delete` é um tombstone: conserva a cifra e contexto anteriores, acrescenta `deletedAt` e arquiva o estado anterior atomicamente. Não recifra sob uma época diferente nem remove fisicamente ficheiros. A leitura filtra tombstones pessoais para impedir que uma cópia legada aninhada reapareça. A retenção e eliminação física continuam a usar os contratos de conta/equipa/anexos existentes.

O painel global recupera ou cancela o pedido com o cofre do UID atual. Um resultado terminal ligado ao pedido é confirmado antes de limpar somente esse diário. Recibo próprio continua consultável depois de rotação ou remoção de membro. Revogação definitiva sem recibo devolve `revoked` sem criar referências; a interface encerra o pedido local e conserva os rascunhos, sem alegar gravação. Ausência de equipa sem marcador ou schema inválido não prova revogação definitiva.

Cancelar não desfaz uma alteração já gravada. Recuperação não equivale a undo: o restauro de tombstones e a reversão de escritas por agentes exigem os critérios próprios da fase 6.

Os quatro conjuntos `memoryEdits`, `memoryEditEvents`, `memoryEditBudgets` e `memoryEditTeamBudgets` recusam acesso direto por SDK. As purgas de conta/equipa incluem as referências novas e os diários locais do UID.

## Criação ligada ao ator capturado

`createAttachedMemory`, `createPersonalMemory`, `getAttachedMemoryCreationStatus` e `cancelAttachedMemoryCreation` passam também a receber `{actorUid, request}`. O pedido interno, digest, UUID e diário v1 permanecem compatíveis. Pacotes antigos sem ator são recusados. Uma troca de token durante a chamada não pode admitir conteúdo sob outro UID.

O ator deve continuar vivo. Um recibo terminal próprio é consultado antes de exigir acesso atual à equipa. Remoção de membro, eliminação da equipa ou do owner sem recibo podem produzir `revoked`, apenas de leitura; recuperação encerra o diário próprio depois de confirmar o resultado, conservando ficheiros e rascunhos. Conta do próprio ator eliminada continua a ser recusada. Falha transitória ou confirmação inconsistente conserva o pedido.

## Publicação, limites e evidência

As evidências locais estão em `W:/real/mnemosyne-launch-evidence/memory-edit-validation-20261013/`. O ensaio Chromium usa componentes, editor, AES-GCM, IndexedDB, Web Locks, diário e executores reais, com Auth/acesso às chaves/base sintéticos e apenas localhost. As regras são ensaiadas no projeto `demo-mnemosyne-rules`; portas privadas evitam a porta 8080 usada pelo Docker. Isto não substitui pilotos com utilizadores e dispositivos reais.

O rollout deve publicar servidor e leitores de recuperação compatíveis antes do cliente. Rollback deve conservar status/cancelamento e leitores dos diários admitidos. Não há índice composto novo neste incremento. O módulo antigo `MemoryInputPanel` não está montado na app; o seu callback de criação foi alinhado com a criação confirmada, sem o tratar como um percurso de UI validado.

Este incremento substitui os SDK writes dos editores integrados. O cutover global ainda exige ligações recíprocas de equipa, migrações legadas e encerramento compatível das permissões SDK restantes. Restam também cloud/segredos/quotas/alertas/App Check/restauração, qualidade multilingue, agentes/acessibilidade, plataformas/artefactos e gates finais. Todas as áreas precedem o deploy completo autorizado.

Em 5 de novembro de 2026 foram corrigidos três problemas encontrados nos pilotos da aplicação completa. O store do Universo conserva a seleção quando a memória continua no corpus autorizado e retira-a quando desaparece ou o âmbito é limpo. O ledger usa FieldValue pelo módulo público de Firestore, suportando o wrapper do runtime. A falha inicial do editor, antes de existir um item de edição, oferece agora “Tentar abrir edição”: relê a vista atual sem eliminar rascunhos. Sidebar, detalhe e modo de estudo usam esta distinção. O teste novo reproduziu o botão sem efeito; depois da correção passaram 58 testes frontend focados em quatro ficheiros, quatro testes Functions do ledger e lint sem erros/avisos nos ficheiros alterados. Uma passagem anterior de 56 testes teve um timeout; a repetição com um worker e a passagem final de 58 passaram com as mesmas asserções e limites. TypeScript e build do ambiente isolado passaram; as suites gerais e Rules conservam o âmbito anterior.

Em 6 de novembro, o piloto Chromium com Auth, Functions e Firestore emulados e duas contas sintéticas passou no build normal, com os módulos afetados iguais às fontes corrigidas. O proprietário selecionou never-cloud. Um agrupamento real foi retido e concluído entre a leitura do cliente e a preparação da edição: a base antiga foi recusada sem edição ou arquivo e a nova tentativa explícita abriu a revisão atual. Texto e título foram editados pela sidebar; ocultar a resposta depois do commit e recarregar permitiu recuperar a mesma operação, com um arquivo cifrado, recibo, evento e débito. A base antiga, outra conta e a repetição com cifra alterada foram recusadas. O rascunho cifrado reapareceu com submissão bloqueada pela base antiga e só foi substituído após confirmação explícita. O apagamento pela sidebar também foi recuperado depois da perda da resposta e recarga. Ficaram dois arquivos e dois débitos; repetir os pedidos não fez a memória reaparecer. Os arquivos conservaram os envelopes anteriores, text vazio e title nulo. Os triggers do ledger gravaram write/update/delete com timestamps válidos. Não houve exceções do navegador, chamadas aos endpoints de inferência observados ou marcas sintéticas de texto/título em claro nos POST observados; as ligações externas foram bloqueadas. Um ensaio anterior esperou incorretamente que o agrupamento pendente se resolvesse sozinho após recarga. A passagem final observou o controlo de cancelamento ausente nesse ponto; não valida o ramo opcional de cancelamento acrescentado ao harness. As falhas e os ensaios de diagnóstico foram conservados.

Este piloto não valida utilizadores reais, clientes instalados, undo ou eliminação física. As alterações frontend tornam desatualizados os artefactos de distribuição anteriores; o verificador Android recusa-os por android_release_sources_changed, sem atualizar o contrato para aceitar o binário antigo. O build de produção e os instaladores precisam de regeneração e validação antes da publicação. As 49 flags de produção continuam fechadas; não houve deploy, mutação de produção ou chamada generativa. A prova privada é personal-edit-pilot-local-validation-20261105.json. Os restantes requisitos das fases 0–6 continuam sujeitos à verificação integral antes do deploy completo autorizado.
