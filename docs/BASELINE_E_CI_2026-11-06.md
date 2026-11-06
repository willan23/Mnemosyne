# Baseline, dependências e CI — 6 de novembro de 2026

Esta revisão consolida a validação local do código completo e torna os cinco jobs da CI obrigatórios na branch principal. O lançamento completo continua em preparação: a CI remota foi recusada por um problema de faturação da conta GitHub e ainda há trabalho de produto e de rollout. A autorização de deploy permanece válida para depois de cumprir esses critérios.

## Baseline executada

Com Node 22.23.3 e JBR 21, a primeira passagem executou os comandos reais, sem suprimir falhas:

| Verificação | Resultado |
| --- | --- |
| `npm --prefix frontend run test -- --run --maxWorkers=1` | 2.161 aprovados, 231 ficheiros |
| `npm --prefix functions test` | 607 aprovados, zero falhas, uma omissão explícita de Rules fora do emulador |
| `npm --prefix frontend run lint` | Zero erros, 21 avisos |
| `npm --prefix frontend run build` e identidade de versão | Aprovados |
| `node scripts/run-rules-tests.js` | 328 Functions/Rules +25 frontend/Rules, sem falhas ou omissões |
| Audit de produção frontend | Zero vulnerabilidades |
| Audit de produção Functions inicial | Falhou com seis alertas moderados transitivos |

As Rules usaram o runner do repositório nas portas habituais, projeto demo explícito e emuladores locais. O único skip da suite geral Functions foi efetivamente executado na suite separada de emulador. A primeira passagem é conservada como **baseline com falha na auditoria**, não como aprovação global.

## Correção das dependências

A cadeia era `google-gax`/`gaxios` → `rimraf` 5.0.10 → `glob` 10.5.0 → `minimatch` 9.0.9. Os avisos publicados para [cancelamento de glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) e [amplificação de padrões minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249) identificam as versões corrigidas. A propagação da dependência vulnerável produzia os seis alertas.

O override de `rimraf` fixa 6.1.4, compatível com o Node 22 exigido pelo projeto. O lockfile resolve `glob` 14.0.4 e `minimatch` 11.0.5. Os clientes Google permanecem nas versões anteriores; não se aplicou `audit fix --force`. A instalação limpa com `npm ci --ignore-scripts --no-audit` concluiu com 343 packages. A atualização altera uma major transitiva; a compatibilidade foi verificada pelo build, suite geral Functions e transações/SDK reais no emulador.

Após a correção: **607 Functions aprovados, 328 Functions/Rules +25 frontend/Rules, 23 testes de contratos da CI e produção com zero vulnerabilidades nos dois packages**. Os testes, lint e build gerais do frontend acima foram reutilizados com fontes, dependências frontend e artefactos idênticos. As alterações deste incremento estão no manifest/lockfile, CI, scanner e documentação.

## Secret scanning e histórico

Gitleaks 8.29.1 detetou oito ocorrências na árvore atual. A revisão identificou dois identificadores públicos de configuração Firebase e cinco valores literais não secretos: nomes de armazenamento local, um caminho sintético de upload e dois UUIDs determinísticos de idempotência. Um valor repete-se em dois ficheiros.

`.gitleaks.toml` conserva todas as regras padrão. As exceções correspondem exclusivamente aos valores exatos revistos; não excluem caminhos, commits ou famílias de credenciais. A CI executa `scripts/secret-scan-policy.test.cjs`: três testes confirmam a versão, os valores aceites e a deteção/redaction de outros formatos Google, genérico e Stripe. O scan da árvore e do diff proposto passou.

O scan histórico inicial continua a assinalar possíveis credenciais antigas, incluindo NVIDIA, uma chave de teste Stripe e um segredo de webhook Stripe em ficheiros antigos. A confirmação anterior do operador sobre a revogação NVIDIA não é uma verificação independente no fornecedor. O histórico não foi reescrito nem os achados reais foram adicionados a exceções. Credenciais de fornecedor e webhook devem ser substituídas pelo procedimento de secrets/rollout; não se deve restaurar um valor antigo a partir do Git.

## CI obrigatória

O [PR #1](https://github.com/willan23/Mnemosyne/pull/1) contém a candidata em rascunho. A branch local continua `main`, no commit anterior; o índice original e os ficheiros do utilizador foram preservados. A preparação usou um índice Git separado. Downloads e feeds de atualização locais não entraram no novo commit de revisão.

A API confirmou que `main` estava sem proteção e sem rulesets. A proteção agora exige os cinco checks da aplicação GitHub Actions (ID 15368), branch atualizada, incluindo administradores: `frontend-tests`, `functions-tests`, `windows-deployment-tests`, `rules-tests` e `secret-scan`. Force push e eliminação da branch ficam recusados. A configuração foi relida e comparada com o pedido; o commit da principal não mudou.

A [execução remota inicial](https://github.com/willan23/Mnemosyne/actions/runs/42185628015) terminou em falha nos cinco jobs, **antes de qualquer passo**. A anotação da API é: “The job was not started because your account is locked due to a billing issue.” Nenhum teste remoto é contado como executado. Regularizar a faturação e voltar a executar a CI é um pré-requisito ainda pendente; os checks não foram dispensados.

## Prontidão das fases e distribuição

Esta tabela separa implementação local, prova disponível e trabalho que ainda condiciona o lançamento. Não transforma os 49 switches de segurança em 49 tarefas independentes.

| Fase | Implementação/evidência disponível | Trabalho ainda necessário |
| --- | --- | --- |
| 0 — Qualidade | Baseline completa local; dependências corrigidas; checks obrigatórios e scanner com testes | CI remota aprovada sobre a revisão final |
| 1 — Política cloud | Gate central e testes de recusa antes de rede/consentimento; sem fallback silencioso autorizado | Smoke do runtime final com fornecedores efetivamente disponíveis |
| 2 — Modelos e custos | Allowlist, reservas atómicas, budgets, circuitos, eventos sem conteúdo e planos de alertas | Secrets/bindings de checkout e ativação/receção dos alertas no rollout; disponibilidade OpenRouter pendente de saldo |
| 3 — Equipas | Épocas, rotação, recuperação e recifragem opcional; pilotos anteriores com SDK/crypto reais, Windows e Android | Confirmar inventário/migração no corte e reconstruir os clientes finais; sem alegar revogação retroativa |
| 4 — Endpoints e anexos | Fetch externo protegido, publicação/recuperação cifrada, quotas, Rules e redaction; matriz App Check documentada | Migração/compatibilidade dos anexos históricos e observação App Check em monitor durante o rollout |
| 5 — Memória semântica | Modelo padrão multilingue fixado, versões/rollback, índice híbrido, Workers, ledger e avaliação por idioma/família | Ainda há percursos lineares de preparação/publicação no thread da UI por escrita; resolver a exigência de deltas até aos consumidores. Resultados de avaliação mantêm os limites medidos, sem inventar uma aprovação estatística |
| 6 — UX e agentes | Lista/tabela/teclado, Review Inbox cifrada, PKCE, scopes por cofre/equipa, propostas/diff/confirmacão e reversão | Confirmar a integração na distribuição final e os pré-requisitos de índices/TTL/rollout |

A consulta real de metadata de 6/11, sem acesso a payloads, confirmou `OPENROUTER_API_KEY` ativa; `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` continuam ausentes em Secret Manager. Duas entradas Stripe antigas permanecem no dotenv local e impedem o preflight de deploy. Os bindings do runtime publicado ainda não correspondem à candidata completa. A consulta de Monitoring foi de leitura e a sua configuração/entrega não foi ativada por este incremento.

Os 49 switches permanecem fechados. O build web foi regenerado, mas os instaladores Windows/Android anteriores não incorporam a última revisão do cliente; não foram substituídos por mudança de hash ou de rótulo. Reconstrução, assinatura, smoke e vínculo dos assets à fonte final continuam necessários. Não houve inferência cloud, dados reais enviados para fornecedores, mutações Firebase/GCP ou deploy de aplicação neste incremento. As alterações externas foram a branch/PR de revisão e a proteção da branch GitHub.

## Evidência e rollback

Prova inicial com auditoria recusada: `W:/real/mnemosyne-launch-evidence/phase0-baseline-attempt1-local-validation-20261106.json`. Logs da correção e repetição: `W:/real/mnemosyne-launch-evidence/functions-dependency-remediation-20261106/`. Inventários de metadata e readback GitHub: `W:/real/mnemosyne-launch-evidence/ci-candidate-20261106/`. Prova consolidada: `W:/real/mnemosyne-launch-evidence/phase0-ci-local-validation-20261106.json`, com hashes dos inputs, outputs e resultados.

O rollback da correção de dependências repõe manifest/lockfile anteriores e exige nova instalação/validação; reabre os avisos conhecidos. Reverter a configuração do scanner conserva o comportamento padrão de recusa, sem autorizar credenciais. A branch de revisão pode receber correções sem alterar a principal. A proteção de CI permanece como requisito de integração, não como prova de testes aprovados. O rollback operacional da aplicação continua no procedimento de deploy completo.
