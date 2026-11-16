# Review Inbox — identidade, migração e backup cifrado local

Continuação de interface: [teclado, diálogo modal e fonte local](UX_MEMORIA_TECLADO.md). Tab/Shift+Tab, fundo inativo, Escape e restauro do foco anterior foram ensaiados em Chromium com os estilos e a fonte reais. A aceitação por leitores de ecrã e dispositivos reais permanece pendente.

## Decisão de 16 de outubro de 2026

A Review Inbox continua opcional, local e sem pedidos a fornecedores. Conserva perguntas editáveis, fonte autorizada, prioridades, agenda existente e limite de 500 perguntas. O array v1 cifrado em localStorage tinha apenas UID no nome da chave, sem identidade dentro da cifra e sem CAS. Gravações e callbacks podiam atravessar uma mudança de conta/cofre. O novo formato v2 usa IndexedDB e identidade autenticada dentro do conteúdo AES-GCM.

Não houve alteração de Firestore, Functions, regras, índices ou dados de produção neste incremento. Os gates gerais permanecem fechados. A fase 6 continua aberta para os restantes requisitos de agentes, acessibilidade e dispositivos reais. O ensaio local de backup/restauro descrito abaixo não substitui a recuperação operacional do sistema completo.

## Schema e fluxo

| Local | Conteúdo |
| --- | --- |
| IndexedDB `mnemosyne-review-inbox-v2`, store `inboxes` | Uma entrada pela chave exata do UID |
| Header v2 | `v`, `uid`, UUID `revision`, `enc` |
| Corpo cifrado | A mesma versão/UID/revisão, `items`, `legacyImports`, `pendingLegacy`, `restoreReceipts` e `restoreHistory`; os três últimos campos são opcionais na leitura de v2 anterior |
| Importação legada | UID confirmado pelo utilizador, instante, SHA-256, string cifrada v1 original e mapa de IDs |
| Origem legada | `mnemosyne:review-inbox:v1:<uid>`; fica intacta após importar |

Load valida identidade/revisão externa e interna e compara bytes capturados antes/depois dos awaits. A vista devolvida é imutável; a base bruta privada fica associada ao objeto da vista. Um objeto copiado ou de outro UID não se torna uma base válida. O cliente não aceita uma cifra de Alice sob um header de Bob, mesmo quando o mesmo cofre consegue decifrá-la.

Save captura os itens por valor, mantém o UID/cofre e a vista através de guardas com invalidação permanente, usa Web Lock por UID, valida e faz roundtrip do corpo cifrado, e aplica CAS numa transação IndexedDB. Verifica novamente os bytes guardados. Uma resposta perdida depois da gravação pode significar que a nova revisão já ficou guardada: a recuperação faz novo load e não reescreve a base anterior. Não é apresentada uma garantia falsa de que uma falha tardia deixou sempre o estado anterior intacto.

A ausência de IndexedDB/Web Locks ou uma falha de armazenamento recusa a ação. O bloqueio entre separadores evita preparação simultânea; o CAS continua a proteger o commit. A fonte v1 é comparada pela guarda síncrona imediatamente antes do CAS. Um cliente antigo não coopera com esses locks e pode escrever localStorage depois desse instante: não existe atomicidade entre os dois motores. O novo conteúdo v2 fica separado e a nova origem antiga reaparece como pendente.

## Atribuição explícita do formato v1

Encontrar uma entrada v1 não incorpora nem decifra automaticamente as suas perguntas. O painel apresenta um aviso e um botão para abrir a prévia. O utilizador revê as perguntas e confirma que devem ser atribuídas ao UID mostrado. A confirmação liga a conta, a vista e o digest exato da origem. **É uma atribuição feita pelo utilizador; o formato v1 não oferece prova criptográfica da conta original.**

A importação acrescenta perguntas às atuais. IDs e conteúdo iguais não se duplicam; se o ID já existir com conteúdo diferente, cria uma cópia com UUID novo após o aviso/consentimento explícito. O arquivo conserva a string v1 exata e o mapa dos IDs. Preserva espaços das perguntas, datas, prioridade e parâmetros de repetição. Origem alterada, formato incompatível, campos desconhecidos, IDs duplicados ou limites excedidos recusam o pedido inteiro, sem truncar perguntas ou arquivos.

Há um máximo de 500 perguntas, 16 origens legadas arquivadas e oito milhões de bytes de corpo/entrada legada. Estes limites são locais e explícitos; uma recusa conserva a origem para resolução. Uma escrita posterior de um cliente antigo nunca substitui v2 nem desencadeia merge automático. Não se apaga a origem v1 ao importar.

## Interface e escopo

O estado apresentado inclui UID e geração do cofre. Uma mudança de UID/cofre ou fecho retira loads, saves e callbacks de limpar pergunta/edição. Uma ref bloqueia dois cliques no mesmo turno. O acesso à fonte é confirmado de novo no handler e antes de gravar uma pergunta nova. A edição mantém a vista original, mesmo depois de outro separador atualizar a lista; não adota silenciosamente uma base mais recente.

Notificações só transportam uma revisão aleatória, sem pergunta ou UID. A própria confirmação não provoca uma recarga redundante; uma revisão diferente, storage ou focus pede nova leitura. Reads em curso são retirados ao começar uma mutação e as recargas são adiadas enquanto ela decorre. Uma recarga automática não apaga o aviso de edição recusada. O utilizador pode recarregar explicitamente, conservando o rascunho, ou fechar a edição e abrir a versão atual.

Os novos textos de prévia/atribuição/recuperação existem em pt-PT, pt-BR, inglês e francês. A purga local de conta remove apenas a entrada IndexedDB do UID e as chaves locais próprias; conserva contas estrangeiras e UIDs com prefixo semelhante.

## Privacidade, exportação e rollback

As perguntas, respostas implícitas de revisão e arquivos não são enviados à cloud. Continuam apenas neste browser/perfil/dispositivo, sem sincronização e sem inclusão automática no export Firestore. Limpar os dados do browser pode eliminá-los. Há agora exportação e importação manuais cifradas; o backup Firestore continua sem proteger a Review Inbox. A interface informa que as perguntas são locais e sem sync.

Rollback deve retirar temporariamente a interface conservando IndexedDB v2 e a origem v1. Um cliente anterior só conhece v1 e não mostra as novas alterações v2; não copiar automaticamente o conteúdo v2 para o formato sem UID interno. A migração mantém a origem anterior, mas não reverte automaticamente perguntas editadas/reagendadas depois da importação. A aceitação em dispositivos reais e a política global de retenção/exportação continuam exigidas.

## Backup e restauro — continuação de 16 de outubro

Exportar prepara um ficheiro JSON com envelope AES-GCM do cofre pessoal. O UID, UUID do backup, data, corpo v2 completo e a string v1 local ficam dentro da cifra. A exportação verifica a cifra por roundtrip, conserva perguntas/agenda, arquivos exatos, origens pendentes e históricos de restauro, sem alterar o armazenamento de origem. A interface pede confirmar o ficheiro descarregado: preparar a descarga não prova durabilidade em disco. Para importar, é preciso entrar na mesma conta e desbloquear o cofre capaz de decifrar o ficheiro. O ficheiro não inclui uma chave de recuperação e não é partilhável como backup de outra conta.

A seleção do ficheiro só prepara uma prévia. Esta mostra a data, perguntas, adições/cópias, diferenças de conteúdo/agenda/prioridade e origens pendentes. A aplicação exige confirmação explícita do UID. Perguntas atuais permanecem; IDs iguais e todos os campos iguais são conservados, e divergências criam cópias avisadas com IDs novos. Não há substituição automática por um array de outro dispositivo. O plano está ligado à vista capturada; mudanças de conta/cofre/vista ou da base recusam a ação.

Os arquivos legados são unidos pela entrada completa, conservando atribuições e mapas diferentes. Origens v1 recuperadas sem atribuição ficam cifradas em `pendingLegacy`, sem escrever por cima do localStorage nem adotar perguntas automaticamente. O seletor distingue a origem local das recuperadas; permite rever uma origem válida mesmo quando outra está malformada. A confirmação separada da origem continua necessária, e o arquivo exato acompanha a importação. Uma origem inválida é conservada para resolução.

Perguntas, arquivos e recibo local são gravados no mesmo CAS IndexedDB sob Web Lock. O recibo liga operação, UUID do backup, digest canónico do envelope, instante e mapa de IDs. Uma resposta perdida pode ser recuperada com o mesmo pedido ou pela seleção do ficheiro após reload: confirmar o recibo é apenas leitura e conserva edições posteriores. Repetir intencionalmente exige preparar outro plano e voltar a confirmar. Recibos vindos de outro dispositivo entram em `restoreHistory`; não valem como prova de execução neste armazenamento. JSON com BOM, espaços ou ordem de propriedades diferentes identifica o mesmo envelope; reutilizar um UUID já conhecido com outra cifra é recusado.

O ficheiro tem limite de 24 milhões de bytes, o conteúdo decifrado de 16 milhões e o corpo de oito milhões. Mantêm-se 500 perguntas e 16 arquivos legados, com até 16 origens pendentes, 64 recibos locais e 256 registos históricos. Tamanho declarado é verificado antes de ler, e bytes reais depois da leitura; campos inesperados, UID/cifra incompatíveis ou limites recusam o plano inteiro. Não há truncagem ou descarte automático para caber. A eliminação local da conta remove o corpo completo e a sua origem v1; ficheiros descarregados são geridos pelo utilizador.

### Evidência desta continuação

Os 61 testes focados passaram. O ensaio Chromium usa painel/factory, AES, IndexedDB, Web Locks, descarga e leitura de ficheiro reais, com Auth sintético e pedidos externos bloqueados. Comprovou restauro entre perfis independentes, conflitos preservados, arquivos exatos, origens pendentes e seleção/atribuição separada, confirmação só de leitura, resposta perdida/reload, concorrência, ABA do cofre durante a leitura, UID estrangeiro mesmo com a mesma chave e purga própria. O ensaio anterior de UID/CAS também passou com esta versão. Zero pedidos externos ou mutações de produção. A suite geral aprovou **1.396 testes frontend/178 ficheiros** e **414 Functions/uma omissão**; build/TypeScript passaram, e o lint manteve zero erros/23 avisos anteriores. A prova consolidada e os limites de reutilização das regras estão em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

## Evidência do incremento anterior de UID/CAS

- 45 testes focados de serviços, painel e eliminação local de conta aprovados: AES, UID/revisão, prévia/atribuição, origem alterada, preservação de IDs/conteúdo/agenda, forks antigos, CAS, cifra incompatível, limite 500, troca de conta/cofre, dupla ação, fecho e callbacks tardios.
- Chromium com factory/painel, AES, IndexedDB e Web Locks reais; somente Auth é sintético. Duas páginas comprovam baselines desatualizadas, CAS IndexedDB concorrente e lock ocupado. Também passa ACK perdido/reload sem duplicação, callback de Alice que não limpa o novo rascunho de Bob, ABA do cofre antes do commit, header copiado recusado e purga própria que conserva contas estrangeiras/prefixos. Zero pedidos externos e mutações de produção.
- Suite geral final: **1.380 testes em 178 ficheiros** aprovados. Functions: **414 aprovações/uma omissão**; os 208 artefactos compilados e 79 fontes conferidas permanecem idênticos à prova anterior. As regras **243+23** são reutilizadas, sem nova execução de emulador nesta alteração exclusivamente de cliente.
- TypeScript/build passaram; lint final zero erros/23 avisos anteriores. Quatro smokes locais passaram. YAML/etapa nova CI verificados localmente; CI remota protegida pendente. A consolidação está em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

As falhas iniciais dos testes e as correções de recarga/notificações foram conservadas em `W:/real/mnemosyne-launch-evidence/review-inbox-validation-20261016/`. Não se usa este ensaio de Chromium para afirmar aceitação em Tauri/Capacitor, leitores de ecrã ou grandes cofres reais.
