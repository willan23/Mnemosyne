# Mnemosyne — Gaps para atrair Big Tech + Migração de Functions

**Data:** 2026-07-18  
**Produto:** Mnemosyne Cognitive OS (Sovereign / Free-first)  
**Produção:** https://mnemosyne-one.web.app  
**Runtime functions:** Node.js 22 (1st Gen)  

Este documento tem dois objetivos:

1. **Listar o que falta** para o Mnemosyne ser percebido como produto de categoria mundial — e **atrativo para Big Tech** (aquisição, partnership, investimento estratégico ou “buy vs build”).
2. **Definir o plano de migração** das Cloud Functions: sair de `functions.config()` / Runtime Config (deprecado) para **params + secrets** e ambiente moderno.

---

## 1. Estado atual (o que já diferencia)

O Mnemosyne já não é um “Notion clone”. Tem pilares raros em conjunto:

| Pilar | Estado | Valor competitivo |
|--------|--------|-------------------|
| Universo cognitivo 3D | Forte | Experiência proprietária (não lista/pastas) |
| Zero-Knowledge / mnemónica | Forte | Privacy-first real (não marketing) |
| Embeddings + autolink + insights | Forte | Grafo vivo, não tags manuais |
| Comms E2E multi-user | Funcional | Relay cifrado + P2P + contactos |
| Cápsulas cifradas | Forte | Partilha sem plaintext no servidor |
| IA local + cloud consentida | Forte | Ollama + providers com política |
| Mobile sync cifrado | Forte | Pairing QR + deltas + tombstones |
| Free-first | Ativo | Distribuição sem fricção de paywall |
| Rate limit server-side | Ativo | webResearch / generateText / generateImage |
| Node 22 functions | Ativo | Runtime atualizado (fora do sunset Node 20) |

**Tese de produto:** *sistema operativo cognitivo soberano* — capturar, ligar, reviver e transmitir pensamento privado.

---

## 2. O que Big Tech avalia (framework de due diligence)

Grandes compradores / parceiros (Google, Apple, Microsoft, Meta, Amazon, OpenAI, Anthropic, Salesforce, Notion, etc.) olham tipicamente para:

1. **Moat técnico** — o que não se reimplementa em 6 meses  
2. **Dados e rede** — crescimento, retenção, grafo multi-utilizador  
3. **Segurança e compliance** — SOC2, GDPR, threat model, pentest  
4. **Escala e fiabilidade** — SLOs, observabilidade, multi-região  
5. **IP e equipa** — propriedade do código, papéis, dependências  
6. **Unit economics** — custo de IA, storage, suporte  
7. **Fit estratégico** — fecha um buraco no portefólio deles  

O Mnemosyne tem **moat de experiência + privacy**. Ainda falta **prova de escala, compliance enterprise e métricas de tração**.

---

## 3. Gaps prioritários (para ser “melhor e atraente”)

Ordenados por impacto em due diligence / valorização.

### P0 — Bloqueadores de confiança enterprise

| Gap | Porquê importa | Ação recomendada | Esforço |
|-----|----------------|------------------|---------|
| **Entitlements server-owned** | `users/{uid}.subscription` editável no cliente = risco de bypass | Custom claims ou doc `entitlements/{uid}` escrito só por Functions/webhook Stripe | M |
| **App Check enforced** | Abuso de APIs públicas (web research, generate) | reCAPTCHA Enterprise / DeviceCheck + enforce no Firebase | S–M |
| **Threat model + pentest** | Big Tech exige relatório | Documento STRIDE + pentest externo focado ZK/Comms | M |
| **SOC2 / ISO 27001 readiness** | Gate de procurement | Controlos, logs, políticas (mesmo se certificação vier depois) | L |
| **Migração Runtime Config** | Deploy quebra em mar/2026 se ainda depender de `functions.config()` | Ver secção 5 | M |
| **Observabilidade sem PII** | Incidentes sem vazar memórias | Sentry/OpenTelemetry com scrub de conteúdo; métricas só de metadados | M |

### P1 — Produto “categoria defining”

| Gap | Porquê importa | Ação recomendada | Esforço |
|-----|----------------|------------------|---------|
| **Demo multi-user gravada** | Comprova Comms real | Vídeo 2 contas: pedido contacto → cápsula → inbox | S |
| **E2E browser (Playwright)** | CI de regressão | Login → Flow → grafo → Comms mock/emulator | M |
| **Sync offline-first robusto** | Desktop/mobile enterprise | CRDT ou merge mais forte; status de sync na UI | L |
| **Positive decay real** | Diferencia “living memory” | Compressão / archive de memórias frias + restore | M |
| **Web Research com fontes citáveis fiáveis** | Concorrência com Perplexity/Notion AI | Ranking de fontes + modo “só local” default | M |
| **Export total soberano** | Exit strategy do user = trust | ZIP cifrado (memórias + grafo + chaves públicas) | M |
| **Account recovery UX** | Perda de mnemónica = perda total | Fluxo honesto + backup guiado + opcional social recovery | M |

### P2 — Atração estratégica / partnership

| Gap | Porquê importa | Quem se importa | Ação |
|-----|----------------|-----------------|------|
| **SDK / API pública de grafo** | Embed em outras apps | Microsoft Graph, Notion, Slack | API read-only de clusters (com consentimento) |
| **Plugin OS (Windows/macOS)** | Capture ontem no SO | Microsoft, Apple | Global hotkey → Flow |
| **Enterprise SSO (SAML/OIDC)** | Venda B2B | Qualquer big tech IT | Entra ID / Okta |
| **Admin console multi-tenant** | Teams soberanos | Salesforce, Google Workspace | Orgs com ZK por vault |
| **Benchmark vs Notion/Obsidian/Reflect/Mem** | Narrativa de mercado | Investidores / M&A | Página comparativa honesta |
| **Patents / design IP** | Defesa legal | M&A legal | Avaliar UI de grafo + protocol cápsula |
| **Tração publicável** | Valorização | Todos | DAU/WAU, memórias/semana, % com grafo >50 nós |

### P3 — Polimento que eleva “premium”

| Gap | Ação |
|-----|------|
| Chunk size frontend (>1MB JS) | Code-split three.js / transformers |
| A11y (teclado, ARIA, contraste) | Auditoria WCAG 2.2 AA no Flow/Universe |
| i18n completo | PT/EN/ES já parcial — fechar 100% |
| Performance 10k memórias | LOD já existe — stress test + telemetria |
| Brand kit + design system | Tokens unificados (já começados em `index.css`) |

---

## 4. O que tornaria o Mnemosyne “impossível de ignorar”

Checklist de **narrativa de aquisição**:

1. **1M utilizadores Free-first** ou **niche dominante** (investigadores / founders / defense-adjacent privacy).  
2. **Zero-Knowledge auditado** por third-party (não só “claim”).  
3. **Protocolo de cápsula** aberto (spec + open-source client library) → standard de facto.  
4. **Grafo cognitivo** com métricas de “tempo recuperado” (insights que mudam decisões).  
5. **Integração nativa** com um ecossistema (ex.: Microsoft Copilot plugin *local-first*, ou Apple Intelligence *on-device*).  
6. **Equipa e IP limpos** (sem dependências tóxicas, licenças claras).  
7. **Unit economics** de IA controlados (local-first reduz OpEx).  

**Posicionamento para Big Tech (por comprador hipotético):**

| Player | Fit | Pitch de 1 linha |
|--------|-----|------------------|
| **Apple** | Privacy + on-device | “Cognitive OS local-first para o ecossistema Apple” |
| **Microsoft** | Graph + Copilot | “Personal knowledge graph soberano ao lado do Copilot” |
| **Google** | Gemini + Workspace | “Memória pessoal ZK que o Gemini não armazena” |
| **OpenAI / Anthropic** | Memory products | “Camada de memória do user, não do modelo” |
| **Notion / Coda** | Product | “De documentos para universo vivo” |
| **Meta** | Social cifrado | “Transmissão de ideias sem feed público” |

---

## 5. Migração de Cloud Functions (Runtime Config → params/secrets)

### 5.1 Problema

Firebase anuncia o **encerramento do Runtime Config** (API `functions.config()`). Deploys que dependem só disso **falham após a data de cutoff** (referência: migração obrigatória até **março de 2026** no aviso de deploy).

No código atual:

| Ficheiro | Uso legado | Uso moderno (já parcial) |
|----------|------------|---------------------------|
| `stripe.ts` | `getRuntimeConfig().stripe.*` | fallback `process.env.STRIPE_*` |
| `index.ts` | `getRuntimeConfig().reviewer?.secret` | — |
| `webApi.ts` / `kg-extractor.ts` | — | `process.env.*` (LLM keys) |
| `.env` local / Functions | — | chaves já carregadas no deploy recente |

### 5.2 Inventário de configuração a migrar

**Secrets (nunca em código / nunca em client):**

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_*` / price IDs (pro/sovereign monthly/yearly) se ainda em config
- `REVIEWER_SECRET` (ou `REVIEWER_ACCESS_SECRET`)
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `HUGGINGFACE_API_KEY`
- `NVIDIA_API_KEY` (+ variantes FAST/CORE se mantidas)

**Params não secretos (podem ser public/config):**

- `GEMINI_MODEL`, `OPENAI_MODEL`, `NVIDIA_MODEL_*`
- `NVIDIA_BASE_URL`, `HUGGINGFACE_API_BASE_URL`
- Região default, feature flags server-side

### 5.3 Arquitetura alvo

```
┌─────────────────────────────────────────────┐
│  Firebase params (defineString / defineSecret) │
│  + Secret Manager                              │
└──────────────────┬────────────────────────────┘
                   │ inject em runtime
                   ▼
┌─────────────────────────────────────────────┐
│  Cloud Functions (Node 22)                   │
│  stripe / webApi / kg / reviewer / cleanup   │
└─────────────────────────────────────────────┘
```

**Não usar:** `functions.config()` em código novo.  
**Preferir:** `firebase-functions/params` + `defineSecret` + `runWith({ secrets: [...] })` (1st gen) ou `setGlobalOptions` / secrets binding (2nd gen, se/quando migrar).

### 5.4 Plano de execução (checklist)

#### Fase A — Preparação (1–2 dias)

- [ ] Inventariar todos os `functions.config()` e chaves `.env`
- [ ] `firebase functions:config:get` → backup local encriptado (só admin)
- [ ] Mapear cada chave para Secret Manager ou param
- [ ] Documentar rotação (Stripe webhook, LLM keys)

#### Fase B — Código (2–4 dias)

- [ ] Criar `functions/src/config/params.ts`:

```ts
// Esboço alvo
import { defineSecret, defineString } from 'firebase-functions/params';

export const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
export const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
export const reviewerSecret = defineSecret('REVIEWER_SECRET');
export const geminiApiKey = defineSecret('GEMINI_API_KEY');
// ...
export const geminiModel = defineString('GEMINI_MODEL', { default: 'gemini-1.5-flash' });
```

- [ ] Remover `getRuntimeConfig()` de `stripe.ts` e `index.ts`
- [ ] Ligar secrets às functions que as usam (`runWith({ secrets: [stripeSecretKey] })`)
- [ ] Manter fallback `process.env` só para emulators / testes locais
- [ ] Testes unitários com env mock (sem secrets reais)

#### Fase C — Infra (1 dia)

- [ ] Definir secrets no projeto:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY --project mnemosyne-one
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project mnemosyne-one
firebase functions:secrets:set REVIEWER_SECRET --project mnemosyne-one
# ... LLM keys
```

- [ ] Ou importar via `firebase functions:config:export` (CLI interativa) e rever
- [ ] Atualizar CI (GitHub Actions) se existir deploy automatizado

#### Fase D — Validação (1 dia)

- [ ] Emulator: checkout Stripe mock / webhook signature
- [ ] Staging: price IDs + portal de billing
- [ ] Produção: deploy functions; smoke test:
  - [ ] webResearch 200
  - [ ] generateText 200
  - [ ] Stripe webhook (evento teste)
  - [ ] grantReviewerAccess com secret novo
- [ ] Confirmar que **nenhum** log imprime secret completo

#### Fase E — Cleanup

- [ ] Remover dependência de Runtime Config no projeto
- [ ] Apagar chaves legadas do Runtime Config após 1 semana estável
- [ ] Atualizar este doc + handoff

### 5.5 Critério de “done” da migração

- Zero chamadas a `functions.config()` / `getRuntimeConfig()` no source  
- Secrets só via Secret Manager / `defineSecret`  
- Emulator e prod documentados  
- Deploy de functions sem aviso de Runtime Config  
- Stripe + LLM + reviewer verificados ponta-a-ponta  

### 5.6 Opcional (depois da migração de config)

| Melhoria | Benefício |
|----------|-----------|
| Migrar 1st Gen → **2nd Gen** (Cloud Run) | Concurrency, cold start, networking |
| Unificar regiões (`europe-west1` vs `us-central1`) | Latência + compliance EU |
| IAM least-privilege por function | Superfície de ataque menor |
| Budget alerts GCP | Controlo de custo de IA |

---

## 6. Roadmap sugerido (90 dias) alinhado a Big Tech

### Dias 1–30 — Trust & config

1. Completar **migração functions** (secção 5).  
2. Entitlements server-owned.  
3. App Check em produção.  
4. Threat model + privacy page alinhada.  
5. Demo multi-user gravada.

### Dias 31–60 — Product depth

6. Playwright E2E no CI.  
7. Export soberano.  
8. Observabilidade (sem conteúdo).  
9. Offline/sync polish.  
10. Landing “why Mnemosyne vs X”.

### Dias 61–90 — Signal for M&A / partnership

11. Métricas públicas de tração (mesmo que modestas).  
12. Spec aberta de **Cápsula Mnemosyne**.  
13. Uma partnership técnica (ex. Ollama, Hugging Face, Stripe Atlas).  
14. Design system + a11y.  
15. Pacote de due diligence (data room: arquitetura, IP, custos, riscos).

---

## 7. Riscos honestos (não esconder em due diligence)

| Risco | Mitigação |
|-------|-----------|
| Firebase Auth ≠ anonimato total | Comunicação ZK de **conteúdo**, não de metadados |
| Dependência de um cloud (GCP/Firebase) | Abstrair storage; documentar exit |
| Custo de embeddings client-side | LOD + modelos leves; opcional server embedding consentido |
| Perda de mnemónica = perda de vault | Backup UX + educação + recovery policy |
| Comms ainda precisa de tração multi-user real | Campanha Founder Preview + testes fechados |
| Runtime Config se não migrar a tempo | **Este documento — executar secção 5** |

---

## 8. Resumo executivo

**Hoje:** produto diferenciado (universo cognitivo + ZK + IA local + Comms), Node 22, free-first, rate limits, base sólida para Founder Preview.

**Para ser “melhor”:** fechar trust enterprise (entitlements, App Check, audit), E2E real, export soberano, métricas.

**Para atrair Big Tech:** moat auditável + tração + protocolo de cápsula + fit com privacy/on-device/graph strategy de um gigante.

**Urgente de engenharia:** **migrar functions.config → secrets/params** antes do cutoff do Runtime Config.

---

## 9. Referências internas

- Handoff: `docs/MNEMOSYNE_NEXT_SESSION_HANDOFF.md`  
- Roadmap mercado: `docs/MNEMOSYNE_MARKET_READINESS_ROADMAP.md`  
- Free-first: `docs/MNEMOSYNE_FREE_FIRST_STRATEGY_2026-05-12.md`  
- WAF: `docs/MNEMOSYNE_WAF_SYSTEM_REVIEW_2026-05-12.md`  
- Código: `functions/src/stripe.ts`, `functions/src/index.ts`, `functions/src/webApi.ts`, `functions/src/rateLimit.ts`  

---

*Documento vivo. Atualizar após cada fase da migração de functions e após marcos de tração/compliance.*
