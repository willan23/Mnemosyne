# Mnemosyne Product Status

Data: 2026-05-11
Base de trabalho: `W:\real\SaaS`
Documento de referencia: `W:\real\pro`

## Estado geral

O Mnemosyne ja saiu de varios pontos de prototipo perigoso. A base atual tem autenticacao com fluxo Zero-Knowledge, identidade criptografada, transmissoes cifradas, AI Hub configuravel, embeddings locais, autolink, pesquisa semantica, historico de memoria e um painel de insights real.

Ainda nao esta 100% pronto para mercado. O produto ja tem pilares fortes, mas precisa de hardening, testes ponta-a-ponta, social layer real, monetizacao/gating fechados, sync mobile e verificacao visual/UX antes de lancamento.

## Implementado

### Login e Zero-Knowledge

- Tela de login atualizada para o estilo visual solicitado.
- Opcao de entrar/criar chave Zero-Knowledge adicionada.
- BIP39 real com wordlist.
- Derivacao de chave com PBKDF2.
- Encriptacao AES-GCM.
- Mnemotecnica mantida apenas em memoria de sessao.
- Identidade RSA local guardada em cofre cifrado por mnemotecnica.
- Removido armazenamento legado de chave privada em plaintext.

### Identidade e transmissao

- Perfil publico publica `uid`, nome, hash de email e chave publica.
- Descoberta de destinatarios via Firestore.
- Envelope E2E com AES-GCM para payload/anexos.
- RSA-OAEP para wrapping da chave simetrica.
- Relay Firestore cifrado.
- WebRTC P2P com offer/answer e ICE candidates via Firestore.
- Regras Firestore adicionadas para `publicProfiles`, `transmissions` e `p2pRooms`.

### Social Layer inicial

- Regras Firestore adicionadas para `friendRequests`.
- Pedido de contacto por email/uid usando perfil publico resolvido.
- Aceitar/rejeitar pedidos no `TransmissionPanel`.
- Lista de contactos aceites derivada de pedidos aceites.
- Contacto aceite pode preencher destinatario e chave publica no envio.
- `MemoryActionPanel` voltou a ter envio real: abre o `TransmissionPanel` com a memoria pre-preenchida.
- Relay E2E guarda transmissoes como `sent`; destinatario atualiza para `received` apos decriptar ou `failed` se a chave falhar.
- Aba `Envios` mostra ao remetente o estado em tempo real de cada capsula.
- Regras Firestore limitam atualizacao de estado da transmissao ao destinatario e apenas de `sent` para `received`/`failed`.

### Remocao de fake UX

- Removidos componentes de demo/landing que simulavam produto.
- Removida transmissao simulada do painel de memoria.
- Drop de ficheiros limitado a `.txt` e `.md` para evitar memorias falsas sem extracao real.
- Stripe ja nao usa placeholder silencioso: falha explicitamente se segredo nao estiver configurado.
- Acesso reviewer ja nao cria subscricao falsa.

### AI Hub

- Painel AI Hub com provedores: Ollama, NVIDIA, OpenAI, Anthropic, Gemini e Mistral.
- Configuracao de endpoint/modelo por provedor.
- Cofre local cifrado para API keys usando a mnemotecnica.
- Permissoes de memoria: `never-cloud`, `confirm-cloud`, `allow-cloud`.
- Integracao NVIDIA respeita configuracao e permissoes.
- Extracao Ollama no editor faz streaming, pode ser cancelada e mostra estado para conexao, modelo lento, cancelamento e falha.
- AI Hub separa providers locais/backend de providers cloud para reduzir ambiguidade de consentimento.
- Politica de falha da IA configuravel: guardar com aviso, confirmar antes de guardar ou bloquear.
- Criacao e edicao de memoria respeitam a politica quando embeddings/backend configurado falham.

### Grafo, embeddings e autolink

- Criacao de memoria calcula embeddings locais.
- Memorias recebem titulo, importancia, posicao, tipo celeste, conexoes e metodo de processamento.
- Autolink atualiza backlinks com `arrayUnion`.
- Edicao recalcula campos semanticos e ajusta backlinks.
- Pesquisa semantica usa cosine similarity quando embeddings existem.
- Command Palette pesquisa memorias reais usando o mesmo filtro textual/semantico.
- Resultados de pesquisa destacam nos e links no grafo.
- Selecionar resultado foca automaticamente o no da memoria no universo.
- O grafo usa posicoes semanticas persistidas como coordenadas 3D.
- Conexoes semanticas persistidas aparecem como links entre memorias.
- Peso visual considera importancia, conexoes e idade.
- Ideias antigas com ligacoes/importancia sao marcadas em ambar para resurfacing.
- Memorias novas/editadas recebem `semanticClusterId`.
- O grafo prioriza `semanticClusterId` persistido para agrupamento visual.

### Memory Time Travel

- Antes de cada save, cria snapshot em `sessions/{id}/versions`.
- Historico mostra versoes antigas.
- Restaurar versao copia conteudo para o editor.
- Regras Firestore protegem leitura/criacao de versoes e bloqueiam update/delete.

### Insights reais

- `insightEngine` local e deterministico.
- Detecta:
  - contradicoes por polaridade e conceitos partilhados;
  - memorias sem ligacoes;
  - ideias antigas que reaparecem;
  - padroes por tags/conceitos.
- `InsightsPanel` ligado ao modo Insights.
- Cards abrem memorias reais no editor.

### Monetizacao e gating

- Checkout Stripe agora recebe `planId` e intervalo, nao Price ID arbitrario do frontend.
- Backend resolve Price IDs configurados para Pro/Sovereign mensal/anual.
- Webhook Stripe exige `stripe-signature` e `webhook_secret`.
- Plano canonico pago superior passou a ser `sovereign`; `business` continua como alias legado.
- Estados de assinatura sao propagados: `active`, `trialing`, `past_due`, `canceled`, `incomplete`, `paused`, `unpaid`.
- Pagina de pricing mostra plano/estado atual e abre o Billing Portal.
- Free alinhado para 30 memorias/mes e sem anexos.
- `CognitiveInput` bloqueia criacao quando o limite mensal acaba.
- `AttachmentUploader` bloqueia anexos no Free.
- Regras Firestore impedem gravar anexos em sessoes quando o utilizador nao tem plano pago ativo/trial/past_due.
- `config.json` e `current_config.json` foram sanitizados para placeholders e adicionados ao `.gitignore`.

## Validacao feita

- `npm run build` em `frontend`: passou.
- `npm run lint` em `frontend`: passou apos ajuste para ignorar artefatos gerados e converter regras incompatíveis com a base atual em avisos.
- `npm run build` e `npm run lint` passaram depois da primeira fatia de IA local fluida.
- `npm run build` e `npm run lint` passaram depois do highlight/foco de pesquisa no grafo.
- `npm run build` e `npm run lint` passaram depois do layout/peso/resurfacing inicial do grafo.
- `npm run build` em `functions`: passou depois do endurecimento Stripe/gating.
- `npm run build` e `npm run lint` no frontend passaram depois do endurecimento Stripe/gating.
- `npm run build` e `npm run lint` no frontend passaram depois dos estados reais de transmissao.
- `npm run build` e `npm run lint` no frontend passaram depois da politica de falha da IA e clusters persistidos.
- Varredura por `mock`, `fake`, `demo`, `placeholder` deixou apenas:
  - mocks de teste;
  - placeholders de input;
  - templates editaveis.

## Avisos conhecidos

- Build do frontend ainda emite aviso de `eval` dentro de `onnxruntime-web`.
- Chunks grandes no bundle (`three`, app principal).
- Import dinamico/estatico misturado para Firebase gera aviso de chunking.
- Lint do frontend passa, mas ainda mostra avisos de `any` legado e dependencias de hooks em componentes antigos.
- WebRTC P2P compila, mas ainda precisa de teste real com dois utilizadores/dispositivos.
- Social Layer compila, mas ainda precisa de teste real com dois utilizadores para pedido, aceite, envio e atualizacao de estado.
- Alguns fluxos ainda precisam de teste visual em browser, incluindo login, Insights, TransmissionPanel e editor.

## Riscos em aberto

- Social layer ainda nao esta completo: falta validar pedidos/contactos/envio com dois utilizadores reais e estado de entrega/rececao.
- Local AI ainda precisa de testes automatizados de permissoes e politica de falha.
- Mobile sync/QR pairing ainda nao implementado.
- Monetizacao e feature gating ja tem base real, mas precisam de validacao ponta-a-ponta com Stripe real e rules emulator.
- Total Sovereign Mode precisa de modo totalmente local sem Firebase/cloud.
- Web Research Engine ainda nao implementado.
- Falta suite de testes automatizados para crypto, rules, insightEngine e fluxos criticos.
