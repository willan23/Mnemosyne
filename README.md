# Mnemosyne

Retenção de 29 de outubro: [envelopes de sync com prova transacional e cursor recuperável](docs/RETENCAO_SYNC_COM_RECIBOS_2026-10-29.md). Retirada a purga de tombstones baseada numa lista incompleta de ACKs; o problema foi reproduzido com dados sintéticos. Passaram 16 testes focados, 599 Functions gerais (uma omissão prevista) e a repetição integral **325 Functions/Rules +25 frontend/Rules**, sem falhas/omissões e com fecho confirmado. A área de retenção ainda exige expiração, recuperação, dependências e pilotos. OpenRouter pago económico está autorizado e aguarda saldo, conforme a [decisão atual](docs/FORNECEDORES_ATIVOS_LANCAMENTO.md). 49 gates fechados e sem deploy.

Importações de 29 de outubro: [captura apenas de metadata semântica em lotes](docs/CAPTURA_SEMANTICA_IMPORTACOES_2026-10-29.md), ligada a aprendizagem, revisões, cápsulas, documentos, Comms e pesquisa web. Passaram 2.137 testes/229 ficheiros, 82 focados, build/lint e Chromium com 10.000 registos sintéticos. Não se copia conteúdo das memórias existentes; packs reutilizam a base e o posicionamento documental também cede tarefas. Os percursos ainda são lineares, e migrações, qualidade e pilotos continuam exigidos; 49 gates fechados e sem deploy.

Prévia de captura de 29 de outubro: [memórias relacionadas calculadas num Worker local](docs/PREVIA_DE_CAPTURA_NO_WORKER_2026-10-29.md). Passaram 2.121 testes/228 ficheiros, 46 focados, build/lint e Chromium com 10.000 registos sintéticos. Consultas sobre a mesma origem reutilizam o índice sem nova projeção; uma edição projeta apenas o documento alterado. Filtros explícitos também se aplicam ao fallback lexical. Mudanças de conta/equipa/chave retiram resultados e plaintext do Worker. Preparação inicial, restantes áreas e pilotos mantêm-se em aberto; 49 gates fechados e sem deploy.

Escrita semântica validada em 28–29 de outubro: [vizinhos calculados num Worker com lotes limitados](docs/ESCRITA_SEMANTICA_EM_LOTES_2026-10-28.md), ligados à captura e edição no Universo. Passaram 2.093 testes/225 ficheiros, 93 focados, build/lint e Chromium com 10.000 registos sintéticos, paridade de resultados e cancelamento. A revisão dos candidatos impede guardar um resultado de edição ultrapassado. Preparação linear em tarefas, restantes percursos e pilotos continuam em aberto; 49 gates fechados e sem deploy.

Seleção de vistas de 28 de outubro: [lista, tabela e seleção do Universo num Worker local](docs/SELECAO_DE_VISTAS_NO_WORKER_2026-10-28.md). Passaram 2.066 testes/223 ficheiros, build, lint e Chromium com a lista real e o Worker compilado para 10.000 memórias sintéticas. As projeções inalteradas são reutilizadas; a seleção mantém ordenação, filtros, orçamento visual e foco entre páginas. Respostas antigas e mudanças de chave retiram os resultados e o Worker. A preparação dos IDs ainda é linear em tarefas, e outras áreas/pilotos continuam por concluir; 49 gates fechados e sem deploy.

Validação de snapshots de 27 de outubro: [cache e publicação incremental nos dois hooks da aplicação](docs/SNAPSHOTS_E_PUBLICACAO_INCREMENTAIS_2026-10-27.md). Passaram 2.025 testes frontend/220 ficheiros, 127 focados e Chromium com 10.000 documentos sintéticos. Uma edição mapeia apenas o documento alterado; a lista é construída em tarefas canceláveis. Corrigida a limpeza imediata após recusa de uma equipa. Materialização completa, carregamento inicial, outros percursos da UI e requisitos operacionais continuam por concluir; 49 gates fechados e sem deploy.

Validação de 27 de outubro: [expansão limitada de contexto e conjunto independente](docs/RECUPERACAO_CONTEXTO_LIMITADO_2026-10-27.md). O Worker passou com 10.000 documentos e atualizações incrementais, 1.933 testes frontend, build e lint. A expansão incluiu toda a evidência das perguntas positivas novas, mas a classificação posterior perdeu cobertura e foi recusada; UI e ranking atual conservados. A nova API local ainda não é chamada pela pesquisa. Qualidade ampla, restantes áreas e 49 gates continuam pendentes; sem deploy.

Avaliação de qualidade de 26 de outubro: [coevidência local e limites de recuperação](docs/AVALIACAO_COEVIDENCIA_LOCAL_2026-10-26.md). A experiência com pares melhorou a cobertura multi-hop face ao filtro individual, mas ainda perdeu resultados face ao produto e foi recusada para integração. Os 16 testes e 252 perguntas offline identificaram fontes ausentes no conjunto inicial de candidatos. Runtime, artefactos e limiares do produto foram preservados; qualidade ampla e restantes critérios continuam por concluir.

Atualização do modelo de 26 de outubro: [padrão multilingue para novas memórias](docs/MODELO_MULTILINGUE_PADRAO_2026-10-26.md), com revisão fixa e marcador coerente com o loader/contrato de publicação. Vetores sem marcador mantêm a interpretação legada. O reset por conta/cofre termina todos os perfis e recusa respostas já resolvidas antes do bloqueio. Passaram 1841 testes frontend, 594 Functions, build/lint e inferência real em quatro idiomas no Chromium isolado. Modelo/caches locais verificados; migração operacional, qualidade ampla, plataformas e restantes fases continuam exigidos. Sem deploy.

Atualização de interface de 26 de outubro: [publicação, histórico e recuperação de embeddings](docs/INTERFACE_PUBLICACAO_EMBEDDINGS_2026-10-26.md). O painel permite rever um lote preparado, consultar versões por páginas, confirmar rollback e exportar/importar um pedido cifrado pendente. Passaram 1837 testes frontend (incluindo os 60 do escopo focado), dois testes com SDK Firestore real em emulador isolado, build/lint e recuperação/rollback no Chromium com cifra/storage reais e CSS do build final. A identidade e o vetor do browser são sintéticos; gates, modelo global e restantes critérios continuam pendentes. Sem deploy.

Atualização de retoma de 25 de outubro: [serviço cliente de publicação de vetores com journal cifrado](docs/JOURNAL_RECUPERAVEL_EMBEDDINGS_2026-10-25.md). Passaram 63 testes focados, TypeScript/lint e reload Chromium com cifra/IndexedDB/localStorage/Web Locks reais. Um ACK perdido foi recuperado sem reenviar o vetor. Identidade/vetor e transações de browser são sintéticos; UI, limpeza local e migração global continuam pendentes. Assets conservados e sem deploy.

Atualização de migração de 25 de outubro: [protocolo servidor para publicar e reverter vetores pessoais](docs/REVISOES_RECUPERAVEIS_EMBEDDINGS_2026-10-25.md). CAS, histórico e recibos preservam cifra, grafo e anexos. Passaram 18 testes focados, 591 Functions gerais e a suite integral final 322 Functions/Rules +23 frontend/Rules, sem falhas/omissões. Integração do journal/UI do cliente e migração global continuam por concluir; gates fechados e sem deploy.

Atualização de pesquisa de 25 de outubro: [consultas encaminhadas pelo espaço dos vetores persistidos](docs/PESQUISA_POR_ESPACOS_DE_EMBEDDING_2026-10-25.md). Corrigida a perda de memórias versionadas sem checkpoint local; cada modelo reconhecido recebe a sua própria consulta. Passaram 56 testes focados, 1798 frontend, 48 backend, build/lint e inferência dos dois modelos reais num Chromium isolado. Modelo global, publicação CAS/rollback dos vetores, qualidade e restantes áreas continuam por concluir; sem deploy.

Atualização de IA de 25 de outubro: [OpenRouter exclusivamente gratuito](docs/OPENROUTER_GRATUITO_2026-10-25.md). A candidata permite apenas Gemma 4 31B `:free` via Google AI Studio, com tetos de preço zero e sem fallback; os restantes fornecedores ficam inativos. Chave transferida para Secret Manager e valores em claro retirados do `.env`. Três pedidos reais receberam 429, incluindo o ensaio do transporte corrigido; a disponibilidade de geração ainda não está validada e o uso reportado continua 0 USD. Restantes fases/gates e testes operacionais continuam exigidos; sem deploy.

Segurança HTTP de 25 de outubro: [dependências e transporte corrigidos nas Functions](docs/DEPENDENCIAS_HTTP_NODE22_2026-10-25.md). A nova auditoria encontrou body-parser/undici vulneráveis; foram atualizados e o transporte passou ao fetch explícito da biblioteca corrigida. O audit posterior voltou a zero vulnerabilidades de produção. Passaram 26 testes de transporte/adaptadores, incluindo três processos isolados com HTTP malformado, 580 testes gerais Functions, com uma omissão prevista de Rules, e a suite integral final de 316 Functions/Rules +23 frontend, sem falhas/omissões. Restantes áreas e CI remoto pendentes; sem deploy.

Atualização de pesquisa de 25 de outubro: [revisões fixadas e runtime local sob a política de segurança](docs/PESQUISA_RELEVANCIA_LOCAL_E_REVISOES_2026-10-25.md). Corrigida a descoberta por main, o carregamento ONNX em CDN/blob e a origem de modelo ausente da CSP nativa. Passaram 19 testes, build/lint e inferência real num Worker Chromium sob a política nativa. O novo verificador de relevância foi avaliado, mas não integrado por perder cobertura noutros tipos de pesquisa. Migração global, plataformas e restantes fases continuam pendentes; sem deploy.

Atualização Windows de 25 de outubro: [backup da nova chave e recuperação verificada](docs/MIGRACAO_CHAVE_UPDATER_WINDOWS_2026-10-24.md#recuperação-a-partir-do-secret-manager--25-de-outubro). O Secret Manager conserva a época 2 em europe-west1; um processo novo recuperou a chave e passou uma assinatura de desafio. O workflow foi preparado para compilar sem chave e assiná-la só no empacotamento. Secret GitHub/CI remota, pilotos de instalação/atualização e restantes fases continuam pendentes; sem deploy.

Atualização Windows de 24 de outubro: [candidata 1.0.9, nova chave e instalação manual para versões antigas](docs/MIGRACAO_CHAVE_UPDATER_WINDOWS_2026-10-24.md). O updater JavaScript ficou alinhado com Rust 2.14.0 e o preflight cobre os quatro plugins. Nova custódia DPAPI e canal v2 preservam o feed 1.0.8. Passaram 55 testes frontend e 68 Node; MSI/NSIS foram assinados e verificados, e o executável final passou WebView2 com aviso nos quatro idiomas e destino de download correto. A preparação com ficheiros reais passou em mirror isolada, conservando os downloads do checkout. Pilotos de instalação/atualização, custódia recuperável, CI remota e restantes fases continuam exigidos; sem deploy.

Atualização de 24 de outubro, versões: [identidade própria por build e manifesto coerente com o JavaScript](docs/IDENTIDADE_BUILD_E_ATUALIZACOES_2026-10-24.md). Passaram 40 testes frontend, 14 Node, oito de publicação, TypeScript/lint e build real pelo alias version:write. Vite dev, preview e testes posteriores conservaram os manifestos; CI/deploy verificam a coerência antes de publicar. Restantes fases 0–6 e pilotos operacionais mantêm-se pendentes; sem deploy.

Atualização de 24 de outubro, geração: [HTTP direto nas Functions regionais e deadlines coerentes](docs/GERACAO_HTTP_REGIONAL_2026-10-24.md). Passaram 70 testes frontend, 32 Functions, TypeScript/lint e o ensaio Chromium com resposta sintética acima de 60 segundos/CORS real. Disponibilidade de imagem NVIDIA, runtime publicado e restantes critérios das fases 0–6 continuam por verificar; sem deploy.

Atualização de 24 de outubro, índice: [alterações incrementais de Firestore](docs/ACTUALIZACOES_INCREMENTAIS_INDICE_2026-10-24.md), com autorização, revisão vinculada e reconstrução após expirar o journal. Passaram 99 testes frontend, cinco Node de escrita de versões, TypeScript/lint e ensaio Chromium com Worker compilado/10.000 registos. Permanecem percursos O(N) da UI e os restantes critérios das fases 0–6; sem deploy.

Atualização de 24 de outubro: [cache temporária de checkpoints validados na pesquisa](docs/CACHE_PESQUISA_CHECKPOINTS_2026-10-24.md), com invalidação por conta/cofre/perfil e entre separadores. Passaram 50 testes focados, build, lint do âmbito e ensaio Chromium com cifra/IndexedDB reais. A fase 5 e os restantes critérios de lançamento permanecem em aberto; não houve deploy.

Baseline integral de 23 de outubro: [315 testes Functions/Rules e 23 frontend Rules](docs/VALIDACAO_INTEGRAL_RULES_2026-10-23.md) passaram, sem falhas/omissões, em Node 22/JDK 21/projeto demo. CLI fixada em 15.34.0; audits de produção atuais com zero vulnerabilidades nos dois packages. A [decisão da fase 0](docs/DECISOES_FASE0.md) distingue execução local de CI remoto/checks obrigatórios ainda por comprovar. Os 49 gates e restantes critérios mantêm-se antes do deploy completo.

Continuação Android de 23 de outubro: [armazenamento nativo e privacidade dos logs](docs/ANDROID_ARMAZENAMENTO_NATIVO_2026-10-23.md). O piloto em AVD isolado passou persistência após paragem do processo, proteção de credenciais e limpeza por UID, com Auth sintético e APIs Android reais. O SDK logger está desativado no novo APK. Wrapper AAB e gerador de keystore corrigidos. Pilotos autenticados/cloud e aparelhos físicos continuam exigidos; não publicado.

Atualização Android de 23 de outubro: [build com versão explícita e paragem em falhas](docs/BUILD_ANDROID_VALIDADO_2026-10-23.md). Passaram os 1.695 testes frontend e o build Debug real; 43 ficheiros web do APK coincidem com o dist e a assinatura Debug foi verificada. Instalação em dispositivo, certificado de distribuição, Play Console e restantes critérios do lançamento continuam pendentes. Não publicado.

Atualização local de 23 de outubro: [comandos públicos e runtime legado](docs/RUNTIME_LEGADO_E_ENTRADAS_2026-10-23.md). Foram retirados os atalhos Python e os comandos Functions que herdavam o projeto Firebase por omissão. O preflight de publicação verifica agora esses pontos de entrada antes dos gates e das consultas remotas. Os 49 gates continuam fechados; as fases 0–6 e os critérios operacionais continuam exigidos para o lançamento completo.

Continuação local de 18 de outubro: [emparelhamento recuperável](docs/EMPARELHAMENTO_RECUPERAVEL.md), com chaves/pedidos cifrados antes do envio, retoma após falha/reload, credencial e arquivos cifrados e negação das cinco escritas SDK antigas. As validações locais passaram; classificação operacional, exportação global de chaves e pilotos em hardware/rede continuam exigidos.

Etapa de servidor de 17 de outubro: [emparelhamento de dispositivos](docs/EMPARELHAMENTO_DISPOSITIVOS_SERVIDOR.md), com expiração/quotas, confiança e cancelamento transacionais e revogação permanente. A integração recuperável dos clientes e o corte das escritas SDK antigas continuam por concluir; o gate novo permanece fechado.

Continuação de 17 de outubro: [publicação de identidade pelo servidor](docs/PUBLICACAO_IDENTIDADE_COMMS.md) e [email verificado nos contactos e convites](docs/VERIFICACAO_EMAIL_CONTACTOS.md). Verificação por ação explícita na conta; testes locais com SDK Auth real num emulador demo. Gates fechados e critérios operacionais de lançamento ainda abertos.

Continuação local: [Review Inbox com UID/CAS, migração explícita e backup cifrado](docs/REVIEW_INBOX_PRIVADA_RECUPERAVEL.md), preservando perguntas, agenda e arquivos. O restauro manual foi ensaiado entre perfis independentes; [navegação por teclado](docs/UX_MEMORIA_TECLADO.md), foco modal e fonte local foram verificados em Chromium. Agentes, recuperação operacional do sistema e aceitação por leitores de ecrã/dispositivos reais continuam pendentes no programa de lançamento completo.

> Implementação local atual: [histórico de equipa recuperável](docs/RECIFRAGEM_HISTORICO_EQUIPAS.md), [migração pessoal](docs/MIGRACAO_PESSOAL_RECUPERAVEL.md), [conflitos de sincronização](docs/RESOLUCAO_CIFRADA_CONFLITOS_SYNC.md), [relações](docs/RELACOES_SEMANTICAS_RECUPERAVEIS.md), [agrupamentos](docs/AGRUPAMENTOS_RECUPERAVEIS.md), [ligações recíprocas de equipa](docs/LIGACOES_EQUIPAS_RECUPERAVEIS.md), [criação textual](docs/CRIACAO_TEXTO_EQUIPAS_RECUPERAVEL.md) e [edição/apagamento](docs/EDICAO_MEMORIAS_RECUPERAVEL.md). O [estado do lançamento completo](docs/ESTADO_LANCAMENTO_COMPLETO.md), atualizado em 26/10/2026, conserva os resultados e as áreas ainda pendentes. Não publicado.

Sistema de memória cognitiva espacial. O ecrã principal é o **Universo 3D** — não há vista “Flow”.

[mnemosyne-one.com](https://mnemosyne-one.com) · [app (Firebase Hosting)](https://mnemosyne-one.web.app) · [desktop Windows](https://mnemosyne-one.web.app/download) · [/security](https://mnemosyne-one.web.app/security) · [/enterprise](https://mnemosyne-one.web.app/enterprise) · [/changelog](https://mnemosyne-one.web.app/changelog)

React 19 · TypeScript · Three.js · Firebase · Tauri 2 (Windows) · Capacitor (Android, ainda não na Play Store)

Estado do trabalho de lançamento completo: [ESTADO_LANCAMENTO_COMPLETO.md](docs/ESTADO_LANCAMENTO_COMPLETO.md). Resolução de conflitos da identidade Comms: [COMMS_IDENTIDADE_CONFLITOS.md](docs/COMMS_IDENTIDADE_CONFLITOS.md).

Backup e recuperação de identidades Comms: [COMMS_BACKUP_IDENTIDADES.md](docs/COMMS_BACKUP_IDENTIDADES.md).

---

## O que o produto faz

- **Universo** — memórias como nós 3D; captura, pesquisa e grafo no mesmo ecrã.
- **Cifra do cofre** — texto e título das novas memórias são cifrados no cliente (AES-GCM-256, chave derivada da mnemónica BIP-39). O Firestore guarda `enc:{v,iv,ct}`. Embeddings e metadados do grafo ficam em claro; documentos históricos ainda podem conter campos em claro até migração (limites em `/security`).
- **API REST + MCP** — keys Bearer criadas na conta para leitura e pesquisa. Escritas por agentes estão suspensas no lançamento pessoal; o servidor **não** deriva a mnemónica nem decifra o cofre.
- **Clipper** — extensão Manifest V3 (Chrome/Edge): título, URL e seleção → web app. A cifra acontece depois do vault aberto.
- **Hotkey** — `Ctrl+Shift+M` (desktop Tauri global; no browser só com o separador focado) foca a captura no Universo.
- **Equipas** — espaços existentes em modo de leitura no lançamento pessoal. Criação, convites e novas memórias de equipa ficam suspensos até haver rotação segura da chave após saída de membros.
- **Anexos** — anexos existentes continuam legíveis; novos uploads ficam suspensos no lançamento pessoal. O fluxo anterior guardava ficheiros sem cifra do cofre e URLs de download com token.
- **Export soberano** — ZIP local (JSON + manifest + grafo) com texto já decifrado; passphrase opcional.
- **Idiomas** — pt-PT, pt-BR, inglês, francês na app e páginas públicas. Sem espanhol.
- **Desktop Windows** — Tauri; installers em `/downloads`, updater em `/desktop/latest.json`.

Stripe Checkout / Billing Portal existe no código e **não está activo em produção** (Founder Preview / free-first).

---

## Arranque local

Usa **Node 22** para reproduzir o runtime das Functions e os jobs de CI; confirma com `node --version`. Instala dependências com `--include=optional` para evitar que uma configuração global `omit=optional` retire SDKs/binários necessários. As correções transitivas e a evidência de runtime estão em `docs/DEPENDENCIAS_NODE22_2026-10-01.md`.

Os testes de Firestore/Storage Rules usam o Firebase Emulator e exigem **Node 22** e **JDK 21 ou superior**. Define `JAVA_HOME` para um JDK 21+ e confirma com `node scripts/preflight-node.js` e `node scripts/preflight-java.js` antes de `node scripts/run-rules-tests.js`. O runner verifica ambos antes de iniciar os emuladores, para recusar um fallback do PATH para outra versão de Node.

```powershell
cd W:\real\Mnemosyne\frontend
npm ci --include=optional
npm run dev
```

```powershell
cd W:\real\Mnemosyne\functions
npm ci --include=optional
npm test
```

Para validar as regras e operações de servidor com dados sintéticos no projeto demo explícito:

```powershell
cd W:\real\Mnemosyne
npm run test:firestore-rules
```

O frontend usa o projeto Firebase configurado, por omissão `mnemosyne-one`. `npm run dev` não inicia um sandbox de dados nem emuladores de Functions. As políticas de cloud e o consentimento continuam aplicáveis. O runner de regras inicia Firestore/Storage no projeto `demo-mnemosyne-rules`; não oferece uma sessão interativa de Functions com credenciais de produção.

`backend`/`backend:install` e os scripts Functions `serve`/`shell`/`start`/`logs` foram retirados. O backend Python e a extração antiga já não fazem parte desta revisão. Usa os comandos de build/testes acima e o procedimento explícito de publicação abaixo. A observabilidade operacional tem configuração própria em [OBSERVABILIDADE_IA_E_ALERTAS.md](docs/OBSERVABILIDADE_IA_E_ALERTAS.md).

Não commits `.env`, `.secret.local`, `backend/.env` residual ou `updater.key`. Os ZIP de entrada da auditoria são preservados localmente e ficam fora do conjunto revisto para Git. A política de ignore não remove ficheiros, não revoga credenciais e não limpa históricos.

---

## Deploy

O objetivo atual é concluir todas as áreas das fases 0–6 e executar depois o deploy completo. Consultar o [estado do lançamento](docs/ESTADO_LANCAMENTO_COMPLETO.md) e o [procedimento de publicação](docs/PROCEDIMENTO_DEPLOY_COMPLETO.md). Os registos de lançamento pessoal de setembro conservam o contexto histórico.

`deploy.ps1` exige projeto explícito, executa preflights/build/lint/testes/audits e para na primeira falha. O estado atual dos gates recusa a publicação completa. Para verificar os pré-requisitos:

```powershell
cd W:\real\Mnemosyne
.\deploy.ps1 -Project mnemosyne-one -PreflightOnly
```

Depois de concluir a auditoria e os critérios de rollout, omitir `-PreflightOnly` executa a sequência de publicação já autorizada. A conclusão dos comandos ainda exige smokes e verificação real dos clientes/artefactos. Code signing Windows: [`docs/WINDOWS_CODE_SIGNING.md`](docs/WINDOWS_CODE_SIGNING.md).

---

## Documentação

O que um developer lê primeiro: este README, [`docs/README.md`](docs/README.md), [`docs/MNEMOSYNE_DOCUMENTO_GERAL_DO_SISTEMA.md`](docs/MNEMOSYNE_DOCUMENTO_GERAL_DO_SISTEMA.md).

A criação pessoal recuperável e os limites do rollout estão em [`docs/CRIACAO_PESSOAL_RECUPERAVEL.md`](docs/CRIACAO_PESSOAL_RECUPERAVEL.md).

A pesquisa web, os limites de transporte e a recuperação de gravação estão em [`docs/PESQUISA_WEB_RECUPERAVEL.md`](docs/PESQUISA_WEB_RECUPERAVEL.md).

A revisão pessoal com baseline do rascunho, diário cifrado e recuperação após perda de confirmação está em [`docs/REVISAO_PESSOAL_RECUPERAVEL.md`](docs/REVISAO_PESSOAL_RECUPERAVEL.md).

A importação simples do Comms com IDs próprios, anexos cifrados e confirmação recuperável está em [`docs/IMPORTACAO_COMMS_RECUPERAVEL.md`](docs/IMPORTACAO_COMMS_RECUPERAVEL.md).

A captura conserva texto, imagem e base da revisão num rascunho local cifrado por UID, com limites descritos em [`docs/RASCUNHOS_CIFRADOS_CAPTURA.md`](docs/RASCUNHOS_CIFRADOS_CAPTURA.md).

A publicação e cache da identidade Comms, com contexto capturado e limites de regeneração, estão em [`docs/COMMS_IDENTIDADE_CONTEXTUAL.md`](docs/COMMS_IDENTIDADE_CONTEXTUAL.md).

A troca recuperável, conservação cifrada das identidades e abertura de mensagens/envelopes de equipa anteriores estão em [`docs/COMMS_IDENTIDADE_RECUPERAVEL.md`](docs/COMMS_IDENTIDADE_RECUPERAVEL.md).

A resolução pontual de destinatários, pedidos de contacto recuperáveis e o cutover das regras estão em [`docs/COMMS_CONTACTOS_RECUPERAVEIS.md`](docs/COMMS_CONTACTOS_RECUPERAVEIS.md).
Os guards de envio/sinalização, vínculo do peer e limites do cliente estão em [`docs/COMMS_TRANSPORTE_CONTEXTUAL.md`](docs/COMMS_TRANSPORTE_CONTEXTUAL.md). O relay com diário cifrado, admissão/quotas atómicas, cancelamento e ACK está em [`docs/COMMS_ENTREGA_RECUPERAVEL.md`](docs/COMMS_ENTREGA_RECUPERAVEL.md). As cinco listas paginadas estão em [`docs/COMMS_LISTAS_PAGINADAS.md`](docs/COMMS_LISTAS_PAGINADAS.md). SDP/ICE/fecho no servidor e recuperação estão em [`docs/COMMS_P2P_SINALIZACAO_RECUPERAVEL.md`](docs/COMMS_P2P_SINALIZACAO_RECUPERAVEL.md); o diário de conteúdo, ACK durável, fragmentação/retoma e inbox local estão em [`docs/COMMS_P2P_ENTREGA_RECUPERAVEL.md`](docs/COMMS_P2P_ENTREGA_RECUPERAVEL.md). A expiração/reconciliação v2 está em [`docs/COMMS_P2P_EXPIRACAO_RECONCILIACAO.md`](docs/COMMS_P2P_EXPIRACAO_RECONCILIACAO.md). O inventário e a reconciliação do legado/órfãos estão em [`docs/COMMS_P2P_LEGADO_RECONCILIACAO.md`](docs/COMMS_P2P_LEGADO_RECONCILIACAO.md); aplicação real, cutover/pilotos e fases restantes continuam pendentes. A recuperação de pedidos com destinatário eliminado está em [`docs/COMMS_CONTACTOS_DESTINATARIO_ELIMINADO.md`](docs/COMMS_CONTACTOS_DESTINATARIO_ELIMINADO.md). O UID capturado nos comandos de contactos está em [`docs/COMMS_CONTACTOS_UID_CAPTURADO.md`](docs/COMMS_CONTACTOS_UID_CAPTURADO.md). A remoção recuperável de contactos aceites está em [`docs/COMMS_REMOCAO_CONTACTOS_RECUPERAVEL.md`](docs/COMMS_REMOCAO_CONTACTOS_RECUPERAVEL.md). O diretório independente e a procura pontual de contactos aceites estão em [`docs/COMMS_DIRETORIO_CONTACTOS_ACEITES.md`](docs/COMMS_DIRETORIO_CONTACTOS_ACEITES.md). O isolamento de cópias locais indisponíveis está em [`docs/COMMS_P2P_INBOX_INDISPONIVEIS.md`](docs/COMMS_P2P_INBOX_INDISPONIVEIS.md).

A importação integral de cápsulas e o registo final estão em [`docs/IMPORTACAO_CAPSULAS_RECUPERAVEL.md`](docs/IMPORTACAO_CAPSULAS_RECUPERAVEL.md).

Licença: proprietária / open-core. Contacto comercial: [mnemosyne-one.com](https://mnemosyne-one.com).



