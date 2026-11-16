# Revisão de memórias de equipa com base capturada e recuperação

Implementação local de 13 de outubro de 2026. Escrita de equipa fechada nas fontes e no rollout. Este incremento não encerra a fase 3 nem autoriza o lançamento completo.

## Base da edição

O resultado de texto ou imagem gerado e aprendido captura a base depois da criação confirmada e antes de apresentar a edição. A captura decifra a versão anterior e compara texto, título e autoria com o resultado acabado de guardar. Inclui memória/equipa, autor e owner, revisão, hash integral do conteúdo, versão de escrita do Firestore, versões da equipa e da época, época/ID ativos e contexto criptográfico anterior.

A base segue no rascunho cifrado do `CognitiveInput`. A submissão relê o estado para o comparar com essa base; não adota a leitura posterior como nova base. Alteração seguida de reposição do mesmo conteúdo continua a ser recusada pela versão de escrita. Se a captura depois da criação falhar, conserva o ID criado e o texto, assinala a edição como indisponível e exige voltar a abrir a memória. Resultados antigos sem base de equipa conservam o rascunho e ficam indisponíveis para revisão.

Conta/cofre/época, pertença e papéis da vista são guardados durante os awaits. A interface captura também a revisão da edição local: uma alteração do texto invalida o callback mesmo que o utilizador volte ao texto submetido. Uma resposta tardia não limpa outra edição. Campos legados de nós, ligações estruturadas ou prompts em claro recusam este percurso, conservando a origem para migração explícita.

## Pedido cifrado e transação

Antes da submissão, `teamRevisionRecovery` guarda em `mnemosyne:team-revision:v1:<uid>` um diário AES-GCM do cofre pessoal. Contém UUID estável, base, cifra anterior exata, nova cifra v2 e seis metadados semânticos tipados. Verifica o diário por decifragem e leitura dos bytes guardados. Web Locks e comparação dos bytes protegem contra pedidos concorrentes no mesmo UID. Retoma não infere, gera novo UUID nem volta a cifrar.

| RPC em europe-west1 | Comportamento |
| --- | --- |
| `prepareTeamRevision` | Captura hashes e contexto numa transação de leitura, sem devolver conteúdo |
| `applyTeamRevision` | Revalida base, conta, equipa, época, wraps e bloqueio operacional; grava tudo atomicamente |
| `getTeamRevisionStatus` | Consulta apenas o resultado do pedido cifrado capturado |
| `cancelTeamRevision` | Cancela pedido ainda desconhecido ou confirma o resultado já terminal |

Todos recebem `{actorUid, request}` e comparam o UID capturado com o token antes de limites ou acesso à base. Owner, admin e membro podem rever como no editor de equipa existente; a operação conserva o autor e o timestamp originais. Um ex-membro não pode preparar ou iniciar outra escrita.

A transação cria `sessions/<id>/versions/team-revision-<UUID>`, atualiza o pai, cria `teamRevisions/<UUID>`, um evento sem conteúdo em `teamAudit/revision-<UUID>` e dois contadores diários. Falha em qualquer leitura, base, âncora ou orçamento deixa todos esses documentos por gravar. Replays confirmam um recibo já existente e não criam segunda versão nem segundo débito.

A versão contém a cifra/contexto anteriores e a projeção histórica explícita: tags, categoria, anexos, embedding/modelo, conexões, cluster, posição, importância, tipo celestial, entidades, método, taxonomia, projeto, parent, fornecedores/modelos, aprendizagem e alteração de conexões. No pai, só a cifra, contexto ativo, semântica calculada, revisão e ponteiro são substituídos; acrescenta `learning.revisedAt` quando já existe aprendizagem. Outros campos do pai ficam conservados. A cifra anterior nunca é relabelada como pertencendo à época ativa.

Limites locais de implementação: 200 revisões/20 MiB de cifras por utilizador/equipa/dia e 1.000 revisões/100 MiB por equipa/dia; 60 admissões e 120 consultas/cancelamentos por minuto/UID. A calibração de custo e os alertas globais permanecem na fase 2. Texto novo limitado a 500 KB, título a 2 KB e pedido a 2.100.000 bytes. Embeddings e metadados continuam sensíveis e sujeitos ao modelo de autorização documentado.

## Recuperação, revogação e eliminação

O painel recupera ou cancela com o cofre do UID atual. Confirma duas vezes o resultado terminal ligado a UUID/digest/base antes de remover somente o diário próprio. Erro, cifra adulterada, outro UID/cofre, resposta incompatível ou substituição dos bytes conserva o pedido e o rascunho.

Um recibo terminal próprio pode ser recuperado depois de rotação ou remoção de membro; não autoriza nova escrita. Se o recibo já foi purgado e existe revogação definitiva, a consulta/cancelamento devolve `revoked` sem criar recibos, versões, auditoria ou contadores. A interface encerra o diário próprio e conserva o rascunho sem alegar gravação. Ausência transitória de equipa sem marcador não equivale a revogação definitiva.

A eliminação de equipa inclui recibos e ambos os contadores. A eliminação de conta purga recibos por ator, autor e owner, além do contador próprio e do namespace local exato; não remove o diário de outro UID. Os três novos conjuntos privados recusam leitura, lista e escrita direta por SDK. A criação de equipa admite a aprendizagem tipada; o SDK não pode forjar `learning.revisedAt` numa revisão ou alterar os metadados da versão arquivada.

## Validação e publicação

As evidências estão em `W:/real/mnemosyne-launch-evidence/team-revision-validation-20261013/`. Incluem transações reais no emulador `demo-mnemosyne-rules` e Chromium com formulário/hook, IndexedDB, AES-GCM, diário, Web Locks e executores de servidor reais. Auth, acesso às chaves e base do ensaio de navegador são sintéticos e locais; não equivalem a um piloto com membros/dispositivos reais. O emulador verifica concorrência de nonces, versões Firestore/ABA, recibos privados, regras e purgas.

As novas Functions devem existir antes de distribuir o cliente que as usa. O rollout deve publicar servidor/regras compatíveis com a escrita fechada, verificar recuperação e só abrir as fontes/configuração depois dos critérios completos. Um rollback deve preservar leitores do diário e status/cancel dos pedidos admitidos. Nenhum índice composto novo foi necessário para as consultas por um único campo usadas aqui.

Ainda necessários: restantes editores/escritas e ligações de equipa com intenções recuperáveis, migração e cutover dos dados legados, pilotos reais web/desktop/Android, restore isolado, cloud/segredos/alertas, qualidade multilingue, agentes e acessibilidade. A autorização do utilizador exige concluir todas as áreas antes do deploy completo.
