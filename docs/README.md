# Mnemosyne Docs

**Última atualização:** 25 de Julho de 2026 (v1.0.7)  
**Domínio Oficial:** https://mnemosyne-one.com  
**Produção (Hosting):** https://mnemosyne-one.web.app  
**Workspace:** `W:\real\Mnemosyne`

Esta pasta contém o estado vivo do trabalho: produto, mercado, conformidade e operações.

## Documentos principais (ler por ordem se fores novo)

| Documento | Para quê |
|-----------|----------|
| [**Documento Geral do Sistema**](./MNEMOSYNE_DOCUMENTO_GERAL_DO_SISTEMA.md) | Visão de produto, conceitos, fluxos, domínio e estado atual |
| [**Gaps Big Tech + Migração Functions**](./MNEMOSYNE_BIGTECH_GAP_AND_FUNCTIONS_MIGRATION_2026-07-18.md) | O que falta para escala/atratividade M&A e plano de sair de `functions.config()` |
| [Handoff da próxima sessão](./MNEMOSYNE_NEXT_SESSION_HANDOFF.md) | Ponto exato de continuação (changelog recente) |
| [Roadmap para mercado](./MNEMOSYNE_MARKET_READINESS_ROADMAP.md) | Fases até lançamento / free-first |
| [Estado de produto](./MNEMOSYNE_PRODUCT_STATUS_2026-05-11.md) | Baseline de features |
| [Free-first strategy](./MNEMOSYNE_FREE_FIRST_STRATEGY_2026-05-12.md) | Estratégia comercial de entrada |
| [WAF System Review](./MNEMOSYNE_WAF_SYSTEM_REVIEW_2026-05-12.md) | Well-Architected e visão de motor espacial |

## Mobile / Play Store

- [Play Store Release Guide](./MNEMOSYNE_PLAYSTORE_RELEASE_GUIDE_2026-05-12.md)
- [Play Store Listing Copy](./MNEMOSYNE_PLAYSTORE_LISTING_COPY_2026-05-13.md)
- **Status Play Store**: App Android desenvolvida via Capacitor 8, em testes internos (**ainda não disponível publicamente na Play Store**).

## Snapshot técnico (Julho 2026)

| Área | Estado |
|------|--------|
| Frontend | React 19 + Vite + Tauri 2.0 + Capacitor; grafo 3D + Universe; updater purgado |
| Domínio | `mnemosyne-one.com` ativo e vinculado ao `mnemosyne-one.web.app` |
| Pagamentos | Stripe integrado; **temporariamente inativo/Founder Preview** em produção |
| Segurança | ZK mnemónica session-only; PIN local; shares cifradas only; idle lock |
| Comms | Multi-user E2E + friend requests + P2P; `commsService` |
| IA | Local/cloud consentida; rate limit client + **server-side** |
| Functions | **Node.js 22**; rate limits Firestore; `cleanupMobileSyncRetention` |
| Hosting | `mnemosyne-one.web.app` (deploy ativo) |

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
firebase deploy --only "functions" --project mnemosyne-one

# App completa
cd W:\real\Mnemosyne
firebase deploy --only "hosting,firestore:rules,functions" --project mnemosyne-one
```
