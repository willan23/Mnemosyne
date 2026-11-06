# Rules: validação integral — 23 de outubro de 2026

## Execução

`node scripts/run-rules-tests.js` foi executado a partir da raiz, com Node **22.23.3**, JBR **21** e Firebase CLI **15.34.0**. O runner público passou a fixar essa versão da CLI. Os processos Node/Java da árvore desta execução foram inspecionados, confirmando os executáveis esperados. As portas de teste estavam livres; não se parou ou reutilizou outro serviço.

O projeto foi **demo-mnemosyne-rules**, com Firestore/Storage e UI desativada. A CLI confirmou o projeto demo; serviços não emulados desse projeto não eram destinos de produção. A sequência compilou Functions, executou todo `functions/test/rules.test.js` e depois toda a suite `frontend/rules-tests`. Não houve filtro de nomes.

| Suite | Aprovados | Falhas | Omissões |
|---|---:|---:|---:|
| Functions/Rules | 315 | 0 | 0 |
| Frontend Rules | 23 | 0 | 0 |

O wrapper terminou com exit **0**, sem reparações ou repetições para obter verde. Os emuladores Firestore/Storage e o hub encerraram normalmente. O primeiro arranque instalou a versão fixada da CLI numa cache própria; os avisos npm de dependências transitivas obsoletas foram conservados.

## Âmbito

Esta passagem cobre os casos atuais da suite, incluindo corte de escritas SDK, ACL/leitura, operações pessoais/equipa, recibos/quotas/transações, pairing/Comms, anexos, relações/agrupamentos, agentes e circuitos, conforme as assertivas existentes. Os providers/serviços declarados sintéticos pelos testes conservam esse âmbito. Não houve emulador de Functions ou Auth nesta sequência; as invocações diretas de handlers não são um deploy ou ensaio completo de autenticação/trigger delivery.

Rules, testes, contratos, gates e timeouts ficaram iguais aos da predecessora. O único comando de implementação alterado foi a versão da CLI no runner. A nova nota [DECISOES_FASE0.md](DECISOES_FASE0.md) liga os comandos exigidos pelo prompt aos seus resultados e distingue baseline reaproveitada de nova execução.

## Audits e CI

As consultas novas `npm audit --omit=dev --json` devolveram **zero vulnerabilidades** em frontend e Functions. Packages/lockfiles mantiveram os hashes; não se executou fix/install nesses packages. Os downloads de tooling da CLI pertencem à cache npm e não alteraram dependências da aplicação.

A consulta GitHub foi somente de leitura: HEAD main local/remoto igual, zero check-runs/workflow runs para esse commit; branch protected=false e endpoint clássico de proteção 404. As alterações locais ainda não publicadas não foram validadas por CI remoto. Não se alterou a configuração GitHub nem se publicaram fontes.

## Limites e próximos critérios

Esta execução integral substitui a passagem focada apenas para o âmbito de Rules; as suites gerais frontend/Functions, builds anteriores, lint e pilotos nativos mantêm a sua cronologia. Não se declararam todas as fases concluídas. Permanecem CI remoto/checks obrigatórios, revisão integral do checkout, migrações/índices/bindings/alertas, qualidade semântica e critérios de clientes/plataformas descritos no estado do lançamento.

**49 gates continuam fechados; releaseReady, allPhasesComplete e wholeCheckoutVerified falsos.** Nenhum deploy, alteração de produção, leitura de payload Secret Manager ou pedido de geração a fornecedor neste incremento. As escritas dos testes foram nos emuladores com fixtures sintéticas. As consultas GitHub/npm são consultas externas de metadata e não são apresentadas como ausência de rede.

Evidência privada: `W:/real/mnemosyne-launch-evidence/rules-integral-validation-20261023/`, prova `W:/real/mnemosyne-launch-evidence/rules-integral-local-validation-20261023.json`. Predecessora android-runtime-local-validation-20261023.json, SHA-256 `e221c984bc4372cd130b47dd800ef1b0bd2f844070cfeda4d9da3c19f0585364`.
