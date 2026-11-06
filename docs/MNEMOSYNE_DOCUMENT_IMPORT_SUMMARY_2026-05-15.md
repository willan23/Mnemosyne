# Mnemosyne Document Import And Summary

Data: 2026-06-15 · **Atualização 2026-09-14:** vault Obsidian + Starter Founder

Objetivo: ficheiros e pastas carregados pelo utilizador devem virar conhecimento navegavel no universo, nao apenas anexos guardados.

## Extensão — Vault Obsidian e Starter (14 set 2026)

- **Import Obsidian:** pasta com `.md` + frontmatter YAML simples + `[[wikilinks]]` → memórias E2EE; wikilinks resolvidos → `connections`; pastas de topo A–E → `taxonomyLane` / tags (não schema de pastas). Limite: 150 notas. Auto-detect quando a maioria dos ficheiros é Markdown.
- **Código:** `frontend/src/services/obsidianVaultParse.ts`, `obsidianVaultImport.ts`; UI no empty state, chip “Vault Obsidian” / pasta no `CognitiveInput`, drop no Universo.
- **Starter Founder:** seed in-app (`frontend/src/data/starterFounder.ts`, 42 notas) assimilado localmente para o first-run. Expandir o ficheiro para densificar o céu.
- **Fora de âmbito:** plugins Obsidian, Dataview, sync bidirecional, OCR em PDF scaneado.

## Estado alvo desta entrega (Atualizado em 2026-06-15)

- O utilizador pode largar/carregar ate 20 ficheiros por lote, ou importar pastas inteiras recursivamente através do Tauri (Tauri Native Folder Import).
- As **Configurações** e a captura no **Universo** têm importação directa do computador; no Tauri, abre-se o seletor nativo de pastas, que lê ficheiros recursivamente.
- O sistema extrai texto localmente quando o formato permite:
  - TXT, MD, CSV, JSON, HTML, XML, YAML;
  - Código fonte e configurações comuns (`.js`, `.jsx`, `.ts`, `.tsx`, `.rs`, `.py`, `.go`, `.c`, `.cpp`, `.h`, `.hpp`, `.java`, `.kt`, `.swift`, `.sh`, `.bat`, `.ps1`, `.sql`, `.css`, `.scss`, `.ini`, `.toml`, `.conf`, `.env`, `.jsonld`, `.mdx`);
  - PDF;
  - DOCX;
  - XLSX;
  - PPTX.
- Cada ficheiro gera uma memoria propria com metadados do ficheiro, resumo local, pontos principais, temas detectados, excerto indexado e anexo original.
- Imagens, videos e audios entram na mesma pipeline documental com uma camada multimodal local.
- O lote gera uma memoria-hub, ou "sistema solar documental", que liga todos os ficheiros importados.
- Geração de imagens via IA com suporte a múltiplos provedores (NVIDIA NIM SDXL, Hugging Face, OpenAI) com fallback automático, integrada no frontend e Cloud Functions.
- Remoção do bloqueio de anexos para a versão gratuita no ambiente Founder Preview (Free-First), permitindo a todos os utilizadores autenticados importar pastas de documentos e gerar/salvar imagens.

## Como o resumo funciona

O resumo documental e extractivo/local: o Mnemosyne pontua frases pelo vocabulario mais recorrente, preserva frases informativas, remove repeticoes e apresenta os pontos principais. Isto nao substitui uma analise LLM profunda, mas ja entrega uma vista util sem depender de Hugging Face, NVIDIA, OpenAI ou outra cloud.

A camada multimodal usa modelos Transformers.js no cliente. O browser pode baixar pesos de modelos a partir do Hugging Face Hub/cache, mas o ficheiro privado analisado permanece local durante captioning, OCR e transcricao. Se o modelo nao carregar, se o browser nao suportar a decodificacao, ou se o media for pesado demais, o sistema guarda a limitacao dentro da memoria em vez de fingir uma analise.

Quando um provider de IA for explicitamente autorizado pelo utilizador no AI Hub, uma camada futura pode gerar um resumo abstrativo mais parecido com assistente. Essa camada deve continuar a respeitar a politica Zero-Knowledge/consentimento.

## Limites conhecidos

- PDF digital funciona melhor que PDF digitalizado. PDF escaneado precisa de OCR, ainda nao implementado.
- DOC antigo `.doc` nao e extraido localmente; fica anexado e indexado por metadados.
- Video/imagem/audio ja recebem analise semantica local best-effort, mas modelos pequenos podem falhar ou ser menos precisos que uma analise cloud explicitamente autorizada.
- Transcricao de video depende do browser conseguir decodificar a faixa de audio; alguns MP4/MOV podem ficar apenas com analise de frames.
- XLSX muito grande pode produzir resumo a partir das celulas extraidas, nao uma analise completa de planilha.

## Validação e Prontidão de Produção (2026-06-15)

- **Importação de Pastas Nativa no Tauri:**
  - Dependências Rust `tauri-plugin-dialog` e `tauri-plugin-fs` instaladas e ativas no Cargo.toml e main.rs.
  - Permissões de leitura global `"fs:read-all"` concedidas em `capabilities/default.json`.
  - Helper `tauriFolderImporter.ts` implementado para realizar a leitura recursiva de pastas e enviar os lotes para o `learningService.ts`.
- **Geração de Imagem com Fallbacks:**
  - Cloud Functions e frontend atualizados com suporte a NVIDIA NIM SDXL, Hugging Face e OpenAI.
  - Endpoint de backend de IA apontando fixamente para a Cloud Function de produção em `https://mnemosyne-one.web.app` para evitar erros locais.
- **Regras do Firestore e Storage Ajustadas:**
  - Acesso universal à escrita de anexos (`attachments`) liberado para todos os utilizadores autenticados durante a fase Founder Preview (`firestore.rules`).
  - Storage rules configuradas para aceitar uploads de qualquer tipo de arquivo de até 200MB, evitando que arquivos sem extensão explícita falhem.
- **Compilação e Deploy Concluídos:**
  - Front-end (`npm run build --prefix frontend`), Cloud Functions (`npm run build --prefix functions`) e Tauri Cargo Check executados com zero erros.
  - Deploy completo realizado no Firebase (`hosting`, `functions`, `firestore:rules`).

Os testes efetuados pelo utilizador confirmaram o correto funcionamento da geração de imagens, importação nativa de pastas e assimilação de múltiplos formatos de arquivos de código e texto sem restrições.
