# Fase 6 — navegação e revisão pessoal

## Windows: backup e restauro da chave — 25 de outubro

A [nova custódia de recuperação](MIGRACAO_CHAVE_UPDATER_WINDOWS_2026-10-24.md#recuperação-a-partir-do-secret-manager--25-de-outubro) guarda a época 2 no Secret Manager, versão 1, em europe-west1, sem concessões de IAM ou bindings novos. Uma recuperação real para outra diretoria passou o CRC32C, uma assinatura nova com a chave pública do produto e igualdade dos bytes privados com a chave original. Não foi ensaiada outra máquina/conta. O workflow foi preparado para compilar sem chave e assinar só no empacotamento; GitHub secret e CI remota continuam por configurar/validar após a revisão do checkout. Não houve mudança de binários, feeds ou deploy. Os 49 gates e os restantes critérios das fases 0–6 continuam exigidos.

## Windows: candidata atual e migração manual da chave — 24 de outubro

A [migração da chave do updater](MIGRACAO_CHAVE_UPDATER_WINDOWS_2026-10-24.md) foi escolhida explicitamente pelo responsável após perder a password anterior. A versão candidata passa a 1.0.9, com canal v2 separado e feed 1.0.8 preservado. O publicador revalida a relação entre chave, canal, versões e hashes antes dos feeds; a custódia local fica protegida por DPAPI, fora do checkout. O novo preflight de plugins corrigiu o desalinhamento JavaScript/Rust que impedia o build real.

Passaram 55 testes frontend, 68 Node, TypeScript/lint e auditoria de produção do frontend. MSI/NSIS finais foram assinados e verificados; o executável extraído passou WebView2 público em perfil isolado, com chave nova embutida, IPC/Wasm/Worker/CSP e rede bloqueada. O aviso de migração passou nos quatro idiomas. Um URL de download incorreto de tauri.localhost foi reproduzido e corrigido; o despacho final foi observado pelo debugger sem abrir browser externo. A preparação/verificação com ficheiros reais passou numa mirror isolada. Não se executou o instalador nem uma atualização instalada. Backup da chave, CI, plataformas e demais critérios das fases 0–6 permanecem exigidos; 49 gates fechados e nenhum deploy.

## Deteção de atualização e identidade de build — 24 de outubro

A [identidade de build](IDENTIDADE_BUILD_E_ATUALIZACOES_2026-10-24.md) passa a UUID por invocação de produção, conservado no JavaScript e nos dois manifestos. O alias version:write faz build completo e os modos serve/test/preview não escrevem esses manifestos. Versões canónicas frontend/Tauri têm de coincidir; a comparação de pré-lançamentos passa a respeitar SemVer. O ID identifica uma invocação e não atesta o conteúdo. IDs explícitos continuam permitidos, sem reutilização para conteúdo diferente.

Passaram 40 testes frontend, 14 Node, oito de gates/publicação, TypeScript/lint e build real. Dev e preview reais foram encerrados, e os testes repetidos depois do build conservaram os hashes. CI/deploy verificam a coerência do manifesto com o entry bundle antes de publicar. As falhas iniciais foram conservadas; suites gerais/Rules e pilotos nativos não foram repetidos. Mantêm-se os critérios das fases 0–6, 49 gates fechados e nenhum deploy. Prova build-identity-local-validation-20261024.json.

## Piloto Android e logging de credenciais — 23 de outubro

O [ensaio nativo](ANDROID_ARMAZENAMENTO_NATIVO_2026-10-23.md) confirma storage/cifra/recuperação após process restart, isolamento por UID, ACK perdido e limpeza em Android emulado, com Auth sintético. O APK final desativa o logger Capacitor que podia incluir argumentos de plugins, conserva as exclusões de backup corretas e tem zero linhas dos campos examinados nos PIDs do ensaio. O wrapper AAB e o gerador de keystore foram endurecidos sem alterar signing existente. Passaram 15 testes de comandos e os três guardas repetidos no fecho. Fonte/artefactos web e suites gerais anteriores conservados; não houve deploy. Continuam os pilotos autenticados/servidor/hardware, acessibilidade em dispositivos, CI remota e restantes fases 0–6, com 49 gates fechados. Prova android-runtime-local-validation-20261023.json.

## Empacotamento Android validado localmente — 23 de outubro

O [build Android](BUILD_ANDROID_VALIDADO_2026-10-23.md) passa agora por uma sequência comum que exige runtimes, testes e build/sync antes de Gradle. Os wrappers recusam parâmetros retirados, exigem versão explícita para release e não escrevem em keystore.properties. O grafo release recusa signing incompleto/versão ausente ou desalinhada. Não se presume o próximo código aceite na Play Console.

Passaram 11 testes de comandos e o percurso Debug real com 1.695 testes frontend/203 ficheiros. O APK 1.0.8 Debug foi inspecionado: 43 ficheiros web coincidem com o dist, zero downloads empacotados e assinatura Debug válida. O dry-run release sem versão foi recusado. Não houve instalação/distribuição ou comparação de certificado release. As suites backend/rules e lint não foram repetidas para esta revisão; CI remota, leitores de ecrã e pilotos de dispositivos continuam pendentes. Prova android-build-local-validation-20261023.json; 49 gates fechados, objetivo completo das fases 0–6 ainda ativo.

## Reversão implementada localmente — 22 de outubro de 2026

A [reversão do titular](AGENT_MUTATION_REVERSAL.md) repõe uma versão cifrada de propostas edit/delete, com confirmação própria, revalidação dos snapshots, recifragem para a época ativa, recibo transacional e journal cifrado. Funciona depois de expirar/revogar/parar o agente, sujeito ao acesso atual do titular e aos gates normais de escrita. A recuperação nunca repete apply automaticamente. O histórico distingue reverted e a proposta original não pode ser reaplicada. O limite de cancelamentos usa quota diária e uma época persistente que retira a autoridade aos pedidos antigos sem gerar recibos ilimitados.

Validação atual: 84 testes focados Functions, 83 testes frontend em cinco ficheiros, 25 testes no emulador, zero omissões nesses conjuntos; TypeScript e lint dos ficheiros afetados passaram. As suites gerais da prova anterior são baseline histórico, sem repetição neste incremento. **49 gates continuam fechados, sem deploy ou declaração de conclusão das fases 0–6.** Os registos anteriores que indicam reversão pendente conservam o seu contexto histórico.


## Continuação local — propostas cifradas revistas, 21 de outubro

O protocolo descrito em [AGENT_MUTATION_APPROVAL.md](AGENT_MUTATION_APPROVAL.md) acrescenta propostas edit/delete para uma memória existente, consentimento memories:write com prefixos mne_review_code_/mne_review_, revisão decifrada no cliente e aprovação transacional vinculada ao digest. API/MCP/SDK não aprovam; criação direta foi retirada. Recibos, quotas, auditoria e recuperação de ACK perdido são locais e ainda não publicados. A reversão continua pendente; não se declara a fase 6 concluída. Os parágrafos de incrementos anteriores conservam o seu estado histórico.


## Continuação local — autorização por cofre pessoal/equipa, 21 de outubro

O [contrato de cofres do agente](AGENT_VAULT_SCOPES.md) acrescenta um cofre exato por consentimento OAuth: pessoal ou uma equipa cujo acesso/época esteja disponível para o titular. Registos administrativos antigos permitem apenas pessoal; equipas exigem opt-in explícito. Preview, código, grant e token vinculam o âmbito, e os hashes/versionamento dos snapshots retiram a autorização depois de alterações/ABA da equipa ou época. A listagem e a revogação identificam o cofre.

O gateway REST/MCP seleciona o backend a partir da credencial, sem escolha por argumentos e sem fallback pessoal para tokens de equipa. A leitura de equipa revalida acesso antes/depois; o gateway revalida a credencial antes de devolver os dados. Os resultados incluem apenas envelopes/metadata permitida e conservam época/key ID. Consulta, corpus e resultado têm limites explícitos de documentos/bytes e paginação; ranking mantém isolamento por modelo.

Equipa usa códigos/tokens com prefixos distintos, recusados pelos parsers pessoais anteriores antes de acesso a dados. O cliente também exige o tipo de código do cofre confirmado, e o gateway compara prefixo/âmbito. Esta separação impede que uma revisão antiga interprete uma credencial nova de equipa como pessoal. O ensaio executou os corpos anteriores com dependências locais atuais; não certifica um serviço antigo publicado.

Foram mantidas chaves permanentes pessoais e compatibilidade de grants antigos sem `vault`, sempre pessoais. O schema acrescenta metadata a coleções existentes, sem regra/índice novo. A publicação exige Functions antes de Hosting e índice/equipas/pilotos verificados antes de habilitar clientes reais. O rollback precisa conservar a validação de cofre. A primeira passagem do emulador identificou o default REST de `limit` convertido para um; a correção e os resultados finais são vinculados no estado de lançamento. A fase 6 continua parcial: escrita aprovada, preview/diff, idempotência/reversão, histórico completo e aceitação em dispositivos permanecem exigidos.

## Continuação local — conta capturada e estado do acesso dos agentes, 21 de outubro

**Problema e ameaça.** Os painéis de acesso/autorizações conservavam trabalho da conta anterior durante uma troca de sessão. A aquisição assíncrona do token Firebase podia associar um pedido à conta nova. Retomar o acesso também não comparava o estado observado: uma confirmação antiga podia reabrir uma paragem posterior. Uma sequência A→B→A no mesmo ciclo de renderização exigia retirar a vista antiga mesmo quando o UID final era igual ao inicial.

**Opções e decisão.** Usar apenas o UID atual no momento da resposta não deteta A→B→A; desabilitar o botão durante o pedido também não vincula o token no servidor. Foi escolhido um UID esperado em todas as cinco callables de controlo/consentimento, comparado com Firebase Auth antes de rate limit ou acesso aos dados. No cliente, o serviço conserva a conta capturada e recusa o resultado após qualquer mudança observada. As vistas ganham uma geração de sessão; o estado, as autorizações, erros e operações pendentes da geração anterior são retirados. O serviço não exige desbloquear o cofre para parar ou revogar acesso.

`setAgentAccess` aceita `{expectedUid, disabled, baseline:{disabled,epoch}}`, sem campos extra, e compara o baseline com o perfil na transação. Parar incrementa a época; retomar conserva-a. É recusado um comando repetido, desatualizado, com estado corrompido ou que excederia o inteiro seguro. Cada transição confirmada regista `schemaVersion:2` e `accessEpoch` no evento imutável já existente. O cliente aceita apenas estado vindo do servidor, sem cache ou escritas pendentes, e não anuncia sucesso otimista. A mensagem de falha diz que a alteração não foi confirmada e pede para verificar o estado.

**Validação.** Passaram 26 casos focados frontend e cinco focados Functions. A suite geral Functions passou 533 testes, com uma omissão prevista. Sete casos no emulador demo passaram sem omissões: marcador de eliminação, ciclo OAuth/PKCE, limite de consentimentos, paragem/reabertura e invalidação dos tokens, concorrência de comandos, estado corrompido/overflow e sessões de leitura. Duas transações concorrentes iguais produzem uma transição/evento; um resume antigo não reabre a paragem nova. O emulador terminou normalmente. Passaram 1.568 testes gerais cliente/194 ficheiros, build e lint com zero erros/23 avisos anteriores. A primeira passagem teve dois timeouts nos testes de paginação; isolamento com quatro casos e repetição geral passaram, sem alterar fontes/testes/limites desse percurso. A causa exata não foi provada e o log inicial foi conservado. Resultados e hashes estão vinculados no estado de lançamento e na prova deste incremento; os testes usam contas e dados sintéticos.

**Schema, migração e rollback.** Nenhuma coleção, regra ou índice foi acrescentado. Campos ausentes do perfil conservam o estado legado permitido/época zero; valores inválidos não são tratados como valores ausentes. O evento recebe dois campos/versionamento novos. O rollout completo já publica Functions antes de Hosting: conservar esta ordem e só habilitar integrações após ambos os componentes e os restantes gates estarem verificados. Clientes antigos sem UID/baseline são recusados e precisam atualizar; há uma janela de indisponibilidade destes controlos durante o rollout. Não se publica apenas o cliente contra um servidor antigo. Um rollback deve conservar as verificações do UID e das épocas; repor o servidor antigo reabre o risco.

**Risco residual e trabalho seguinte.** Uma troca de conta depois de o servidor admitir o pedido não cancela a operação dessa conta; o cliente descarta o resultado. Uma resposta perdida pode corresponder a uma transição já aplicada: este controlo compara estado, não é um protocolo de recibos/retries automáticos. Não cancela leituras já admitidas nem apaga dados já recebidos pelo agente. A fase 6 permanece parcial: faltam scopes de equipa/cofre, proposta de escrita cifrada, preview/diff e confirmação vinculada ao payload, idempotência/reversão de mutações, histórico de pedidos e aceitação em dispositivos. Nenhum gate foi aberto e não houve deploy.

## Continuação local — verificação de email na conta, 17 de outubro

A [verificação de email](VERIFICACAO_EMAIL_CONTACTOS.md) na definição de conta permite pedir a mensagem por ação explícita e atualizar utilizador/token depois da confirmação. Está traduzida nos quatro idiomas. Guardas de conta/endereço/vista retiram callbacks tardios; fechar não recolhe um pedido já admitido. Os 17 testes focados passaram; Chromium executou o painel/serviço com o SDK Auth real no emulador demo, confirmou o código e observou email_verified no token renovado. Não houve envio real de email nem mutação de produção.

A alteração acompanha a admissão de emails verificados na descoberta Comms/diretório/convites. Entrega real/templates/providers, aceitação em dispositivos/leitores e todos os critérios de agentes continuam abertos. Resultados gerais e limites no [estado de lançamento](ESTADO_LANCAMENTO_COMPLETO.md).

## Continuação local — teclado, diálogo modal e fonte local, 16 de outubro

A [validação de teclado](UX_MEMORIA_TECLADO.md) cobre lista/tabela com foco no primeiro resultado novo, inclusive na última página, e Review Inbox com diálogo nativo, fundo inativo, Tab/Shift+Tab contidos, Escape e restauro do foco anterior antes da remoção do DOM. Conserva os guards de UID/cofre/vista e os recibos do backup. O ensaio real encontrou e permitiu corrigir a saída de Tab e a perda de foco no cleanup passivo. A folha de estilos passou a carregar Inter da aplicação, com fonte/licença/origem fixadas; o ensaio confirma o carregamento local e zero pedidos externos.

Não equivale a aceitação por leitor de ecrã ou em Tauri/Capacitor/dispositivos reais. Esses requisitos e os restantes critérios de agentes continuam abertos. Os resultados gerais e limites estão no [estado de lançamento](ESTADO_LANCAMENTO_COMPLETO.md); as secções seguintes conservam decisões anteriores.

## Continuação local — backup/restauro cifrado da Review Inbox, 16 de outubro

A [Review Inbox](REVIEW_INBOX_PRIVADA_RECUPERAVEL.md) permite agora exportar perguntas, agenda, arquivos exatos e origens pendentes num ficheiro cifrado pelo cofre pessoal. A importação exige a mesma conta/cofre, prévia e confirmação do UID, conserva perguntas atuais e apresenta cópias por conflito. As origens recuperadas sem atribuição continuam pendentes e podem ser escolhidas separadamente para revisão explícita. O recibo local é atómico com os dados: depois de uma resposta perdida/reload, confirmar o ficheiro não repete a importação nem desfaz edições posteriores. Históricos importados de outro armazenamento não valem como recibos locais. Repetir exige outro plano confirmado.

Os 61 testes focados e os dois ensaios Chromium passaram, incluindo descarga/leitura reais e restauro entre perfis independentes. Não houve pedidos externos nem mutações de produção. Limites recusam o plano inteiro sem truncagem; exportar não prova durabilidade do ficheiro em disco. Não há sincronização nem inclusão no export Firestore. Os resultados gerais e a prova consolidada desta continuação são registados em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md). A fase 6 continua aberta para agentes, acessibilidade e dispositivos reais; a recuperação operacional do sistema permanece requisito global. Os blocos seguintes conservam decisões e resultados anteriores.

## Continuação local — Review Inbox com UID/CAS e migração explícita, 16 de outubro

A [Review Inbox](REVIEW_INBOX_PRIVADA_RECUPERAVEL.md) passou para corpo cifrado com UID/revisão, CAS em IndexedDB, Web Lock e readback. A origem v1 continua intacta e não é atribuída só por decifrar: há prévia e confirmação explícita da conta. Guarda arquivo exato e mapeia cópias de IDs em conflito. A interface retira saves/loads/callbacks ao mudar UID/cofre/vista e não adota bases novas durante uma edição. Preserva agenda, prioridades e limite 500.

Os 45 testes focados e o ensaio Chromium de duas páginas passaram. A passagem geral final aprovou **1.380 testes frontend/178 ficheiros** e **414 Functions/uma omissão**. TypeScript/build, lint final zero erros/23 avisos anteriores e quatro smokes locais passaram. As regras anteriores 243+23 foram reutilizadas com fontes/artefactos idênticos, sem nova execução de emulador. As evidências consolidadas estão no estado de lançamento. Export/import e restauro da informação local, acessibilidade/dispositivos reais e os restantes critérios de agentes continuam pendentes. **Esta continuação não conclui a fase 6 nem autoriza antecipar o deploy.** Os blocos datados seguintes descrevem versões anteriores, incluindo o antigo array localStorage.

## Atualização — revogação de conta e chaves, 2 de outubro de 2026

Criar/listar/revogar/validar/atualizar uso de chaves de API observa o marcador permanente; limite de dez chaves ativas é serializado transacionalmente. OAuth, sessões delegadas, estado de acesso, ledger e fronteiras das leituras API/MCP recusam contas revogadas. Revogar um grant não cria eventos após a remoção do perfil. Evidência do incremento: **122 unitários Functions e 76 +22 no emulador**. Decisões, legado, limites e pendências em [ADMISSAO_CONTAS_E_OPERACOES_EM_CURSO.md](ADMISSAO_CONTAS_E_OPERACOES_EM_CURSO.md).

Não conclui a fase 6: scopes de equipa, escrita aprovada/reversão, acessibilidade/dispositivos e revisão completa continuam pendentes. A autorização para deploy completo aplica-se depois de cumprir todas as áreas; estado global em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

**Estado em 30 de setembro de 2026: parcial, local, não publicado.**

## Problema e decisão

O Universo 3D não deve ser a única forma de encontrar uma memória. Foram acrescentadas vistas de lista e tabela com pesquisa por teclado e paginação de 100 itens; o componente WebGL não é montado nessas vistas. Conteúdo cifrado ainda bloqueado não entra no texto pesquisável. Isto mantém o Universo como entrada principal e oferece uma alternativa acessível.

A revisão deve ser opcional e não enviar perguntas ou respostas a um serviço. A Review Inbox permite criar uma pergunta manual a partir de uma memória pessoal desbloqueada, editar a pergunta, escolher prioridade, abrir a fonte e marcar uma revisão como “outra vez”, “lembrei-me” ou “fácil”. A agenda é uma heurística simples: dez minutos quando falha; um dia na primeira recordação; depois 1,8× ou 2,5× o intervalo, até 365 dias. Não há pontuação nem alegação de eficácia de retenção.

## Ameaças e limites

Perguntas podem repetir dados sensíveis da memória. O array completo é cifrado com a chave do cofre pessoal antes de entrar em `localStorage`, separado por UID; nenhuma pergunta em claro é gravada. A funcionalidade exige cofre desbloqueado. Se o envelope local não puder ser decifrado, a interface não o sobrescreve automaticamente. Só uma memória pessoal do UID atual, sem partilha e desbloqueada, pode ser fonte de uma nova pergunta. Uma fonte apagada fica indicada como indisponível. Este armazenamento não sincroniza entre dispositivos e não está incluído no export Firestore; limpar dados do browser elimina as perguntas. O agendamento usa o relógio local e pode ser alterado por um relógio incorreto. Não foram ensaiados leitores de ecrã reais nem cofres grandes.

O Agent Gateway continua **read-only**. As chaves de API/MCP têm leitura/pesquisa; escrita e ferramentas de mutação estão bloqueadas. Existem agora sessões curtas, controlo de interrupção e fluxo de consentimento com PKCE no âmbito pessoal. Scopes por cofre/equipa, aprovação de mutações, preview/diff e auditoria completa de agente continuam pendentes. Não se deve anunciar um agente com escrita neste estado.

## Sessões curtas de agente — 27 de setembro

Foi acrescentado `POST /api/v1/agent/session`, autenticado por chave API existente. Emite um segredo aleatório de 256 bits com prefixo `mne_agent_`, expiração de 15 minutos e scopes de leitura/pesquisa que não excedem os da chave original. O servidor guarda somente o hash do segredo como ID, UID, chave de origem, scopes e datas. A resposta tem `Cache-Control: no-store`. O token não pode emitir outro token nem abrir escrita; não existe refresh token.

Em cada utilização, a API revalida expiração, revogação da sessão, chave original, scopes atuais, existência do perfil, marca de eliminação e `agentAccessDisabled`. Mantém o ID da chave original para rate limiting; emitir várias sessões não multiplica o limite. A coleção `agentSessions` não é acessível pelos clientes Firestore e é incluída na eliminação da conta. O campo `deleteAfter` prepara retenção por TTL, mas a política TTL ainda não foi configurada; a expiração é sempre aplicada pela autenticação, independentemente da limpeza.

Esta etapa implementa credenciais delegadas curtas para o âmbito pessoal atual. Não é OAuth/PKCE, não oferece consentimento OAuth, scopes de equipas ou controlo de mutações. Chaves longas devem ficar com o integrador de confiança; entregar a chave longa ao agente elimina parte do benefício do token curto. Revogação é verificada no início de cada pedido, não cancela um pedido já em execução. O princípio de vida curta e escopo reduzido é consistente com a [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html); isto não constitui declaração de conformidade OAuth.

## Interrupção de acesso — 28 de setembro

O painel de API keys inclui Parar/Retomar, traduzido nos quatro idiomas. `setAgentAccess` exige Firebase Auth e obtém o UID exclusivamente do contexto autenticado. A operação grava `agentAccessDisabled`, `agentAccessEpoch` e `agentAccessUpdatedAt` numa transação. Parar bloqueia a autenticação REST/MCP com chaves permanentes e sessões curtas e impede emissão. Cada paragem avança a época; uma sessão anterior nunca volta a ser válida ao retomar. Retomar volta a aceitar chaves permanentes não revogadas. Em caso de comprometimento de uma chave permanente, é necessário revogá-la antes de retomar.

A alternativa de apagar todas as credenciais obrigaria a reconfigurar cada integração. A decisão foi suspender as chaves permanentes e invalidar definitivamente as sessões curtas anteriores. O estado da UI vem do snapshot confirmado pelo servidor; cache offline não prova o estado e não habilita o botão. Falhas são apresentadas com texto fixo. O controlo não cancela pedidos que já passaram a autenticação nem remove dados anteriormente obtidos por um agente.

As regras impedem escritas diretas nos três campos e a eliminação direta de `users/{uid}`, que permitiria recriar o perfil e repor a época. A eliminação de conta continua pelo callable existente, com limpeza pelo Admin SDK. A emissão de sessão e Parar/Retomar criam, na mesma transação, eventos `session-issued`, `access-stopped` e `access-resumed` em `users/{uid}/agentEvents`. Guardam tipo, origem, versão, data e, na emissão, scopes/expiração; não guardam tokens, prompts ou conteúdo. Só o titular lê estes eventos; clientes não os alteram. A eliminação da conta inclui esta coleção. Ainda não existe histórico visual, TTL destes eventos ou auditoria completa de pedidos negados e mutações.

Schema adicional: campos opcionais no perfil, `accessEpoch` nas sessões e a subcoleção de eventos. Perfis/sessões anteriores usam época zero. Não exige índice novo nem backfill. Para publicar, incluir Functions (`publicApi`, `setAgentAccess`, `deleteUserAccount`), regras e frontend numa versão coordenada. Nenhum deploy foi executado. Rollback de segurança deve conservar as verificações de suspensão e época no servidor; uma versão antiga do gateway pode voltar a aceitar credenciais suspensas.

## Validação

### Consentimento com PKCE — 30 de setembro

Foi acrescentado um fluxo separado da delegação por chave de API: página `/agent/authorize`, aplicações registadas pelo Admin, preview autenticado, confirmação explícita, código de dois minutos e troca com S256 em `/api/v1/oauth/token`. Não entrega uma chave permanente ao agente. A troca consome o código e emite token/evento em transação, ligada a UID, aplicação, retorno HTTPS exato, scopes, versão do consentimento e época do kill switch. Reconsentir invalida credenciais anteriores daquela aplicação; revogação individual está no painel de definições. Decisão, threat model, schema, índice, integração, limites e rollback estão em [AGENT_OAUTH_PKCE.md](AGENT_OAUTH_PKCE.md).

Opções consideradas: reutilizar a chave longa exigiria partilhá-la com o agente; reutilizar o desktop bridge não forneceria PKCE ou consentimento explícito. Foi escolhido registo administrativo e fluxo com S256. Não há descoberta, registo dinâmico, refresh, scopes de equipa ou mutações. O limite de vinte autorizações ativas evita que uma listagem truncada esconda consents ativos; a verificação do limite é transacional. Headers contra enquadramento e referrer foram preparados no Hosting, ainda não publicados. O registo de aplicações reais, TTL e índice em produção não foi executado.

Resultados já concluídos nesta alteração:

- `npm --prefix functions test`: **94 passaram**, zero falhas, uma suite de regras ignorada fora do emulador; TypeScript compilou. Parser rejeita scopes de escrita, falta de state/S256, desafio não canónico e retornos inseguros. HTTP verifica limite por IP confiável, emissão no-store, método e erro fixo sem diagnóstico sensível.
- `npx vitest run src/pages/AgentAuthorizationPage.test.tsx src/services/agentAuthorization.test.ts src/components/AgentGrantsPanel.test.tsx src/utils/translations.test.ts`: **12 passaram em 4 ficheiros**. A primeira execução encontrou falha real: erro na revogação escondia a aplicação; foi corrigida, conservando a lista e mostrando erro. Login/preview não autorizam, recusa não emite, troca de conta/logout descartam respostas tardias e callbacks não podem alterar destino/state/issuer.
- `npx tsc -b` e ESLint dos novos componentes, serviços, testes, `ApiKeysPanel.tsx` e catálogo: passaram.
- Suite frontend completa: **313 testes em 75 ficheiros passaram**, 38,95 s. Build TypeScript/Vite passou, **3215 módulos**, 22,32 s de Vite; mantém avisos de chunks grandes e imports mistos.
- Emulador Firebase CLI **15.32.0**, JDK **21.0.12.1**, Firestore **1.22.0**, configuração temporária sem credenciais e projeto **demo-mnemosyne-rules**: **31 testes Functions + 19 frontend passaram**, saída zero. O caso OAuth prova uso único sob duas trocas simultâneas, prova incorreta não consumir o código, bindings, expiração, scopes reduzidos, suspensão/retoma, revogação por titular e registo sem código/token/verifier.
- Após incluir negações explícitas nas regras, limite transacional e filtro de autorizações ativas, nova execução `emulators:exec --only firestore,storage --project demo-mnemosyne-rules "npm --prefix functions run build && node --test --test-name-pattern=OAuth functions/test/rules.test.js"`: **2 testes passaram**, saída zero, emuladores encerrados. Duas aplicações concorrem pela vigésima vaga; somente uma é autorizada. Cento e dez registos revogados não escondem a aplicação ativa na listagem. O novo índice só foi adicionado ao manifesto local, não publicado/verificado em produção.
- Parse JSON de `firebase.json` e `firestore.indexes.json` e parse OpenAPI com `js-yaml` instalado: passaram. Duas tentativas anteriores de encontrar o módulo `yaml` falharam; não foram tratadas como validação. `git diff --check` do manifesto, regras, índice, `index.ts` e `App.tsx`: passou, com avisos Git de conversão futura LF/CRLF.


Em 28 de setembro, após o controlo de interrupção e eventos:

- `npm --prefix functions test`: **91 passaram**, zero falhas, uma suite de regras ignorada fora do emulador; inclui compilação TypeScript.
- `npx vitest run src/components/AgentAccessPanel.test.tsx src/services/apiKeys.test.ts src/utils/translations.test.ts` (frontend): **16 passaram em 3 ficheiros**. Inclui estado desconhecido/offline, confirmação por snapshot, falha sem diagnóstico sensível e limpeza de subscrição.
- `npx tsc -b` (frontend): passou. ESLint de `AgentAccessPanel.tsx`, respetivo teste, `agentAccess.ts`, `ApiKeysPanel.tsx` e `translationCatalog.ts`: passou.
- `node scripts/run-rules-tests.js`: primeira tentativa não executou testes, porque a sandbox recusou acesso npm. A CLI em cache sem credenciais iniciou numa segunda tentativa, mas o download do emulador foi bloqueado. Foi então autorizada a execução local com rede: Firebase CLI **15.31.0**, JDK **21.0.12.1**, projeto **demo-mnemosyne-rules**, `XDG_CONFIG_HOME` e `FIREBASE_EMULATORS_PATH` temporários. O comando `emulators:exec --only firestore,storage --project demo-mnemosyne-rules "npm --prefix functions run build && npm --prefix functions run test:rules && npm --prefix frontend run test:rules"` passou: **30 testes Functions + 19 frontend**, saída zero e emuladores encerrados.
- Caso novo no emulador: UID recebido no payload não seleciona a conta; utilizador sem Auth é recusado; pausa bloqueia chave e sessão; retoma permite a chave mas não a sessão antiga; sessão nova é aceite; cliente não altera época/suspensão nem elimina o perfil; eventos só podem ser lidos pelo titular; conta em eliminação não permite retoma.

Este conjunto não repete o build Vite nem a suite frontend completa. O último resultado completo, anterior a esta alteração, está descrito nas decisões da fase 5; não é tratado como validação do novo painel.

Sessões curtas: **91 testes Functions passaram**, com uma suite de regras ignorada fora do emulador. O emulador passou **29 testes Functions e 19 frontend**. O teste novo cobre expiração exata, recusa de escalada de scopes, recusa de delegação recursiva, revogação da chave de origem, redução dos seus scopes, bloqueio administrativo e negação de acesso Firestore aos registos. O teste HTTP verifica emissão `no-store` e recusa de reemissão com token de agente. Nenhuma sessão foi criada em produção e a nova rota não foi publicada.

`npm --prefix frontend run test -- --run`: 252 testes em 57 ficheiros passaram, incluindo serviço Review Inbox e dois testes de componente: criação com ciphertext local e exclusão de fonte de equipa/bloqueada. `npm --prefix frontend run build` e lint do escopo alterado passaram após o último diff, com os avisos conhecidos de chunks grandes. Os testes só usam memórias sintéticas.

## Migração e rollback

Nenhuma migração de Firestore é necessária para a Review Inbox. Um cliente antigo ignora a chave local cifrada. O rollback perde apenas a interface de revisão, conservando o ciphertext local enquanto o browser o guardar. Antes de publicar, confirmar export/import local das perguntas ou declarar explicitamente a sua natureza descartável, ensaiar acessibilidade e latência em dispositivos reais, e conservar os scopes de escrita da API fechados.



## Resultados locais — fecho de validação em 22 de outubro (Lisboa)

- Node 22.23.3. Nenhum deploy, mutação de produção, chamada generativa ou leitura de payload de secrets neste incremento.
- Em functions/, npm test: 552 aprovados, uma omissão prevista fora do emulador, zero falhas. Esta passagem precedeu a remoção final do ownerUid no agregado de quota da equipa.
- Em functions/, node --test test/agentMutations.test.js test/memoryEdits.test.js test/agentOAuth.test.js test/agentVault.test.js test/mcp.test.js test/publicApi.test.js test/publicSdk.test.js test/apiKeys.test.js test/accountDeletion.test.js: 80 aprovados; repetido depois do ajuste final da quota.
- node W:/real/mnemosyne-launch-evidence/agent-mutation-approval-validation-20261021/run-rules-release.cjs: 27 aprovados, zero omissões, depois do ajuste final. Firestore/Storage privados em 18080/19199; emuladores encerrados normalmente.
- Em frontend/, npx vitest run src/services/agentMutations.test.ts src/components/AgentMutationsPanel.test.tsx src/services/memoryEditRecovery.test.ts src/services/agentAuthorization.test.ts src/services/agentAccount.test.ts: 64 aprovados em cinco ficheiros.
- node W:/real/mnemosyne-launch-evidence/agent-mutation-approval-validation-20261021/run-local.cjs frontend-general-release: 1.595 aprovados em 196 ficheiros, com --maxWorkers=1. A primeira passagem, com quatro workers em simultâneo com outras validações, teve dois timeouts de paginação e uma espera falhada pelo botão de importação de cápsulas. Conservam-se ambos os logs; não se alteraram testes de frontend, timeouts ou produto para repetir a suite.
- TypeScript tsc -b e npm --prefix frontend run build passaram. Lint integral: zero erros, 23 avisos anteriores. Build independente do SDK passou; não foi publicado.
- node --test scripts/release-gates-preflight.test.js scripts/sdk-mutation-boundary.test.js: 13 aprovados. Preflight: 49 gates fechados (saída 2 esperada). A fronteira de mutações Firestore no frontend examinou 302 fontes sem ocorrências.
- O ensaio dos corpos anteriores dos parsers recusou código/token mne_review_ antes de dados. O OpenAPI foi lido como YAML e verificado quanto aos novos endpoints/schemas; não se afirma validação formal integral nem teste contra uma revisão antiga publicada.
- O scan Gitleaks dos 42 ficheiros deste incremento não encontrou credenciais por resolver. Uma ocorrência é um UUID sintético fixo, cuja linha já existia no before-image; não se acrescentaram ignores globais. O scan final e os hashes integram a prova local.

A reversão continua por implementar. Os créditos Gemini permanecem adiados pelo operador e o fornecedor inativo. O pedido das credenciais Stripe novas continua pendente. Índices/TTL, dados, alertas, CI remota, fornecedores e pilotos de plataformas continuam requisitos do lançamento completo. Estes resultados não abrem os gates nem declaram todas as fases concluídas.

## Comandos do incremento de reversão — 22 de outubro

- Node 22.23.3: npm --prefix functions run build — passou.
- Em functions/: node --test test/agentReversals.test.js test/agentMutations.test.js test/memoryEdits.test.js test/agentOAuth.test.js test/agentVault.test.js test/mcp.test.js test/publicApi.test.js test/publicSdk.test.js test/apiKeys.test.js test/accountDeletion.test.js — 84 aprovados.
- node W:/real/mnemosyne-launch-evidence/agent-mutation-reversal-validation-20261022/run-rules-release.cjs — 25 aprovados, zero omissões; emuladores privados encerrados.
- Em frontend/: npx vitest run src/components/AgentReversalPanel.test.tsx src/components/AgentMutationsPanel.test.tsx src/services/agentReversalRecovery.test.ts src/services/agentMutations.test.ts src/services/memoryEditRecovery.test.ts --maxWorkers=1 — 83 aprovados em cinco ficheiros.
- Em frontend/: npx tsc -b — passou. npx eslint nos oito ficheiros frontend afetados de produção/teste — zero erros e avisos. Logs e before-images em W:/real/mnemosyne-launch-evidence/agent-mutation-reversal-validation-20261022. A prova inclui os nomes exatos dos ficheiros validados.
- As passagens iniciais (23 Functions, 68/76/82 frontend, 21/22/24 regras) foram conservadas; os conjuntos finais acima incluem os controlos/casos adicionados. Não se somam estas contagens como casos distintos.

O [documento da reversão](AGENT_MUTATION_REVERSAL.md) contém threat model, opções, schema/regras, migração, rollback e riscos residuais. Não foram criadas dependências, coleções ou configurações em produção neste incremento.

O build frontend (npm --prefix frontend run build) passou. Após acrescentar o caso de timestamps reais, TypeScript e lint dos ficheiros afetados foram repetidos e passaram. A passagem final do emulador preservou timestamps entre snapshots independentes; a suite frontend final teve 83 casos. O OpenAPI foi novamente lido como YAML e o parser anterior recusou o novo estado reverted em memória, sem se testar uma revisão antiga publicada.
