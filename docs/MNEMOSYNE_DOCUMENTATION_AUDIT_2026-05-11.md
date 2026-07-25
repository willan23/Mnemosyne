# Mnemosyne Documentation Audit

Data: 2026-05-11

Objetivo: remover documentacao antiga que confundia o estado real do produto e manter apenas referencias com valor para arquitetura, estrategia ou design.

## Documentos removidos

- `MNEMOSYNE_INDEX.md`
  - Motivo: indice antigo apontava para documentos removidos/substituidos e para um fluxo de leitura desatualizado.

- `MNEMOSYNE_IMPLEMENTATION_ROADMAP.md`
  - Motivo: roadmap de 18 meses/36 sprints, substituido por `docs/MNEMOSYNE_MARKET_READINESS_ROADMAP.md`.

- `MNEMOSYNE_QUICK_START.md`
  - Motivo: instrucoes para criar projeto novo Vite/React, sem valor para o repo atual.

- `README_MNEMOSYNE.md`
  - Motivo: README antigo redundante com docs novas e com links para documentos removidos.

- `walkthrough.md`
  - Motivo: descrevia mocks e hints hardcoded de uma transformacao anterior; conflita com a regra atual de zero fake UX.

- `White Paper Tecnico_ Mnemosyne - O Biografo de Conhecimento Zero.md`
  - Motivo: afirmava "producao live" e Stripe pronto antes do hardening atual; podia induzir decisoes erradas.

## Documentos antigos mantidos

- `MNEMOSYNE_COGNITIVE_UNIVERSE_ENGINE.md`
  - Valor: taxonomia cognitiva/espacial e conceitos de categoria ainda uteis.

- `MNEMOSYNE_TECHNICAL_ARCHITECTURE.md`
  - Valor: referencia arquitetural detalhada; deve ser revista mais tarde contra o codigo atual.

- `MNEMOSYNE_VISUAL_SPECIFICATIONS.md`
  - Valor: linguagem visual, shaders e especificacoes de experiencia.

- `MNEMOSYNE_EXECUTIVE_SUMMARY.md`
  - Valor: narrativa executiva e posicionamento competitivo; pode ser reescrito depois para refletir o estado real.

- `Mnemosyne_Visao_Estrategica_cOS.md`
  - Valor: estrategia de categoria e monetizacao de alto nivel.

## Proxima limpeza recomendada

Depois de fechar Social Layer e monetizacao real, atualizar ou substituir:

- `MNEMOSYNE_EXECUTIVE_SUMMARY.md`
- `MNEMOSYNE_TECHNICAL_ARCHITECTURE.md`
- `MNEMOSYNE_COGNITIVE_UNIVERSE_ENGINE.md`

Esses ainda tem valor, mas nao devem ser tratados como documentacao operacional atual sem revisao.
