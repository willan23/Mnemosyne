/**
 * Starter Universe — pack Founder (conteúdo real, não lorem).
 * O founder pode alargar este ficheiro; o assimilador trata qualquer tamanho ≤150.
 *
 * Formato compatível com o parser Obsidian (path + markdown com frontmatter/wikilinks).
 */

import type { TaxonomyLane, ProjectStatus } from '../utils/taxonomy';

export interface StarterNoteSeed {
  /** Caminho estilo vault, ex. "B Projetos/mnemosyne-core.md" */
  path: string;
  markdown: string;
}

export const STARTER_FOUNDER_ID = 'starter-founder-v1';
export const STARTER_FOUNDER_TITLE = 'Starter Founder';
export const STARTER_FOUNDER_NOTE_COUNT = 42;

const note = (
  path: string,
  title: string,
  lane: TaxonomyLane,
  body: string,
  extra?: { status?: ProjectStatus; tags?: string[] },
): StarterNoteSeed => {
  const tags = ['starter', 'founder', ...(extra?.tags || [])];
  const lines = [
    '---',
    `title: ${title}`,
    `lane: ${lane}`,
  ];
  if (extra?.status) lines.push(`status: ${extra.status}`);
  lines.push(`tags: [${tags.join(', ')}]`, '---', '', body.trim(), '');
  return { path, markdown: lines.join('\n') };
};

/**
 * 42 notas reais sobre construir um Cognitive OS soberano.
 * Wikilinks cruzados para o céu nascer ligado.
 */
export const STARTER_FOUNDER_NOTES: StarterNoteSeed[] = [
  // ── A Diário ──────────────────────────────────────────
  note('A Diário/abertura-founder-preview.md', 'Abertura Founder Preview', 'A', `
Hoje o Mnemosyne está em **Founder Preview**: gratuito para aprender a categoria, sem fingir "grátis para sempre".

O ecrã principal é o [[Universo 3D]]. Se estiver vazio, o aha falha. Por isso existe o [[Starter Founder]].

Prometo a mim: não vender feature que o código não cumpre. Ver [[Regras do projeto]].
`, { tags: ['diario'] }),

  note('A Diário/porque-nao-pastas.md', 'Porque não pastas rígidas', 'A', `
O Obsidian ganha com pastas A–E como **rampa**. O Mnemosyne ganha com memórias + ligações + clusters.

Pastas no import viram hubs e tags \`lane:A\`…\`lane:E\`, nunca schema Firestore. Ver [[Taxonomia A-E]] e [[Importer Obsidian]].
`),

  note('A Diário/medo-da-mnemónica.md', 'Medo da mnemónica', 'A', `
Perder as 12 palavras = perder o cofre. Isso é honesto, não um bug.

Mitigações UX: backup guiado, PIN local, WebAuthn vault. Nunca "recuperação mágica" pelo suporte. Ver [[Modelo de ameaça honesto]].
`),

  note('A Diário/primeiro-aha-90s.md', 'Primeiro aha em 90s', 'A', `
Fluxo alvo:

1. Auth + desbloquear mnemónica
2. Empty com [[Starter Founder]] ou [[Importer Obsidian]]
3. Céu acende
4. Abrir um planeta e ler

Se o tour de 6 passos bloquear isto, o tour está errado. Ver [[First-run]].
`),

  note('A Diário/nota-de-campo-comms.md', 'Nota de campo Comms', 'A', `
Comms E2E existe (relay + P2P). O que falta para GTM é **prova multi-user** gravada — duas contas, pedido de contacto, cápsula.

Não inventar "rede social cognitiva" ainda. Ver [[Cápsulas como distribuição]].
`),

  note('A Diário/custo-de-ia.md', 'Custo de IA', 'A', `
Local-first (Ollama) reduz OpEx. Cloud só com consentimento + rate limit.

Unit economics importam antes de Big Tech olhar para nós. Ver [[IA local e cloud]].
`),

  // ── B Projetos ────────────────────────────────────────
  note('B Projetos/mnemosyne-core.md', 'Mnemosyne Core', 'B', `
Produto: Cognitive OS soberano — capturar, ligar, reviver, transmitir pensamento privado.

Pilares: [[Universo 3D]], [[E2EE real]], embeddings + autolink, [[Comms E2E]], [[Cápsulas como distribuição]], sync mobile.

Estado: Founder Preview; Stripe latente. Ver [[Roadmap 30-60-90]].
`, { status: 'active', tags: ['projeto'] }),

  note('B Projetos/importer-obsidian.md', 'Importer Obsidian', 'B', `
Objectivo: pastas + \`.md\` + \`[[wikilinks]]\` + frontmatter → memórias cifradas + connections + clusters.

Estende o import de pasta Tauri / lote documental. Limite pragmático: 150 notas/import.

Feito quando: fixture com wikilinks resolve ≥80% das ligações. Ver [[Taxonomia A-E]].
`, { status: 'active', tags: ['projeto'] }),

  note('B Projetos/starter-founder.md', 'Starter Founder', 'B', `
Pack in-app (~40–120 nós) para o empty state deixar de ser void.

Conteúdo real sobre building; Dev Júnior fica para pack 2. Viagem: seed local → assimilate E2EE. Não forçar 100 nós numa cápsula de 12.
`, { status: 'active', tags: ['projeto'] }),

  note('B Projetos/modo-estudo.md', 'Modo estudo', 'B', `
Thin slice: PDF/anexo | nota | ligações, sem sair do [[Universo 3D]].

Não é Hypothes.is. PDF scaneado: limite OCR honesto. Ver [[Biblioteca de leitura]].
`, { status: 'planned', tags: ['projeto'] }),

  note('B Projetos/hud-taxonomia.md', 'HUD taxonomia', 'B', `
Chips A–E no HUD filtram por \`lane:*\`. Estados de projecto: planeado / em curso / concluído nos nós B.

Mapear a tipos celestes existentes (7) — não criar 10 meshes. Ver [[Taxonomia A-E]].
`, { status: 'active', tags: ['projeto'] }),

  note('B Projetos/export-soberano.md', 'Export soberano', 'B', `
ZIP local com memórias + grafo + chaves públicas. Já existe no produto P3.

Exit strategy do user = trust. Complementa [[Starter Founder]] (entrada) com saída honesta.
`, { status: 'done', tags: ['projeto'] }),

  note('B Projetos/equipas-e2ee.md', 'Equipas E2EE', 'B', `
P3: até 10 membros, teamKey no dispositivo, wraps RSA no servidor, \`teamAudit\` sem plaintext.

Fora: SSO, SCIM, multi-tenant enterprise. Ver [[Regras do projeto]].
`, { status: 'done', tags: ['projeto'] }),

  note('B Projetos/demo-20s.md', 'Demo 20s', 'B', `
Shot list: void → Starter → birth flash → filtro B → modo estudo.

Um vídeo vale mais que um manifesto. Ver [[First-run]] e [[GTM Founder Preview]].
`, { status: 'planned', tags: ['projeto'] }),

  // ── C Fundamentos ─────────────────────────────────────
  note('C Fundamentos/universo-3d.md', 'Universo 3D', 'C', `
Representação espacial do pensamento: sóis (hubs), planetas, cometas, nebulosas.

LOD até ~10k nós. Empty state: proto-estrelas + CTA. O grafo 2D do Obsidian é referência de densidade, não de UI.
`),

  note('C Fundamentos/e2ee-real.md', 'E2EE real', 'C', `
Texto e título saem do cliente como \`enc:{v,iv,ct}\` (AES-GCM). O servidor não lê plaintext.

Trade-off documentado: embeddings, tags, category, connections e posições ficam em claro. Ver [[Modelo de ameaça honesto]] e /security.
`),

  note('C Fundamentos/taxonomia-a-e.md', 'Taxonomia A-E', 'C', `
- **A Diário** — captura rápida, cometas
- **B Projetos** — planetas + estado
- **C Fundamentos** — estrelas / conceitos
- **D Ferramentas** — luas / stack
- **E Biblioteca** — nebulosas / refs

Rampa humana. Modelo de dados = memórias + ligações.
`),

  note('C Fundamentos/modelo-ameaca.md', 'Modelo de ameaça honesto', 'C', `
Firebase Auth ≠ anonimato. Operador vê metadados. Perda da mnemónica = perda do vault.

Não pedir a frase ao suporte. Não fingir ZK absoluto. Ver [[E2EE real]].
`),

  note('C Fundamentos/regras-projeto.md', 'Regras do projeto', 'C', `
1. Corrigir falhas reais
2. Eliminar mocks e fake UX
3. Comportamento seguro (E2EE)
4. Não activar Stripe/SSO/SOC2-cert/Play pública sem pedido
5. Não inventar features
6. Agente tipo Cursor no cofre = slice futuro
`),

  note('C Fundamentos/first-run.md', 'First-run', 'C', `
90 segundos até o céu fazer sentido. Tour educativo é secundário.

CTAs: [[Starter Founder]] | [[Importer Obsidian]] | escrever a primeira memória.
`),

  note('C Fundamentos/comms-e2e.md', 'Comms E2E', 'C', `
Relay cifrado + P2P. Friend requests. Cápsulas sem plaintext no servidor.

Tração multi-user ainda é o risco. Ver [[Cápsulas como distribuição]].
`),

  note('C Fundamentos/ia-local-cloud.md', 'IA local e cloud', 'C', `
Ollama local por defeito. Cloud (generate/research) com auth + rate limit fail-closed.

Picker só mostra modelos que a app realmente chama.
`),

  // ── D Ferramentas ─────────────────────────────────────
  note('D Ferramentas/stack-frontend.md', 'Stack frontend', 'D', `
React 19 + Vite + Three.js (Universo) + Tauri 2 + Capacitor.

Estado do universo: Zustand. i18n: pt-PT / pt-BR / EN / FR.
`),

  note('D Ferramentas/stack-firebase.md', 'Stack Firebase', 'D', `
Firestore + Functions Node 22 (\`europe-west1\`) + Storage + Hosting.

Rules: entitlements server-owned; shares só cifradas. Stripe código pronto, live off.
`),

  note('D Ferramentas/tauri-import.md', 'Tauri folder import', 'D', `
\`tauriFolderImporter\` lê pastas recursivamente. Capabilities: fs scoped (HOME/Documents/…).

O [[Importer Obsidian]] reutiliza este caminho e especializa Markdown.
`),

  note('D Ferramentas/capsule-service.md', 'Capsule service', 'D', `
Pack marker \`[[MNEMOSYNE_CAPSULE_PACK_V1]]\`, assimilate expande até 12 itens.

Para starters grandes usar seed in-app, não cápsula. Ver [[Cápsulas como distribuição]].
`),

  note('D Ferramentas/cognitive-engine.md', 'Cognitive engine', 'D', `
Embeddings locais, importância, tipo celeste, autolink.

Em imports em massa podemos gravar links explícitos primeiro e deixar backfill semântico depois.
`),

  note('D Ferramentas/testes-ci.md', 'Testes e CI', 'D', `
Vitest no frontend; tests nas functions; rules emulator.

CI: \`ci.yml\` em PRs. Sem Playwright browser ainda — gap conhecido, não bloqueia estes slices.
`),

  note('D Ferramentas/sovereign-export.md', 'Sovereign export tool', 'D', `
\`sovereignExport.ts\` — ZIP local. Par simétrico da entrada via [[Starter Founder]] / vault.
`),

  note('D Ferramentas/rate-limit.md', 'Rate limit server', 'D', `
Sliding window Firestore por UID: research 40/h, text 60/h, image 20/h, publicApi 120/h. Fail-closed.
`),

  // ── E Biblioteca ──────────────────────────────────────
  note('E Biblioteca/obsidian-como-referencia.md', 'Obsidian como referência', 'E', `
O que copiar: densidade day-1, wikilinks, taxonomia humana, estudo PDF+nota.

O que não copiar: pastas como arquitectura, venda de cheatsheets, grafo 2D como ecrã principal.
`),

  note('E Biblioteca/notion-reflect-mem.md', 'Notion Reflect Mem', 'E', `
Categoria vizinha: notas + IA. Diferenciação Mnemosyne: universo espacial + E2EE de conteúdo + free-first soberano.

Benchmark honesto > slide de marketing. Ver gap Big Tech doc.
`),

  note('E Biblioteca/biblioteca-leitura.md', 'Biblioteca de leitura', 'E', `
Anexos PDF viram memórias com resumo extractivo local.

[[Modo estudo]] é a camada UX em falta: ler e anotar sem sair do céu.
`),

  note('E Biblioteca/capsulas-distribuicao.md', 'Cápsulas como distribuição', 'E', `
Hoje: partilha 1:1 / pack curto. Amanhã: starters e curricula via seed/ZIP.

Cápsula cifrada continua correcta para segredos out-of-band; não é CDN de 150 nós.
`),

  note('E Biblioteca/gtm-founder-preview.md', 'GTM Founder Preview', 'E', `
Mensagem: Founder Preview · céu que acende · importas o teu vault no cliente.

Evitar: grátis para sempre · ZK absoluto · substitui Obsidian a 100%.
`),

  note('E Biblioteca/roadmap-30-60-90.md', 'Roadmap 30-60-90', 'E', `
30d: importer + starter + HUD + first-run.
60d: estudo + polish + demo 20s.
90d: métricas, spec cápsula aberta, pentest — sem reabrir enterprise.
`),

  note('E Biblioteca/bigtech-lens.md', 'Lente Big Tech', 'E', `
Moat: experiência + privacy. Falta: escala, compliance, tração.

Este ciclo de produto ataca o **aha** e a migração a partir do Obsidian — não SOC2.
`),

  note('E Biblioteca/wikilinks-como-grafo.md', 'Wikilinks como grafo', 'E', `
\`[[Nota]]\` no Obsidian = intenção humana de ligação.

No Mnemosyne: persistir em \`connections\` na importação (F4). Autolink semântico é complemento, não substituto.
`),

  // ── extras para densidade (ainda reais) ───────────────
  note('A Diário/rituais-semanais.md', 'Rituais semanais', 'A', `
Domingo: rever lane B (projectos em curso). Quarta: uma nota em C que ligue a E.

O [[Pulso cognitivo]] já existe no produto — usar, não reinventar.
`),

  note('B Projetos/pulso-cognitivo.md', 'Pulso cognitivo', 'B', `
Ritual diário: tensões, ecos, órfãs. Já shipped.

Não faz parte destes 4 slices; referência para não duplicar insights.
`, { status: 'done', tags: ['projeto'] }),

  note('C Fundamentos/positive-decay.md', 'Positive decay', 'C', `
Memórias frias podem comprimir/arquivar sem apagar soberania.

Gap P1 no doc Big Tech — fora deste ciclo, mas o starter menciona para honestidade.
`),

  note('D Ferramentas/lod-performance.md', 'LOD performance', 'D', `
\`graphPerformance.ts\` ranqueia subset a renderizar. Starter de ~40–120 nós cabe em LOD high sem drama.
`),
];

// Sanity: keep exported count honest
if (STARTER_FOUNDER_NOTES.length !== STARTER_FOUNDER_NOTE_COUNT) {
  // Soft check for maintainers; runtime still works if counts drift.
  console.warn(
    `[starterFounder] NOTE_COUNT=${STARTER_FOUNDER_NOTE_COUNT} but notes=${STARTER_FOUNDER_NOTES.length}`,
  );
}
