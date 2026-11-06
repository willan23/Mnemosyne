# SOC 2 Type I — inventário de controlos (não é certificação)

**Data:** 1 de setembro de 2026  
**Âmbito:** Mnemosyne (`mnemosyne-one`, `europe-west1`)  
**Isto não é um relatório SOC 2.** É a lista interna do que já existe e do que falta antes de contactar um auditor. Ninguém deve citar esta página como “estamos certificados”.

Contacto de incidente / DPA: `suporte@mnemosyne-one.com`.  
Nunca pedir a mnemónica BIP-39, PIN local, teamKey em claro, nem backups da frase.

| Controlo | Estado agora | O que falta | Dono |
|---|---|---|---|
| Acesso (Auth + rules) | Firebase Auth; `firestore.rules` com writes de `teams` / `teamInvites` / `teamAudit` só via Admin SDK; entitlements de plano no cliente + rules | Reviews trimestrais das rules por escrever; evidência de quem aprovou cada alteração | Engenharia |
| TLS em trânsito | Hosting + Functions (HTTPS Google) | — | Plataforma (Google) |
| Conteúdo em repouso | E2EE cliente: memórias `enc:{v,iv,ct}`; teamKey só no dispositivo, wraps RSA no servidor | Documentar no pacote do auditor: o operador **não** tem plaintext. Embeddings/tags ficam em claro (trade-off em `/security`) | Engenharia + /security |
| Audit de admin | Coleção `teamAudit` append-only: `created`, `invited`, `accepted`, `left`, `deleted`, `role_changed`. Campos: `teamId`, `at`, `actorUid`, `action`, `targetUid`. Sem `text` / `title` / `enc` | UI de leitura opcional; retenção formal; export para SIEM | Engenharia |
| App Check | Cliente: `initAppCheckIfConfigured()` se `VITE_FIREBASE_APPCHECK_SITE_KEY` existir. **Sem enforce** nas functions (parte Tauri, clipper, `publicApi` Bearer) | 1) reCAPTCHA v3 + App Check no projeto, modo **monitor**. 2) Site key em `frontend/.env.local` e secret GitHub. 3) Enforce selectivo só depois do monitor verde e de um plano desktop | Tu (consola) + engenharia |
| Change management | CI (`ci.yml`) + `workflow_dispatch` `deploy.yml` | Registar quem fez cada deploy (data, SHA, operador). Changelog público em `/changelog` não substitui o log de deploy | Operações |
| Inventário de vendors | Google Cloud / Firebase (Auth, Firestore, Functions, Hosting, Storage). Stripe **latente** (código no repo, checkout off em Founder Preview) | Atualizar se Stripe ou outro subprocessador for ligado. Sem vendor de SSO até Identity Platform | Operações |
| IR / incidente | Contacto: `suporte@mnemosyne-one.com`. O operador **não** pede mnemónicas nem tenta “recuperar” o cofre. Conteúdo cifrado não é recuperável pelo suporte | Playbook de 1 página com severidades, SLA interno, e o que comunicar (sem fingir acesso a plaintext) | Operações |
| Backup / restore | Firestore nativo (Google) | Confirmar PITR na consola do projeto. Teste de restore **não** está feito neste ciclo | Tu (consola) |
| Vuln / deps | `npm test` no CI (frontend + functions) | Dependabot / avisos de deps se ainda não; pentest externo não está no âmbito | Engenharia |
| Papéis de equipa | `roles` em `teams`: owner / admin / member. Admin pode convidar; `deleteTeam` é owner-only | Sem orgs multi-tenant, impersonation, ou SCIM | Engenharia |
| API pública | Bearer `mne_live_`; recusa plaintext; OpenAPI `functions/openapi-v1.yaml`; SDK local `@mnemosyne/sdk` | Publicação npm **não** feita (pacote `private`) | Engenharia |

## Incidente — o que não se faz

1. Não pedir a frase de 12 palavras, o PIN, nem a teamKey.  
2. Não tentar decifrar `enc` no servidor. Não há chave do operador.  
3. Não ligar Stripe, webhooks, nem preços live sem pedido explícito do dono do produto.  
4. Não ativar `enforceAppCheck` global: parte o desktop Tauri, o clipper e a API com Bearer.

## Próximo passo rumo a Type I

Fechar App Check em **monitor** na web, PITR confirmado, log de deploys, e um auditor escolhido. A certificação é um projeto separado — este ficheiro é só input.
