# Mnemosyne

Sistema de memória cognitiva espacial. O ecrã principal é o **Universo 3D** — não há vista “Flow”.

[mnemosyne-one.com](https://mnemosyne-one.com) · [app (Firebase Hosting)](https://mnemosyne-one.web.app) · [desktop Windows](https://mnemosyne-one.web.app/download) · [/security](https://mnemosyne-one.web.app/security) · [/enterprise](https://mnemosyne-one.web.app/enterprise) · [/changelog](https://mnemosyne-one.web.app/changelog)

React 19 · TypeScript · Three.js · Firebase · Tauri 2 (Windows) · Capacitor (Android, ainda não na Play Store)

---

## O que o produto faz

- **Universo** — memórias como nós 3D; captura, pesquisa e grafo no mesmo ecrã.
- **E2EE real** — texto e título cifrados no cliente (AES-GCM-256, chave derivada da mnemónica BIP-39). O Firestore guarda `enc:{v,iv,ct}`. Embeddings e metadados do grafo ficam em claro (trade-off em `/security`).
- **API REST + MCP** — keys Bearer criadas na conta. Operam sobre documentos persistidos; o servidor **não** deriva a mnemónica nem decifra o cofre.
- **Clipper** — extensão Manifest V3 (Chrome/Edge): título, URL e seleção → web app. A cifra acontece depois do vault aberto.
- **Hotkey** — `Ctrl+Shift+M` (desktop Tauri global; no browser só com o separador focado) foca a captura no Universo.
- **Equipas** — espaços E2EE (teamKey no cliente, wraps RSA no servidor). Até 10 membros no Founder Preview.
- **Export soberano** — ZIP local (JSON + manifest + grafo) com texto já decifrado; passphrase opcional.
- **Idiomas** — pt-PT, pt-BR, inglês, francês na app e páginas públicas. Sem espanhol.
- **Desktop Windows** — Tauri; installers em `/downloads`, updater em `/desktop/latest.json`.

Stripe Checkout / Billing Portal existe no código e **não está activo em produção** (Founder Preview / free-first).

---

## Arranque local

```powershell
cd W:\real\Mnemosyne\frontend
npm ci
npm run dev
```

```powershell
cd W:\real\Mnemosyne\functions
npm ci
npm test
```

Não commits `backend/.env` nem `updater.key`.

---

## Deploy

`deploy.ps1` na raiz faz build de functions + frontend e publica rules, functions e hosting. **Não há flag só-hosting** — para o site:

```powershell
cd W:\real\Mnemosyne\frontend
npm ci   # se o lock mudou
npm run build

cd W:\real\Mnemosyne
firebase deploy --only hosting --project mnemosyne-one
```

Deploy completo (só quando precisas de functions/rules):

```powershell
cd W:\real\Mnemosyne
.\deploy.ps1
```

CI de hosting usa `FIREBASE_SERVICE_ACCOUNT` + `FIREBASE_PROJECT_ID` (`firebase login:ci` / `FIREBASE_TOKEN` está descontinuado). Code signing Windows: [`docs/WINDOWS_CODE_SIGNING.md`](docs/WINDOWS_CODE_SIGNING.md).

---

## Documentação

O que um developer lê primeiro: este README, [`docs/README.md`](docs/README.md), [`docs/MNEMOSYNE_DOCUMENTO_GERAL_DO_SISTEMA.md`](docs/MNEMOSYNE_DOCUMENTO_GERAL_DO_SISTEMA.md).

Licença: proprietária / open-core. Contacto comercial: [mnemosyne-one.com](https://mnemosyne-one.com).
