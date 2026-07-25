# Mnemosyne Market Readiness Roadmap

Objetivo: deixar o Mnemosyne pronto para entrar no mercado como um Sistema Operativo Cognitivo Soberano, sem mocks, sem promessas falsas e com uma experiencia confiavel. A estrategia comercial passa a ser Free-first: lancar gratuito para ganhar mercado e reativar planos pagos apenas depois de tracao real.

## Principios

1. Segurança antes de features.
2. Dados reais antes de demonstracoes bonitas.
3. IA configuravel e consentida.
4. Grafo e pesquisa devem refletir pensamento real.
5. Rede/social deve ser cifrada e auditavel.
6. O core deve ser gratuito na fase de entrada no mercado.
7. Diferenciacao so conta se funcionar ponta-a-ponta.

## Fase 1 - Fechar o nucleo soberano

Status: em progresso.

Ja feito:

- Zero-Knowledge com BIP39, PBKDF2 e AES-GCM.
- Identidade local cifrada.
- Testes automatizados cobrem geracao/validacao BIP39, AES-GCM derivado da mnemotecnica, rejeicao de chave errada e cofre de identidade cifrado.
- Cache volatil de identidade passou a ser segmentada por fingerprint da mnemotecnica para nao reutilizar uma identidade desbloqueada com frase errada.
- Perfil publico com chave publica.
- Relay cifrado e WebRTC P2P.
- AI Hub configuravel.
- Embeddings, autolink e pesquisa semantica.
- Memory Time Travel.
- Insights locais reais.

Falta:

- Testes automatizados de migracao/rotacao de identidade.
- Teste P2P real com dois utilizadores.
- UI para recuperacao/rotacao de identidade.
- Protecao opcional com PIN local.
- Auditoria de localStorage/sessionStorage.

## Fase 2 - Social Layer real

Status: em progresso. Base inicial implementada em 2026-05-11.

Ja feito:

- Colecao `friendRequests` com regras Firestore para criar, aceitar e rejeitar pedidos.
- Pedido de contacto por email/uid a partir de perfil publico resolvido.
- Aba de contactos no `TransmissionPanel`.
- Lista de contactos aceites derivada de pedidos aceites.
- Botao `Enviar` no `MemoryActionPanel`.
- Abertura do `TransmissionPanel` com memoria pre-preenchida.
- Relay usa estado honesto `sent` em vez de marcar entrega antes da abertura.
- Destinatario marca transmissao como `received` apenas apos decriptar, ou `failed` se falhar.
- Aba `Envios` mostra ao remetente estados em tempo real: enviada, recebida, falhou ou P2P.
- Regras Firestore permitem apenas ao destinatario atualizar `sent` para `received`/`failed`.

Implementar:

- Teste real com dois utilizadores/dispositivos.
- Validacao das regras Firestore em emulator.
- Refinar UX para impedir ambiguidades entre perfil publico resolvido e contacto aceite.

Resultado esperado:

O utilizador consegue criar uma memoria, escolher um contacto real e enviar a memoria cifrada por P2P ou relay.

## Fase 3 - IA local fluida

Status: em progresso. Base inicial implementada em 2026-05-11.

Ja feito:

- Streaming Ollama no editor de memoria.
- Cancelamento real com `AbortController`.
- Estado claro para conexao, stream ativo, modelo lento, cancelamento e falha.
- Migracao de permissao antiga `cluster-only` para `allow-cloud`.
- UI do AI Hub alinhada com `never-cloud`, `confirm-cloud`, `allow-cloud`.
- AI Hub separa visualmente providers locais/backend de providers cloud.
- Politica de falha da IA configuravel: guardar com aviso, confirmar antes de guardar ou bloquear gravacao.
- Flow e editor respeitam a politica quando embeddings/backend configurado falham.
- Testes automatizados cobrem default local-first, migracao `cluster-only` para `allow-cloud`, normalizacao de politica invalida, persistencia de configuracao e API keys cifradas pela mnemotecnica.
- Testes de politica de gravacao cobrem permissoes `never-cloud`, `confirm-cloud`, `allow-cloud` e falhas `save-with-warning`, `confirm-before-save`, `block-save`.

Implementar:

- Validar estes fluxos em UI/E2E com provider local, backend cloud consentido e falha simulada de IA.

Resultado esperado:

A IA responde sem bloquear a interface e nunca envia memoria privada para cloud sem consentimento.

## Fase 4 - Grafo e Living Universe

Status: Concluído. Pesquisa/foco, backfill inicial, importação nativa de pastas e assimilação de múltiplos formatos implementados e validados.

Ja feito:

- Command Palette pesquisa memorias reais, nao apenas comandos.
- Pesquisa textual/semantica do `useSessions` alimenta resultados da paleta.
- Resultados de pesquisa sao destacados no grafo.
- Selecionar memoria na pesquisa foca automaticamente o no correspondente.
- Links ligados a resultados recebem destaque visual.
- Posicoes semanticas persistidas (`position`) alimentam a posicao 3D dos nos.
- Conexoes semanticas persistidas (`connections`) aparecem como links reais entre memorias.
- Tamanho/brilho dos nos considera importancia e numero de conexoes.
- Ideias antigas com peso/conexoes sao marcadas visualmente para resurfacing.
- `semanticClusterId` persistido nas memorias criadas/editadas.
- Grafo usa `semanticClusterId` persistido antes de recalcular agrupamento por conexoes.
- Rotina local de backfill atribui `semanticClusterId` a memorias antigas usando conexoes existentes, herdando clusters persistidos quando possivel.
- Testes automatizados cobrem autolink semantico, limite de 7 conexoes, criacao de edges validos, PageRank e anomalias de links quebrados/orfaos.
- Testes automatizados cobrem insights locais: contradicoes, memorias orfas, resurfacing e padroes por tag/conceito.
- Importacao documental por lote definida para ate 20 ficheiros, com extracao local de texto quando possivel e resumo extractivo sem enviar conteudo privado para cloud.
- Camada multimodal local best-effort adicionada para imagem/audio/video com captioning, OCR e transcricao quando o browser suporta.
- Release `1.0.4` publicada para web, desktop e Android com a pipeline documental nova.
- Empacotamento desktop/Android corrigido para nao embutir downloads publicos dentro dos apps.
- Importação nativa de pastas no Tauri implementada com leitura recursiva no lado Rust/Tauri (`tauri-plugin-dialog` e `tauri-plugin-fs`).
- Suporte a código fonte e configurações comuns (`.js`, `.ts`, `.rs`, `.py`, `.json`, etc.) adicionado em `learningService.ts`, permitindo assimilá-los nativamente como arquivos de texto em vez de binários genéricos.

Resultado esperado:

O universo deixa de ser apenas visual e passa a ser uma representacao navegavel do pensamento.

## Fase 5 - Free-first e monetizacao latente

Status: Concluído. O modo Free-First (Founder Preview) foi ativado, permitindo acesso universal a anexos para utilizadores gratuitos, com gating e limites mantidos de forma latente na infraestrutura.

Ja feito:

- Checkout deixou de aceitar Price ID arbitrario vindo do frontend.
- Backend resolve `planId` + `billingInterval` para Price IDs configurados.
- `Sovereign` substitui `Business` como plano canonico, mantendo alias legado.
- Webhook Stripe exige assinatura e secret configurado.
- Estados Stripe `active`, `trialing`, `past_due`, `canceled`, `incomplete`, `paused` e `unpaid` sao sincronizados/propagados.
- Portal de billing ligado na pagina de pricing para gestao de assinatura.
- Plano Free alinhado para 30 memorias/mes e sem anexos (limites mantidos de forma latente).
- Criacao de memorias no fluxo principal respeita limite mensal no cliente.
- Script de configuracao Stripe atualizado para Price IDs `sovereign`.
- Testes automatizados cobrem normalizacao de planos, alias legado `business -> sovereign`, limites Free e limites ilimitados.
- Regras Firestore validadas em emulator para bloqueio de anexos no plano Free e permissao para plano pago ativo.
- Acesso universal a anexos ativado no Firestore (`firestore.rules` retornando `true` em `hasPaidAttachmentAccess()`) e Storage ajustado para aceitar qualquer tipo de anexo do proprietário autenticado.
- Geração de imagens via IA com suporte a múltiplos provedores (NVIDIA NIM SDXL, Hugging Face, OpenAI) com fallback automático configurada nas Cloud Functions e integrada ao frontend.

Validar antes de reativar pago:

- Validar Price IDs reais por ambiente.
- Fluxo de checkout testado ponta-a-ponta.
- Validar portal de billing em ambiente Stripe real.
- Adicionar testes automatizados para normalizacao de planos/estados.
- Migrar configuracao Stripe de `functions.config()`/Runtime Config para params/secrets antes de marco de 2027.
- Mover entitlements pagos para documento server-owned ou custom claims; nao confiar em `users/{uid}.subscription` editavel pelo cliente.

Resultado esperado:

O produto entra no mercado gratuito e sem friccao. A infraestrutura paga fica pronta, segura e desligada por estrategia ate haver tracao.

## Fase 6 - Mobile Sync

Status: em progresso. QR pairing, leitura QR por camera, resposta cifrada, lista de dispositivos confiaveis, sync cifrado incremental/bidirecional e rota mobile de consumo implementados em 2026-05-11.

Ja feito:

- Convite de pareamento por QR gerado no browser.
- Chave efemera ECDH P-256 para o convite.
- Payload `mnemosyne://pair` inclui apenas identificador, uid, expiracao e chave publica efemera.
- Documento `devicePairings` no Firestore para convites pendentes/cancelados/aceites.
- Regras Firestore para criar, ler, atualizar e cancelar convites do proprio utilizador.
- Leitura/parsing do `mnemosyne://pair` para o fluxo mobile.
- Mobile gera chave efemera ECDH P-256 propria e responde com handshake cifrado AES-GCM.
- Desktop valida a resposta cifrada e cria registo em `trustedDevices`.
- Settings mostra lista de dispositivos confiaveis.
- Dispositivos confiaveis podem ser revogados.
- Regras Firestore para `trustedDevices` com ownership e transicao de estado controlada.
- Snapshot cifrado de memorias pode ser preparado para um dispositivo confiavel ativo.
- Cada snapshot usa ECDH efemero desktop + chave publica do mobile para derivar AES-GCM.
- `mobileSyncEnvelopes` guarda apenas payload cifrado, chave publica efemera do remetente e metadados minimos.
- Regras Firestore limitam criacao de envelopes a dispositivos confiaveis ativos do proprio utilizador.
- Rota mobile `/mobile/pair` aceita convites, guarda a chave privada de sync e importa envelopes cifrados.
- Deep link Android `mnemosyne://pair` encaminha para o fluxo mobile.
- Botao mobile para ler QR pela camera via ML Kit Barcode Scanning.
- Android declara permissao de camera e dependencia ML Kit `barcode_ui`.
- Chave privada de sync usa storage nativo seguro via Keychain/Android Keystore quando a app corre em Capacitor.
- Backup Android exclui o ficheiro de secure storage dos backups/cloud transfer.
- Credenciais hardcoded de assinatura release foram removidas do Gradle; builds assinados passam a depender de `MNEMOSYNE_RELEASE_STORE_FILE`, `MNEMOSYNE_RELEASE_STORE_PASSWORD`, `MNEMOSYNE_RELEASE_KEY_ALIAS` e `MNEMOSYNE_RELEASE_KEY_PASSWORD`.
- Build Android local validado com Java do Android Studio: `assembleDebug` gerou APK e `bundleRelease` compilou AAB.
- Desktop gera identidade ECDH persistente de sync, guardada no cofre local cifrado pela mnemotecnica.
- Dispositivos confiaveis guardam a chave publica de sync do desktop, nunca a privada.
- Envelopes `memory-delta` suportam desktop-to-mobile e mobile-to-desktop.
- Desktop e mobile mantem cursores locais para enviar apenas memorias alteradas desde o ultimo delta.
- Importacao evita sobrescrever memoria local mais recente; cria copia marcada `sync-conflict`.
- Indices Firestore incluem consultas de envelopes por owner, dispositivo, direcao e estado.
- Deletes passaram a tombstones (`deletedAt`) para poderem viajar nos deltas cifrados.
- Memorias apagadas deixam de aparecer no grafo/listas, mas continuam disponiveis para sync.
- Painel de conflitos em Settings permite aplicar, manter ambos ou descartar copias `sync-conflict`.
- Painel de conflitos mostra comparacao lado-a-lado entre memoria local e versao recebida.
- Settings permite limpeza manual de envelopes consumidos/falhados e tombstones antigos.
- Envelopes novos incluem `tombstoneIds` como metadado minimo para confirmar entrega de deletes sem expor conteudo.
- Limpeza de tombstones antigos so remove deletes quando todos os dispositivos ativos ja receberam ack via envelope puxado, ou quando nao ha dispositivos ativos.
- Cloud Function diaria `cleanupMobileSyncRetention` aplica a mesma retencao ack-aware no backend.
- `cleanupMobileSyncRetention` foi publicada em `europe-west1` com Cloud Scheduler ativo em 2026-05-11.
- Regras Firestore de Mobile Sync validadas em emulator para dispositivo confiavel ativo, dispositivo revogado, ownership e mutacao controlada de status.
- Testes das Functions cobrem a decisao ack-aware que permite apagar tombstones apenas sem dispositivos ativos, pelo proprio dispositivo que apagou ou apos ack de todos os outros ativos.

Implementar/validar:

- Validar primeira execucao real da Cloud Function agendada nos logs apos o proximo ciclo.
- Validar pareamento com dois dispositivos reais.
- Validar leitura QR por camera num Android real.

Resultado esperado:

O utilizador consegue ligar mobile ao desktop sem expor seed ou chave privada.

## Fase 7 - Web Research Engine

Implementar:

- Comando `/web pesquisar [tema]`.
- Pesquisa publica sem memoria privada.
- Pesquisa contextual apenas com consentimento.
- Fontes obrigatorias.
- Resumo, ideias principais e memorias sugeridas.
- Comparacao local com memorias existentes.
- Deteccao de contradicoes entre web e conhecimento pessoal.

Resultado esperado:

Pesquisa externa vira conhecimento conectado, com fontes e sem fuga silenciosa de dados privados.

## Fase 8 - Hardening para mercado

Obrigatorio antes de lancar:

- `npm audit` do frontend deve permanecer limpo; em 2026-05-11 ficou em 0 vulnerabilidades apos atualizar dependencias de transformers e remover pacotes vulneraveis nao usados.
- `npm audit` das functions deve permanecer limpo; em 2026-05-11 ficou em 0 vulnerabilidades apos atualizar `firebase-admin`/`firebase-functions` e omitir dependencias opcionais nao usadas.
- Testes unitarios/servico: crypto, limites de planos, insights, autolink e politica de permissoes/falhas de IA cobertos; ainda faltam E2E.
- Testes de regras Firestore via emulator cobrem isolamento de memorias, anexos Free vs Pro, edicao partilhada limitada, envelopes de Mobile Sync e deletes por owner; em Windows podem correr via `./test-firestore-rules.ps1`.
- Testes das Functions cobrem a regra de ack para limpeza agendada de tombstones Mobile Sync.
- Testes E2E: login, criar memoria, editar, time travel, insights, transmitir, checkout.
- Browser visual check para desktop e mobile.
- Threat model atualizado.
- Politica de privacidade alinhada com Zero-Knowledge.
- Documentacao de recuperacao de conta e perda da mnemotecnica.
- Observabilidade minima para erros sem capturar conteudo privado.
- ~~Migrar Functions de Node.js 20~~ **Feito 2026-07-18:** runtime **Node.js 22** em producao.
- Migrar `functions.config()` para params/secrets antes do encerramento do Runtime Config (aviso de deploy: **marco de 2026**). Plano detalhado: [MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md](./MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md).
- Entitlements server-owned (custom claims ou doc escrito so por Functions).
- App Check enforced em producao.
- Demo multi-user Comms gravada + E2E Playwright no CI.
- Observabilidade sem capturar conteudo de memorias.
- Export soberano (ZIP cifrado) e threat model formal.

## Definicao de 100%

O sistema so deve ser considerado pronto para mercado quando:

- nao houver mock/fake UX em fluxo de produto;
- build e testes principais passarem;
- dois utilizadores conseguirem transmitir memoria cifrada;
- dados privados nunca sairem sem consentimento explicito;
- modo Free-first abrir o core sem paywalls comerciais e preservar apenas limites tecnicos/fair-use;
- infraestrutura paga existir em modo latente, com entitlements preparados para serem server-owned antes da reativacao;
- login Zero-Knowledge, memoria, grafo, insights e transmissao funcionarem numa demo real ponta-a-ponta.
