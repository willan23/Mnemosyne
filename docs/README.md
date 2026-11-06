# Mnemosyne Docs

Continuação local de 18 de outubro: [emparelhamento recuperável](EMPARELHAMENTO_RECUPERAVEL.md), com chaves/pedidos cifrados antes do envio, retoma após falha/reload, credencial e arquivos cifrados e negação das cinco escritas SDK antigas. As validações locais passaram; classificação operacional, exportação global de chaves e pilotos em hardware/rede continuam exigidos.

Etapa de servidor de 17 de outubro: [emparelhamento de dispositivos](EMPARELHAMENTO_DISPOSITIVOS_SERVIDOR.md), com expiração/quotas, confiança e cancelamento transacionais e revogação permanente. A integração recuperável dos clientes e o corte das escritas SDK antigas continuam por concluir; o gate novo permanece fechado.

Continuação de 17 de outubro: [publicação de identidade pelo servidor](PUBLICACAO_IDENTIDADE_COMMS.md) e [email verificado nos contactos e convites](VERIFICACAO_EMAIL_CONTACTOS.md). Verificação por ação explícita na conta; testes locais com SDK Auth real num emulador demo. Gates fechados e critérios operacionais de lançamento ainda abertos.

Continuação de 16 de outubro: [Review Inbox privada com UID/CAS e backup cifrado](REVIEW_INBOX_PRIVADA_RECUPERAVEL.md), prévia/merge explícito, arquivos e origens pendentes conservados e restauro entre perfis independentes. A [navegação por teclado](UX_MEMORIA_TECLADO.md) acrescenta foco modal, Escape/restauro, paginação sem perder o foco e Inter local. Recuperação operacional do sistema, agentes e aceitação por leitores de ecrã/dispositivos reais continuam requisitos do programa completo.

Continuação de 16 de outubro: [recifragem recuperável do histórico de equipa](RECIFRAGEM_HISTORICO_EQUIPAS.md), com bytes originais preservados, recibo/arquivo privado e cursor reconciliado antes de encerrar o pedido cifrado. O cliente atual deixou de gravar esse histórico por SDK. Backfill operacional, corte das regras antigas, retenção/exportação e pilotos continuam exigidos.

Continuação de 15 de outubro: [migração pessoal recuperável](MIGRACAO_PESSOAL_RECUPERAVEL.md) para sessões, versões e memórias aninhadas. A intenção cifrada e o arquivo integral são verificados antes de avançar o cursor. Classificação operacional de âmbito, registos recusados/contraditórios, restantes campos legados, manutenção de equipa e cutover continuam exigidos.

Continuação de 15 de outubro: [conflitos de sincronização recuperáveis](RESOLUCAO_CIFRADA_CONFLITOS_SYNC.md), com as três ações existentes, bases integrais da vista, arquivos completos e recuperação de respostas perdidas. A migração de campos históricos em claro e o corte global das escritas antigas continuam pendentes.

Criação e revisão de [relações semânticas recuperáveis](RELACOES_SEMANTICAS_RECUPERAVEIS.md): Worker com preparação da vista, validação de scores, decisões preservadas e revisão explícita do par com arquivos/recibos atómicos. O estado de lançamento regista o resultado geral e as áreas por concluir.

Incremento local atual: [agrupamentos recuperáveis](AGRUPAMENTOS_RECUPERAVEIS.md), calculados por âmbito a partir de todas as memórias elegíveis, com versões integrais, pedido cifrado em IndexedDB e recibos por lote. [Ligações recíprocas](LIGACOES_EQUIPAS_RECUPERAVEIS.md), [criação textual](CRIACAO_TEXTO_EQUIPAS_RECUPERAVEL.md), [edição/apagamento](EDICAO_MEMORIAS_RECUPERAVEL.md) e [revisão aprendida](REVISAO_EQUIPAS_RECUPERAVEL.md) mantêm os seus contratos. Evidências e áreas ainda pendentes: [estado do lançamento completo](ESTADO_LANCAMENTO_COMPLETO.md). Sem publicação; todas as fases continuam exigidas antes do deploy completo autorizado.

**Última atualização:** 18 de outubro de 2026
**Domínio Oficial:** https://mnemosyne-one.com  
**Produção (Hosting):** https://mnemosyne-one.web.app  
**Workspace:** `W:\real\Mnemosyne`

Esta pasta contém o estado vivo do trabalho: produto, mercado, conformidade e operações.

O ecrã principal da app é o **Universo**. A vista “Flow” foi retirada; a captura vive no Universo (hotkey, clipper, input).

## Documentos principais (ler por ordem se fores novo)

A resolução atual de identidades substituídas está em [COMMS_IDENTIDADE_CONFLITOS.md](COMMS_IDENTIDADE_CONFLITOS.md): prévia/confirmação, conservação das cifras, recuperação v2 e publicação sem reposição automática de chaves antigas.

O backup cifrado de identidades, restauro entre instalações e retenção confirmada estão em [COMMS_BACKUP_IDENTIDADES.md](COMMS_BACKUP_IDENTIDADES.md), com diário local para continuar ou reverter falhas e verificação do ficheiro antes da purga.

O estado atual do lançamento completo está em [ESTADO_LANCAMENTO_COMPLETO.md](./ESTADO_LANCAMENTO_COMPLETO.md). As decisões da fase 2 estão em [DECISOES_2.md](./DECISOES_2.md), incluindo planos/quotas, âmbito, eventos/alertas e [migração de secrets](./MIGRACAO_SECRETS_FUNCTIONS.md). A revisão de escritores inclui a [resolução cifrada de conflitos de sincronização](./RESOLUCAO_CIFRADA_CONFLITOS_SYNC.md), a [importação cifrada com lotes/recibos/retoma](./IMPORTACAO_CIFRADA_SYNC.md), a [recuperação cifrada da captura de clips](./RECUPERACAO_CIFRADA_CLIPS.md) e o [transporte local sem query](./TRANSPORTE_LOCAL_CLIPS.md); as secções datadas de setembro abaixo conservam o contexto anterior.

| Documento | Para quê |
|-----------|----------|
| [Contacto com destinatário eliminado](./COMMS_CONTACTOS_DESTINATARIO_ELIMINADO.md) | Estado terminal validado por marcadores, sem recriar referências ou perder rascunhos |
| [UID capturado nos contactos](./COMMS_CONTACTOS_UID_CAPTURADO.md) | Os cinco RPCs ligam comando/token, conservando UUID, digest e diário v1 |
| [Remoção recuperável de contactos](./COMMS_REMOCAO_CONTACTOS_RECUPERAVEL.md) | UID/token, lotes/lock/recibos, cifra local e cancelamento da intenção não admitida |
| [Diretório e procura de contactos aceites](./COMMS_DIRETORIO_CONTACTOS_ACEITES.md) | Lista independente das páginas de pedidos, chave atual e procura pontual por UID/email |
| [Inbox P2P e cópias indisponíveis](./COMMS_P2P_INBOX_INDISPONIVEIS.md) | Página limitada, cursor nativo e falhas por cópia; purga de UID inclui chaves malformadas |
| [Reconciliação P2P antiga](./COMMS_P2P_LEGADO_RECONCILIACAO.md) | Inventário projetado, cutover com tempo do servidor, planos/recibos e lotes; aplicação cloud pendente |
| [Expiração e reconciliação P2P](./COMMS_P2P_EXPIRACAO_RECONCILIACAO.md) | Purga transacional de SDP/ICE expirados, cursor limitado e referência terminal sem novo write |
| [Entrega P2P recuperável](./COMMS_P2P_ENTREGA_RECUPERAVEL.md) | Diário cifrado/UUID, recibo/quotas partilhadas, fragmentação/retoma e cópia local antes do ACK |
| [Sinalização P2P recuperável](./COMMS_P2P_SINALIZACAO_RECUPERAVEL.md) | SDP/ICE/fecho no servidor, recibos/budgets, diário/sala cifrados e ensaio de dois peers; entrega e expiração têm contratos próprios |
| [Listas Comms paginadas](./COMMS_LISTAS_PAGINADAS.md) | Cinco páginas autenticadas, autorização por registo, participantes revogados, cursores/limites e UI Anterior/Seguinte/Atualizar |
| [Entrega Comms recuperável](./COMMS_ENTREGA_RECUPERAVEL.md) | Diário cifrado/UUID, admissão/quotas atómicas, recuperação/cancelamento/ACK e limites restantes |
| [Contactos Comms recuperáveis](./COMMS_CONTACTOS_RECUPERAVEIS.md) | Resolução pontual autenticada, pedido cifrado, par/budget atómicos, respostas e cancelamento; limites do transporte/legado |
| [Transporte Comms contextual](./COMMS_TRANSPORTE_CONTEXTUAL.md) | Captura de composição/peer, guards de envio/SDP/ICE, limites e MIME; relay recuperável no contrato de entrega |
| [Troca recuperável da identidade Comms](./COMMS_IDENTIDADE_RECUPERAVEL.md) | Diário antigo/novo, CAS dos perfis, recibo privado, recuperação/cancelamento e leitura de mensagens/wraps antigos |
| [Identidade Comms com contexto](./COMMS_IDENTIDADE_CONTEXTUAL.md) | Guardas na preparação/publicação, batch de dois perfis, cache ligada à cifra e limites do rollover/handlers restantes |
| [Rascunhos cifrados da captura](./RASCUNHOS_CIFRADOS_CAPTURA.md) | Texto/imagem/base de revisão por UID, CAS entre separadores, isolamento de conta/cofre/equipa e limites de durabilidade local |
| [Importação simples do Comms](./IMPORTACAO_COMMS_RECUPERAVEL.md) | IDs próprios, anexos cifrados e diário/recibo recuperável; isolamento de inbox e limites dos restantes handlers |
| [Revisão pessoal recuperável](./REVISAO_PESSOAL_RECUPERAVEL.md) | Baseline do rascunho, diário cifrado, arquivo/recibo/orçamento atómicos e recuperação após perda de confirmação |
| [Importação de cápsulas recuperável](./IMPORTACAO_CAPSULAS_RECUPERAVEL.md) | Pack cifrado inteiro com IDs/cursor/recibos e contador/aviso final na transação do último lote |
| [Pesquisa web recuperável](./PESQUISA_WEB_RECUPERAVEL.md) | Contexto capturado, credenciais da conta, limites de stream/fontes e gravação cifrada com recibo/recuperação |
| [Criação pessoal recuperável](./CRIACAO_PESSOAL_RECUPERAVEL.md) | Entradas manuais/texto aprendido com diário cifrado, recibo/quota atómicos e confirmação repetida; limites dos percursos legados |
| [Importação documental recuperável](./IMPORTACAO_DOCUMENTAL_RECUPERAVEL.md) | Plano completo de pastas/documentos/originais cifrados, journals de ficheiros/planos, quota e recibos transacionais, retoma/cancelamento |
| [Revisão pessoal aprendida](./REVISAO_PESSOAL_APRENDIDA.md) | Revisão com leitura atual do servidor, guardas de conta/cofre, comparação integral e arquivo cifrado na mesma transação |
| [Importação Obsidian recuperável](./IMPORTACAO_OBSIDIAN_RECUPERAVEL.md) | Plano completo cifrado, IDs estáveis, lotes transacionais, quota/recibos, recuperação/cancelamento e Universo inicial |
| [Reconciliação de metadados de sincronização](./RECONCILIACAO_METADADOS_SYNC.md) | Comparação por hash restrito, conflitos de metadados, substituição completa com histórico, compatibilidade e testes atuais |
| [Ligações pessoais recuperáveis](./LIGACOES_PESSOAIS_RECUPERAVEIS.md) | Ligações explícitas recíprocas com CAS/histórico/recibo, diário cifrado, guardas da importação e recuperação por conta |
| [Publicação recuperável de sincronização](./PUBLICACAO_RECUPERAVEL_SYNC.md) | Envio cifrado, ID estável, quota atómica, confirmação de importação e recuperação com gates fechados; critérios restantes e limites dos testes |
| [**Handoff da próxima sessão**](./MNEMOSYNE_NEXT_SESSION_HANDOFF.md) | Ponto exacto de continuação (changelog recente — ler primeiro) |
| [**P3 plano (1 set 2026)**](./P3_PLAN_2026-09-01.md) | Fundação vendável — **código P3 fechado**; App Check site-key ainda é consola |
| [**SOC 2 Type I — controlos**](./SOC2_TYPE_I_CONTROLS.md) | Inventário interno (não é certificação) |
| [**Documento Geral do Sistema**](./MNEMOSYNE_DOCUMENTO_GERAL_DO_SISTEMA.md) | Visão de produto, conceitos, fluxos, domínio e estado atual |
| [**Gaps Big Tech + Migração Functions**](./MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md) | O que falta para escala/atratividade M&A e plano de sair de `functions.config()` |
| [Roadmap para mercado](./MNEMOSYNE_MARKET_READINESS_ROADMAP.md) | Fases até lançamento / free-first |
| [Estado de produto](./MNEMOSYNE_PRODUCT_STATUS_2026-05-11.md) | Baseline de features (Maio 2026; Universo já é a vista principal) |
| [Free-first strategy](./MNEMOSYNE_FREE_FIRST_STRATEGY_2026-05-12.md) | Estratégia comercial de entrada |
| [Import documental](./MNEMOSYNE_DOCUMENT_IMPORT_SUMMARY_2026-05-15.md) | Pastas/ficheiros → memórias; estendido por vault Obsidian (set 2026) |
| [WAF System Review](./MNEMOSYNE_WAF_SYSTEM_REVIEW_2026-05-12.md) | Well-Architected e visão de motor espacial |

## Mobile / Play Store

- [Play Store Release Guide](./MNEMOSYNE_PLAYSTORE_RELEASE_GUIDE_2026-05-12.md)
- [Play Store Listing Copy](./MNEMOSYNE_PLAYSTORE_LISTING_COPY_2026-05-13.md)
- **Status Play Store**: App Android desenvolvida via Capacitor 8, em testes internos (**ainda não disponível publicamente na Play Store**).

## Snapshot técnico (14 setembro 2026)

| Área | Estado |
|------|--------|
| Frontend | React 19 + Vite + Tauri 2.0 + Capacitor; **Universo** é o ecrã; captura + grafo no mesmo sítio |
| Domínio | `mnemosyne-one.com` ativo e vinculado ao `mnemosyne-one.web.app` |
| Pagamentos | Stripe no código; **inactivo / Founder Preview** em produção |
| Segurança | E2EE AES-GCM no cliente; mnemónica session-only; PIN local; `/security` |
| P3 | **Código fechado** (papéis, `teamAudit`, `/enterprise`, SDK, checklist SOC 2). App Check **monitor** ainda precisa da site key na consola. |
| First-run | Empty state: Starter Founder · Import vault Obsidian · escrever; onboarding 6 passos opcional |
| Obsidian | Import vault: wikilinks → connections; frontmatter; lanes A–E; limite 150 notas |
| Starter | Pack Founder in-app (42 notas reais; expandível em `starterFounder.ts`) |
| Taxonomia | HUD A–E + `projectStatus` (planeado/em curso/concluído) |
| Estudo | Painel thin anexo \| nota \| ligações no Universo |
| Temas 3D | Galáxia / Solar / Nebulosa / Void / Quântico / Oceânico — perfis distintos (`universeThemes.ts`) |
| i18n | **pt-PT, pt-BR, EN, FR** no produto (SPA + páginas públicas). Sem espanhol. Residual: toasts internos, HTML estático, emails, Tauri nativo. |
| Enterprise | `/enterprise` honesta (SSO em roadmap, DPA por email, sem checkout) |
| API / MCP | Keys Bearer; REST + `/api/v1/mcp`; SDK local `@mnemosyne/sdk`; servidor não decifra o cofre |
| Captura | Hotkey desktop/web; clipper Chrome/Edge (locale do browser, não o da app) |
| Equipas | E2EE até 10; papéis owner/admin/member; `teamAudit` append-only |
| Import | PDF, Markdown, texto, Office OOXML, código, imagem/áudio/vídeo; **+ vault Obsidian**; MIME inferido no cliente |
| Export | ZIP soberano local |
| Comms | Multi-user E2E + friend requests; `commsService` |
| Functions | Node.js 22; rate limits Firestore |
| Hosting | `mnemosyne-one.web.app` |

## Agora / a seguir

**Produto (founder):** alargar Starter Founder; demo 20s; smoke vault Obsidian.

**Ops / trust (horas/dias, sem Stripe/SSO/SOC2-cert):**

1. App Check monitor: criar reCAPTCHA v3, meter `VITE_FIREBASE_APPCHECK_SITE_KEY`, rebuild hosting.
2. Fechar i18n residual: toasts das Definições, HTML estático, emails, strings Tauri/Android.
3. Status page estática `/status`.
4. PITR na consola Firestore; playbook IR.
5. Migração `functions.config` → `defineSecret` (Stripe + LLM) se ainda aplicável.

**Bloqueado até haver acção tua / produto:** Stripe live, SSO OIDC (Identity Platform), SAML, SOC 2 auditor, Play Store pública, Authenticode Windows.

Ver também o handoff: [MNEMOSYNE_NEXT_SESSION_HANDOFF.md](./MNEMOSYNE_NEXT_SESSION_HANDOFF.md).

## Regra de trabalho

Antes de adicionar features novas, aplicar a regra do projeto:

1. Corrigir falhas reais  
2. Eliminar mocks, hardcodes e fake UX  
3. Garantir comportamento seguro e consistente  
4. Validar com `npm test` / `npm run build` (frontend) e `npm test` (functions) sempre que possível  

### Comandos úteis

```powershell
# Frontend
cd W:\real\Mnemosyne\frontend
npm test -- --run
npm run build

# Functions
cd W:\real\Mnemosyne\functions
npm test

# Pré-requisitos da publicação completa
cd W:\real\Mnemosyne
.\deploy.ps1 -Project mnemosyne-one -PreflightOnly
```

O [procedimento de deploy completo](PROCEDIMENTO_DEPLOY_COMPLETO.md) exige a conclusão das fases 0–6 e dos critérios de rollout antes de publicar. Os preflights atuais ainda recusam o lançamento.



