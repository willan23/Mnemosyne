# Mnemosyne Next Session Handoff

Data: 2026-07-18  
Continuar em: `W:\real\Mnemosyne`  
Produção: https://mnemosyne-one.web.app (hosting deploy OK)

## Update — auto-update da app (2026-07-18g)

- Web/Capacitor: `AppUpdatePrompt` compara `/version.json` (no-cache) com build embutido
- Toast “Nova versão disponível” → **Atualizar agora** (reload hard) ou Depois
- Check a cada 3 min + on focus/visibility
- Plugin Vite gera `version.json` + `VITE_APP_VERSION` / `VITE_APP_BUILD_ID` (v1.0.7)
- Desktop Tauri: mantém updater nativo com copy alinhada
- `firebase.json`: Cache-Control no-cache para `version.json` e `index.html`

## Docs atualizados (2026-07-18f)

- **Novo:** [`docs/MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md`](./MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md)  
  - Gaps para atrair Big Tech (P0–P3)  
  - Plano de migração `functions.config()` → params/secrets  
  - Roadmap 90 dias  
- Atualizado: `docs/README.md`, `docs/MNEMOSYNE_MARKET_READINESS_ROADMAP.md`

### Próxima sessão recomendada
1. Executar **Fase A–B da migração de secrets** (Stripe + reviewer + LLM)
2. Entitlements server-owned
3. App Check site key + enforce
4. Demo multi-user Comms (2 contas) gravada

## Update — Functions Node 22 upgrade (2026-07-18e)

- `functions/package.json` `engines.node`: `20` → `22`
- `@types/node` → `^22.15.0`
- Build + unit tests OK; deploy functions em curso / feito

## Update — Comms / E2E / rate limit / Flow + deploy (2026-07-18d)

### Comms multi-user
- `services/commsService.ts`: bloqueio self-send, payload relay `status:sent`, P2P separado, friend requests
- TransmissionPanel usa o serviço + toasts (sem delay fake no relay)
- Rules tests: friendRequests + transmissions

### Rate limit server-side
- `functions/src/rateLimit.ts` (Firestore sliding window por IP)
- Aplicado a `webResearch`, `generateText`, `generateImage` → HTTP 429 + Retry-After
- Coleção `rateLimits` bloqueada a clientes

### E2E pipeline (vitest)
- `test/e2e.pipeline.test.ts`: crypto cápsula, comms, search, client rate limit
- Functions: `test/rateLimit.test.js`

### Flow polish
- Ecos via motor de pesquisa unificado; chips de modo; rascunho; dicas empty; ecos clicáveis

### Deploy OK
- https://mnemosyne-one.web.app
- hosting + firestore:rules + functions

## Update — Search + Definições (2026-07-18c)

### Search
- Motor unificado `utils/searchMemories.ts`: ranking textual + semântico, operadores `#tag`, `tag:x`, `cat:y`
- `useSessions` usa o mesmo motor (floor semântico 0.38)
- Command Palette: recentes, chips de tags, snippets, tipo de match, deep-links (Pulse, Insights, Definições·IA/PIN)
- Ctrl+Enter → web research; limpar query; indicadores de score

### Definições
- Barra de pesquisa interna (PIN, Ollama, sync…)
- Chips de estado (memórias, PIN, IA, dispositivos)
- Persistência da última secção + deep-link `initialSection`
- Atalhos 1–7 entre secções
- Nav filtra secções pela query

### Validação: 79 tests + build OK

## Update — Universo real + polish + prioridades (2026-07-18b)

### Universo 3D de verdade
- Núcleo galáctico, poeira cósmica, nebulosas mais densas (`space3dBackdrop` + `Space3DBackdrop`)
- Luzes hemisphere + core warm; intro de câmara; auto-rotate em vazio
- Proto-estrelas + CTA “Universo nascente” quando sem memórias
- Ligações com partículas de sinal e blending aditivo
- Vignette + film grain; HUD glass compacto

### Polish visual
- Dock com glow ativo violet→cyan
- MemoryGraph empty state + fundos cósmicos (nunca pure black)
- Classes CSS `mnem-universe-grain`, `mnem-graph-empty`

### Prioridades técnicas
- Firestore `shares`: schema cifrado obrigatório (sem plaintext)
- Rules tests: cápsulas encrypted + transmissions E2E (emulator)
- Rate limit client web research (`clientRateLimit` + fair-use/hora)
- App Check opcional via `VITE_FIREBASE_APPCHECK_SITE_KEY` (`initAppCheckIfConfigured`)

### Validação
- Unit tests: 75 passed
- `npm run build` a validar

## Update — PIN local + Cognitive Pulse (sessão 2026-07-18)

- **PIN local opcional**: vault AES-GCM + PBKDF2 em `utils/localPin.ts`; UI em Definições → Privacidade; unlock overlay `PinUnlockModal` após idle lock
- **Cognitive Pulse**: ritual diário em `services/cognitivePulse.ts` + painel `CognitivePulsePanel` (tensões, ecos, órfãs, constelação do dia)
- Botão **Pulso** no header; abre 1×/dia após desbloquear com memórias
- Teste planLimits alinhado a Founder Preview (fair-use 5 GB, não “Sovereign unlimited”)
- Testes: 72 passed; build a validar localmente

## Update — pack multi-memória + aviso de assimilação

- Pack: checkbox “incluir memórias ligadas” na cápsula (até 12)
- `importCapsuleAsMemory` expande packs em N memórias
- `capsuleImportNotices` + toast “Cápsula assimilada” ao autor
- Rules: importCount em shares + coleção notices
- Deploy hosting + firestore rules: https://mnemosyne-one.web.app

## Update — QR cápsula + importar para universo

- ShareModal: QR code da cápsula + download PNG
- ShareView: **Assimilar cápsula** → `importCapsuleAsMemory` (embeddings/autolink)
- Tags `capsula` / `importada`; botão **Ver no grafo** com deep-link
- Deploy: https://mnemosyne-one.web.app

## Update — replay onboarding + cápsulas públicas

- Definições → Privacidade → **Repetir onboarding** (`resetOnboarding` + `forceOpen`)
- Painel memória: **Link privado** + **Cápsula cifrada** (ShareModal)
- Cápsula: opcional `#k=` no fragmento (não vai ao servidor); auto-unlock no ShareView
- `buildCapsuleDeepLink(shareId, passphrase?)`
- Deploy: https://mnemosyne-one.web.app

## Update — performance + onboarding + deep-links

- `utils/graphPerformance.ts` — LOD high→ultra-low (até 10k, renderiza subset ranqueado)
- Grafo mostra badge `LOD · N de M · detail`
- `OnboardingTour` — 6 passos, localStorage `mnemosyne.onboarding.v1.done`
- Deep-links: `/?memory=ID` e `/universe?memory=ID` + copiar link no painel/detalhe
- Deploy: https://mnemosyne-one.web.app

## Update — polish total (visão cognitiva)

- Grafo: empty state real, birth flash em nós novos, partículas nos links, legendas
- Universo 3D: `spawnedMemoryId` flash ao criar, halo cyan/violet, ligações mais vivas
- Command palette: PT, ↑↓ Enter, Universo/Comms/Definições, secções
- Painel de ação do grafo: glass violet, título
- Deploy hosting OK

## Update — Flow + Universo + deploy

### Flow (`CognitiveInput`)
- Auto-focus, rascunho em sessionStorage
- Chips de ação sempre visíveis (scroll mobile)
- Preview de “ecos” no grafo enquanto escreves
- Banner pós-cristalização + toast com nº de ligações
- Foco no nó no grafo após criar (`onMemoryCreated`)
- Footer com contagem de palavras / atalhos

### Universo
- `MemoryInputPanel` em PT, toast, foca memória após lançar
- `MemoryDetail` em PT, painel glass, ligações clicáveis
- `UniverseHUD` compacto (tipo + observatório)
- Search dock com lista de resultados clicáveis (Ctrl+K)
- Tips de navegação dismissíveis

### Deploy
```
firebase deploy --only hosting --project mnemosyne-one
→ https://mnemosyne-one.web.app
```

---

## O que foi feito nesta sessão (ownership full-stack)

### Segurança / Zero-Knowledge
- Mnemónica só em `sessionStorage` via `utils/sessionMnemonic.ts`
- Idle lock ~45 min + aviso ~5 min antes (`mnemosyne:session-idle-warn`)
- Scrub de chaves legadas em `localStorage` no boot
- Warm-up não bloqueante do modelo de embeddings após unlock
- **Links públicos em texto claro removidos**
  - `ShareModal` gera apenas **cápsula cifrada** (AES-GCM + PBKDF2, passphrase out-of-band) ou export local
  - Preferência UI: Comms E2E
  - `ShareView` desbloqueia com passphrase; links legados mostram aviso
- Privacy policy atualizada com secção honesta “ZK — o que é e o que não é”
- Fair-use técnico: `config/fairUse.ts` + limites Founder Preview em `planLimits.ts`

### Free-first / mercado
- Default continua `free-first`
- Pricing page: hero Founder Preview + features honestas
- Login hero: badge Founder Preview
- Anexos: teto por ficheiro via `FAIR_USE.maxAttachmentMB` (25 MB)

### UI/UX
- Header da app: brand, contagem de memórias/ligações, badge Founder Preview, Definições + Sair
- Dock inferior (`mnem-dock`) — scroll horizontal em mobile, estados ativos, Web/Universe/Comms
- Insights panel: labels PT, títulos de memórias, fechar, stats órfãs, dicas acionáveis
- Universe HUD: PT, glass bar
- Login About: copy ZK honesto

### Ficheiros novos
- `frontend/src/config/fairUse.ts`
- `frontend/src/utils/sessionMnemonic.ts`
- `frontend/src/utils/encryptedShare.ts`

### Ficheiros principais alterados
- `App.tsx`, `index.css`, `ShareModal.tsx`, `ShareView.tsx`
- `InsightsPanel.tsx`, `LoginPage.tsx`, `PricingPage.tsx`, `PrivacyPage.tsx`
- `planLimits.ts`, `AttachmentUploader.tsx`, `CognitiveInput.tsx`, `UniverseHUD.tsx`

## Ainda em aberto (próxima sessão)
1. **Migrar functions.config → defineSecret/params** (urgente — ver doc Big Tech §5)
2. Teste multi-user real Comms (2 contas / 2 browsers) + vídeo demo
3. ~~Emulator tests rules~~ ✅ código; correr com emulator se necessário
4. App Check: site key produção + enforce
5. Entitlements server-owned (subscription não editável pelo cliente)
6. ~~PIN opcional~~ ✅ · ~~Node 22~~ ✅ · ~~rate limit server~~ ✅ · ~~deploy~~ ✅
7. Playwright E2E no CI (além do pipeline vitest)
8. Play closed testing mobile pairing
9. Export soberano + threat model formal

## Como validar localmente
```powershell
cd W:\real\Mnemosyne\frontend
npm run build
npm run lint
```

## Notas de produto
- Comunicação: Founder Preview gratuito — **não** “grátis para sempre”
- ZK de conteúdo ≠ anonimato total (Firebase Auth/metadados)
- Stripe permanece latente até `VITE_MONETIZATION_MODE=paid` ou `VITE_ENABLE_CHECKOUT=true`
