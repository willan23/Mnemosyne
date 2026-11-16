# Pesquisa com checkpoints validados em memória

## Problema e alteração

Cada consulta do perfil selecionado voltava a ler IndexedDB, decifrar e validar o digest de todas as memórias candidatas, mesmo quando os objetos imutáveis das sessões eram os mesmos. `PreparedEmbeddingSearchCache` conserva temporariamente os vetores já validados por `readPreparedEmbedding`. A pesquisa continua a gerar o vetor da nova consulta e a comparar cada grupo apenas com o seu próprio espaço de modelo.

A cache pertence ao hook `useSessions`. Uma nova referência de sessão é revalidada; referências inalteradas podem reutilizar o vetor. Não se guardam ausências ou falhas, permitindo uma leitura posterior de um checkpoint entretanto preparado ou reparado. Não se alteram checkpoints, dados Firestore, modelos, critérios de qualidade ou limiar 0,38.

## Âmbito e invalidação

A cache tem um único UID/perfil e chaves fracas pelos objetos imutáveis. Mudanças da chave do cofre, da geração/seleção do perfil local ou de outro separador invalidam-na imediatamente. O hook também a elimina ao mudar conta/equipas, bloquear, sair da pesquisa ou desmontar. Uma leitura pendente captura a geração e não pode repor valores depois de uma invalidação, mesmo numa mudança A→B→A. Cancelar uma consulta não elimina os vetores válidos de consultas já concluídas.

São conservados até 8.192 vetores e 32 MiB de valores numéricos contabilizados a oito bytes por componente. Ao atingir um limite, as referências da cache são descartadas e a pesquisa prossegue com leituras normais, sem truncar resultados. A contagem é conservadora quando chaves fracas são recolhidas. Estes limites não medem a heap total JavaScript, o Worker ou a aplicação e não garantem apagamento físico da memória. A cache não acrescenta persistência, rede ou telemetria de conteúdo.

A reutilização pressupõe objetos de sessão imutáveis, como os produzidos pelo listener e usados pelos restantes índices. Uma edição cria uma referência nova. Um vetor autenticado em cache não é uma monitorização contínua de alterações manuais no IndexedDB; preparação concluída do perfil selecionado e descarte/rollback emitem a invalidação de seleção existente.

## Validação

- **50 testes frontend em sete ficheiros**, sem falhas ou omissões, incluindo cache, pesquisa selecionada, hook, reindexação, promoção e clientes de índice. A passagem final conserva os mesmos casos, asserts e timeouts.
- **Chromium, AES-GCM e IndexedDB reais**, com 64 memórias sintéticas. Leituras de checkpoints: primeira consulta 64; outra consulta com as mesmas memórias 0; uma edição 1; mudança A→B→A da chave 64; alteração real de localStorage noutro separador 64; reload 64. A identidade, os vetores de consulta e o ranking são sintéticos; não houve inferência ou avaliação de qualidade neste ensaio.
- O mesmo ensaio recusou checkpoint corrompido e leitura concluída após mudança de seleção, voltou a ler depois de reparação/preparação, isolou conta/perfil e excluiu equipa, partilha, bloqueio e eliminação. Zero pedidos externos ou operações de produção.
- Build TypeScript/Vite e lint dos seis ficheiros TypeScript: zero erros/avisos no âmbito. A primeira compilação recusou uma parameter property por `erasableSyntaxOnly`; a propriedade passou a ser declarada e atribuída explicitamente. A tentativa seguinte e o arranque de uma verificação sobreposta falharam ao abrir `public/version.json`, ficheiro gerado partilhado por Vite/Vitest. A passagem final executa testes e build em sequência, com os mesmos asserts/timeouts; a causa exata do erro de abertura no Windows não foi demonstrada. Os logs anteriores foram conservados. Os avisos de bundle/imports conhecidos são registados no log do build final.

O comando reproduzível do ensaio é `node scripts/prepared-embedding-cache-browser.cjs`, acrescentado ao job frontend de CI. A configuração local não comprova execução remota. As suites gerais e as regras não foram repetidas por esta alteração; a [baseline integral de Rules](VALIDACAO_INTEGRAL_RULES_2026-10-23.md) conserva o seu âmbito anterior.

## Requisitos que permanecem

Esta alteração reduz leituras/decifrações repetidas entre consultas. A primeira leitura, mudanças de conteúdo e invalidações continuam a ter custo. Os percursos O(N) de snapshots, ACL/projeção na interface e comparação vetorial, qualidade de abstenção, promoção multilingue global e pilotos reais continuam por concluir. Não se declara a fase 5 completa.

Evidência privada em `W:/real/mnemosyne-launch-evidence/prepared-cache-validation-20261024/` e prova `prepared-cache-local-validation-20261024.json`, encadeada a `rules-integral-local-validation-20261023.json`. **Os 49 gates permanecem fechados; as fases 0–6 continuam exigidas antes do deploy completo autorizado.** Não houve deploy, alteração de produção, leitura de payloads de secrets ou pedido generativo neste incremento.
