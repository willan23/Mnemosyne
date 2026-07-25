# Mnemosyne WAF System Review

Data: 2026-05-12
Base auditada: `W:\real\SaaS`
Repositorios de referencia: `W:\real\Celestia-master`, `W:\real\d3-celestial-master`, `W:\real\space3d-master`, `W:\real\Ising-Decoding-main`

Nota: neste documento, WAF significa Well-Architected Framework. Se for necessario um Web Application Firewall literal, a recomendacao fica separada no pilar de seguranca.

## Resumo executivo

O Mnemosyne esta arquitetonicamente acima de um prototipo comum: ja tem identidade Zero-Knowledge, BIP39, cofres locais cifrados, AI Hub com consentimento, embeddings locais, grafo 3D, Mobile Sync cifrado, regras Firestore robustas para varios fluxos e monetizacao Stripe endurecida.

O principal risco ja nao e "falta de visao"; e sim transformar a visao em produto verificavel. Os proximos ganhos devem vir de hardening, observabilidade sem conteudo privado, performance do universo 3D e validacao ponta-a-ponta. Os quatro repositorios externos podem acelerar isto, mas nao devem ser copiados indiscriminadamente por causa de licencas copyleft e diferencas tecnologicas.

Prioridades recomendadas:

1. Fechar riscos de exposicao: CORS aberto no backend, `shares` publicas, logs que possam conter dados sensiveis, App Check/rate limiting.
2. Pivot Free-first: abrir o core gratuito para ganhar mercado, mantendo Stripe/gating em modo latente.
3. Validar fluxos reais: dois utilizadores, dois dispositivos, WebRTC/relay, Android real e Stripe apenas como infraestrutura futura.
4. Evoluir o universo 3D com LOD, camera/navigation model e catalogo espacial inspirados no Celestia.
5. Usar `d3-celestial` como base permissiva para minimapa/sky projection/constellations cognitivas.
6. Usar `Ising-Decoding` como inspiracao para um motor de correcao cognitiva: detectar sindromes, reduzir ruido, depois aplicar reconciliacao deterministica.
7. Usar `space3d` apenas como referencia visual/offline pipeline, nao como dependencia direta no produto comercial sem decisao de licenca.

## Pivot Free-first

Recomendacao estrategica: o Mnemosyne deve entrar no mercado como produto gratuito completo na fase Founder Preview/Sovereign Beta. A monetizacao deve ser reativada apenas depois de tracao real, sem retirar o core que criou confianca.

Implicacoes arquitetonicas:

- Paywalls comerciais ficam desligados nos fluxos core.
- Stripe, Billing Portal, planos e webhooks ficam preservados, mas latentes.
- Contadores de uso continuam para fair-use e telemetria de custo, nao para bloquear a experiencia principal.
- Limites tecnicos continuam ativos para proteger infraestrutura: anexos, relay, web research, envelopes e retencao.
- Antes de reativar planos pagos, entitlements devem sair de campos editaveis pelo cliente e passar para documento server-owned ou custom claims.

## Pontuacao por pilar

| Pilar | Estado | Nota | Razao principal |
| --- | --- | ---: | --- |
| Seguranca e privacidade | Forte, com gaps | 7.5/10 | Zero-Knowledge real em progresso, mas backend CORS aberto, shares publicas e validacao E2E pendente. |
| Fiabilidade | Boa base | 7/10 | Mobile Sync tem tombstones/acks/conflitos, mas precisa teste multi-dispositivo e recuperacao operacional. |
| Performance | Media | 6/10 | Three.js/force graph funcionam, mas falta LOD, chunking visual, workers e limites progressivos. |
| Excelencia operacional | Boa | 7/10 | Builds/tests existem, docs atuais boas, mas repo muito sujo e sem pipeline limpa consolidada. |
| Custo | Forte | 8/10 | IA local reduz custo; Firebase/Stripe ainda precisam orcamentos/quotas/retencao. |
| Sustentabilidade evolutiva | Media/boa | 6.5/10 | A visao e coerente, mas ha dois caminhos visuais paralelos e risco de acoplamento excessivo. |

## Inventario observado

Frontend:

- React 19, Vite, TypeScript, Tauri, Capacitor.
- Three.js, React Three Fiber, `react-force-graph-3d`, `three-spritetext`.
- Embeddings locais via `@huggingface/transformers`.
- AI Hub configuravel em `frontend/src/services/localAiConfig.ts`.
- Politica de salvamento IA em `frontend/src/services/aiSavePolicy.ts`.
- Crypto local em `frontend/src/utils/crypto.ts`.
- Mobile Sync ECDH/AES-GCM em `frontend/src/services/mobileSync.ts`.
- Universo 3D em `frontend/src/components/universe/Universe3D.tsx`.
- Grafo principal em `frontend/src/components/MemoryGraph.tsx`.
- Motor cognitivo em `frontend/src/engines/CognitiveEngine.ts`.

Backend e cloud:

- Firebase Auth, Firestore, Storage e Functions.
- Regras em `firestore.rules` e `storage.rules`.
- Stripe em `functions/src/stripe.ts`.
- Retencao de Mobile Sync em `functions/src/index.ts` e helper dedicado.
- FastAPI local/backend em `backend/main.py`.

## Pilar 1: Seguranca e privacidade

Forcas:

- A seed BIP39 ja nao e persistida em plaintext no fluxo atual.
- Identidade RSA e identidade de sync ECDH sao guardadas cifradas por chave derivada da mnemonic.
- API keys de provedores cloud sao cifradas localmente.
- AI Hub separa local/backend/cloud e possui politica de consentimento.
- Transmissoes e Mobile Sync usam envelopes cifrados.
- Firestore Rules ja limitam sessions, transmissions, friend requests, pairings, trusted devices e mobile sync envelopes.
- Stripe webhook exige assinatura.

Riscos:

- `backend/main.py` usa `allow_origins=["*"]` com `allow_credentials=True`. Isto e perigoso para qualquer backend exposto.
- `firestore.rules` permite `allow read: if true` em `/shares/{shareId}`. Isto conflita com a narrativa Zero-Knowledge se o link puder expor conteudo ou metadados sensiveis.
- `trackShareView` e `trackConversion` podem aceitar updates sobre shares sem ownership explicito no callable.
- Functions ainda usam `functions.config()` como compatibilidade; ha prazo operacional para migrar para params/secrets.
- Logs de erro em Stripe e backend devem ser revistos para garantir que nao vazam secrets, headers, conteudo privado ou dados de pagamento.
- Falta App Check/rate limiting para endpoints callable, web research e backend FastAPI.

Acoes:

1. Restringir CORS do FastAPI a origens conhecidas por ambiente.
2. Converter shares publicas para envelopes publicos explicitamente marcados, com conteudo cifrado ou sanitizado.
3. Adicionar App Check nas Functions callable e regras de abuso por UID/IP quando aplicavel.
4. Migrar Stripe e reviewer secrets para Firebase params/secrets.
5. Criar threat model curto para: seed, cofre local, relay Firestore, WebRTC, mobile pairing, Stripe, web research.
6. Adicionar testes de rules para `shares`, `publicProfiles` e atualizacao de estado de transmissoes.

## Pilar 2: Fiabilidade

Forcas:

- Mobile Sync ja usa tombstones, acks por dispositivo ativo e resolucao de conflitos sem overwrite silencioso.
- Limpeza diaria de artefatos de sync existe em Cloud Function regional.
- Firestore indexes foram preparados para consultas criticas.
- O editor e criacao de memoria ja possuem politicas quando IA/embedding falha.

Riscos:

- WebRTC/P2P, contactos e estados de relay ainda precisam de teste real com dois utilizadores.
- Pairing mobile e QR camera precisam validacao em Android real.
- O backend FastAPI tem SQLite local e CORS aberto; como servico externo precisa perfil operacional separado.
- O grafo 3D ainda tem fallback de dados demo quando `data` nao e fornecido em `MemoryGraph.tsx`. Isso e aceitavel como fallback tecnico, mas nao deve aparecer em fluxo real.
- `deleteUserAccount` usa batches que podem exceder limite se o utilizador tiver muitos documentos; precisa paginacao robusta.

Acoes:

1. Criar roteiro E2E manual/automatizado para login, seed, memoria, grafo, transmissao, mobile sync, checkout.
2. Paginar delete account por colecao e por lotes de 450/500.
3. Adicionar health checks reais para backend local, Ollama/NVIDIA backend e Firestore connectivity.
4. Criar uma matriz de recovery: seed perdida, device revogado, envelope expirado, conflito sync, webhook falhado.

## Pilar 3: Performance

Forcas:

- O universo usa Three.js/R3F e force graph 3D com limites defensivos.
- O embedding cache evita recalcular tudo em memoria curta.
- O grafo persiste posicoes semanticas, reduzindo recomputacao visual.

Riscos:

- `MemoryGraph.tsx` corta em 5000 nos, mas falta LOD visual e streaming progressivo.
- Embeddings e similaridade ainda podem ficar caros com muitas memorias se forem O(n) no cliente.
- `Universe3D.tsx` e `MemoryGraph.tsx` sao dois motores visuais paralelos; isto aumenta custo de manutencao e bundle.
- Bundle ja tem avisos de chunks grandes.
- Labels/sprites podem degradar FPS em universos densos.

Acoes:

1. Introduzir LOD inspirado no Celestia: galactic view, cluster view, object view.
2. Mover calculo pesado de similaridade/cluster para Web Worker.
3. Usar spatial index/quadtree para labels e picking em vez de mostrar todos os labels.
4. Criar orcamento de performance: 100, 1000, 5000, 10000 memorias com FPS/memoria.
5. Unificar gradualmente `Universe3D` e `MemoryGraph` ou delimitar funcoes: universo imersivo vs diagnostico tecnico.

## Pilar 4: Excelencia operacional

Forcas:

- Existem testes unitarios, testes de rules, build Android, build/lint frontend e tests functions.
- Docs recentes estao alinhadas com o estado real.
- Firebase deploy ja ocorreu e foi verificado.
- O projeto ja removeu varios mocks e artefatos antigos.

Riscos:

- `git status` esta muito sujo, com muitos ficheiros gerados/removidos. Isto torna qualquer release arriscada.
- Falta CI limpa declarada como fonte de verdade.
- Falta matriz por ambiente: local desktop, web staging, web prod, Android debug, Android release.
- Falta SBOM/licensing gate antes de importar codigo dos repos externos.

Acoes:

1. Criar branch limpa ou commit de estabilizacao antes de novas features.
2. Garantir que `node_modules`, `dist`, caches, Android build e SQLite local nao entram no controlo de versao.
3. Criar checklist de release com comandos canonicos:
   - frontend build/lint/test;
   - firestore rules tests;
   - functions build/test/audit;
   - Android debug/release;
   - deploy staging.
4. Adicionar `docs/THREAT_MODEL.md` e `docs/LICENSE_REUSE_MATRIX.md`.

## Pilar 5: Custo

Forcas:

- IA local por Ollama/Transformers reduz custo recorrente.
- Firestore e usado como relay/metadados em varios fluxos, nao como processador de memoria privada.
- Retencao de sync reduz lixo operacional.

Riscos:

- Firestore reads podem crescer muito com grafo, sync, friend requests e envelopes se nao houver paginacao/cursors.
- Hugging Face model download/cache pode pesar no primeiro uso.
- Stripe/Functions logs e invocacoes podem crescer sem quotas.
- Web Research pode gerar custo/abuso se exposto sem rate limiting.

Acoes:

1. Definir quotas por plano para web research, transmissoes relay e sync envelopes.
2. Criar retention policy por colecao: transmissions, p2pRooms, pairings, notifications, shares.
3. Medir custo de reads por sessao tipica.
4. Preferir embeddings locais cacheados e backfills incrementais.

## Aproveitamento dos quatro repositorios

### Celestia-master

Licenca observada: GPL-2.0-or-later. Evitar copiar codigo para o Mnemosyne se o produto nao for distribuido sob GPL compativel.

O que aproveitar:

- Modelo de navegacao espacial: selecionar objeto, centrar, "go to", tour guide.
- Catalogos textuais de objetos como inspiracao para um `memory catalog` extensivel.
- LOD e renderers especializados: estrela, cometa, galaxia, nebulosa, aneis, atmosfera.
- Browser de objetos: nearest, brightest, with planets -> em Mnemosyne: recentes, mais centrais, com orbitas/conexoes.
- Separacao entre dados astronomicos, renderer e comandos de navegacao.

Plano seguro:

- Reimplementar os conceitos em TypeScript/Three, sem portar C++.
- Criar `frontend/src/engines/spatial/NavigationEngine.ts` com comandos: `select`, `center`, `goTo`, `tour`, `returnToOverview`.
- Criar `memoryCatalog` com tipos celestes e metadados, inspirado no formato de catalogo, mas original.

### d3-celestial-master

Licenca observada: BSD-3-Clause. E o repositorio mais seguro para reaproveitamento direto, mantendo atribuicao.

O que aproveitar:

- Projecoes celestes e transformacoes de coordenadas.
- GeoJSON como formato para constelacoes cognitivas.
- Minimap 2D/sky map para navegacao rapida no universo.
- Quadtree/label collision para evitar sobreposicao de labels.
- Dados de constelacoes/asterismos como metafora visual, validando licencas das fontes de dados.

Plano recomendado:

- Adicionar uma camada "Cognitive Sky Map" como minimapa opcional, nao substituir o universo 3D.
- Usar GeoJSON interno:
  - `Point` para memoria;
  - `LineString` para conexao;
  - `FeatureCollection` para constelacao/padrao.
- Extrair apenas padroes tecnicos e, se importar codigo BSD, adicionar NOTICE/atribuicao.

### space3d-master

Licenca observada: GPL-3.0. Nao incorporar macros/codigo diretamente no app comercial sem decisao explicita de licenca.

O que aproveitar:

- Linguagem visual para starfields, aneis, planetas, asteroides e nebulosas.
- Pipeline offline para gerar texturas/backgrounds/skyboxes se os outputs e assets tiverem origem/licenca compativel.
- Parametros visuais para shaders proprios no Three.js.

Plano seguro:

- Usar como moodboard tecnico e referencia de parametros.
- Criar shaders proprios em `frontend/src/engines/shaders.ts`.
- Gerar assets proprios ou usar assets permissivos; documentar origem de cada textura.

### Ising-Decoding-main

Licenca observada: Apache-2.0. Bom candidato para inspiracao e eventual reutilizacao de padroes, com NOTICE quando aplicavel.

O que aproveitar:

- Arquitetura "pre-decoder + decoder final": primeiro reduzir ruido, depois aplicar decisao deterministica.
- Conceito de sindromes: sinais locais de erro que nao revelam necessariamente todo o conteudo.
- Config unico user-facing e runner reproduzivel.
- Test tiers, coverage, CI com CPU/GPU, export ONNX/quantizacao.
- Metricas: density reduction, logical error rate, speedup.

Aplicacao ao Mnemosyne:

- Criar "Cognitive Error Correction":
  - sindromes: memoria orfa, link quebrado, duplicado semantico, contradicao, drift temporal, cluster instavel, anexo ausente;
  - pre-decoder: modelo/local heuristic que reduz candidatos;
  - decoder final: regras deterministicas que sugerem link, merge, arquivar, revisar ou separar;
  - metricas: orphan reduction, broken-link rate, contradiction resolution rate, graph density reduction, search precision.
- O `CognitiveEngine.detectAnomalies()` ja tem uma versao inicial "Ising-inspired", mas ainda e simples. Deve virar servico separado e testado.

## Arquitetura alvo proposta

```
Mnemosyne App
  UI Shell
    Universe 3D
    Cognitive Sky Map 2D
    Command Palette
    Settings / AI Hub / Sync
  Cognitive Core
    Embedding Service
    Graph Builder
    Cognitive Error Correction
    Insight Engine
  Spatial Core
    Navigation Engine
    LOD Manager
    Label/Selection Index
    Celestial Renderer
  Sovereign Data
    Local Vault
    Firestore Relay
    Mobile Sync Envelopes
    Version History
  Operations
    Tests
    Rules Emulator
    App Check / Rate Limits
    Privacy-Safe Telemetry
```

## Roadmap acionavel

## Implementado nesta iteracao

- `frontend/src/engines/celestialLayout.ts`: LOD Manager simples para reduzir detalhe visual quando o universo cresce, preservar memoria selecionada/vizinhos e gerar constelacoes cognitivas por cluster.
- `frontend/src/components/universe/Universe3D.tsx`: render budget adaptativo, fog/estrelas por escala, guias de constelacao e limite de objetos renderizados.
- `frontend/src/components/universe/ConnectionLines.tsx`: ligacoes em arco, com prioridade para conexoes ativas e limite de renderizacao.
- `frontend/src/components/universe/CelestialObject.tsx`: segmentos adaptativos e menos glow em baixa qualidade para aguentar universos maiores.
- `frontend/src/engines/CognitiveEngine.ts`: `detectAnomalies()` agora devolve severidade, confianca, densidade de sindrome e candidato de reparacao quando existe.
- Testes adicionados em `frontend/src/engines/celestialLayout.test.ts` e expandidos em `frontend/src/engines/CognitiveEngine.test.ts`.

### Semana 1: Hardening

- Restringir CORS do backend.
- Auditar `/shares`.
- Migrar secrets sensiveis para params/secrets.
- Criar `LICENSE_REUSE_MATRIX.md`.
- Criar testes Firestore adicionais para shares/transmissions/publicProfiles.

### Semana 2: Validacao real

- Teste dois utilizadores: contacto, envio relay, estado received/failed.
- Teste Android real: QR, deep link, importar sync, enviar delta.
- Teste Stripe end-to-end em modo test.
- Browser verification nos fluxos principais.

### Semana 3: Spatial Engine

- Implementar Navigation Engine inspirado no Celestia.
- Adicionar tour guide de memorias: centrais, recentes, orfas, contradicoes.
- Criar LOD Manager: cluster -> constelacao -> memoria.
- Reduzir labels com quadtree/spatial index.

### Semana 4: Cognitive Error Correction

- Extrair `detectAnomalies` para servico proprio.
- Adicionar sindromes e metricas.
- Criar painel de "Correcoes Sugeridas".
- Testar reducao de orfaos e links quebrados.

### Semana 5: Cognitive Sky Map

- Prototipar minimapa 2D com GeoJSON interno.
- Reaproveitar ideias de `d3-celestial` com atribuicao BSD se houver import direto.
- Adicionar constelacoes cognitivas geradas a partir de clusters persistidos.

## Decisoes de licenca

| Repo | Licenca | Copiar codigo? | Usar ideias? | Observacao |
| --- | --- | --- | --- | --- |
| Celestia | GPL-2.0-or-later | Nao recomendado | Sim | Reimplementar conceitos. |
| d3-celestial | BSD-3-Clause | Sim, com atribuicao | Sim | Melhor candidato para minimapa/projecoes. |
| space3d | GPL-3.0 | Nao recomendado | Sim | Usar como referencia/offline, nao runtime. |
| Ising-Decoding | Apache-2.0 | Possivel, com NOTICE | Sim | Melhor para padroes de correcao, testes e metricas. |

## Definicao de pronto para a proxima fase

O sistema passa nesta revisao quando:

- CORS e shares deixam de contradizer a postura Zero-Knowledge.
- Dois utilizadores conseguem enviar/receber memoria cifrada com estado verificavel.
- Um Android real consegue parear, receber snapshot/delta e enviar delta.
- Stripe test confirma upgrade/downgrade/gating.
- O grafo suporta 1000+ memorias com navegacao fluida e sem labels caoticos.
- Existe uma matriz clara do que pode ou nao ser reaproveitado dos quatro repositorios.
