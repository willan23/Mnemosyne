# Fase 0 — baseline, ambiente e CI

## Validação de 6 de novembro de 2026

A [baseline e CI atuais](BASELINE_E_CI_2026-11-06.md) registam 2.161 testes frontend, 607 Functions, 328 +25 Rules, build e lint sem erros/21 avisos. A auditoria inicial recusou seis alertas moderados transitivos; a correção de rimraf/lockfile passou instalação limpa, nova suite Functions/Rules e zero alertas de produção nos dois packages. Os cinco checks agora são obrigatórios em `main`, incluindo administradores. O PR #1 está em rascunho e a CI remota não iniciou passos devido ao bloqueio de faturação da conta GitHub. Não há aprovação remota nem deploy. Os blocos seguintes conservam a cronologia anterior.

## Continuação de 25 de outubro

Na [integração OpenRouter gratuita](OPENROUTER_GRATUITO_2026-10-25.md), a suite geral frontend passou 1.790 testes/212 ficheiros, sem omissões, com build/TypeScript e lint geral sem erros/23 avisos anteriores. Uma nova consulta npm encontrou dois pacotes vulneráveis nas Functions; a [correção HTTP](DEPENDENCIAS_HTTP_NODE22_2026-10-25.md) fixa body-parser 2.4.0 e undici 7.30.1, com qs 6.16.1 transitivo e fetch explícito da biblioteca corrigida. O audit posterior reporta zero vulnerabilidades de produção nos dois packages. Passaram 26 testes de transporte/adaptadores, incluindo três ensaios de sobrevivência em processos isolados. A suite geral Functions posterior passou 580 testes, com uma omissão prevista de Rules fora do emulador.

A primeira suite integral desta continuação aprovou 315/316 testes Functions/Rules: o cenário antigo de revogação de conta pressupunha NVIDIA ativa e recebeu a recusa 400 da nova política. A fixture passou a testar OpenRouter com a política real e NVIDIA numa configuração futura explícita, sem mudar aplicação, Rules ou gates. A evidência conserva a falha; a suite é repetida após a correção da fixture e das dependências. As passagens históricas abaixo conservam o seu âmbito/data e não são usadas para declarar a revisão atual publicada ou a fase encerrada.

A repetição integral com a fixture corrigida passou 316 Functions/Rules +23 frontend. Depois da substituição adicional do fetch embutido pelo transporte explícito corrigido, a suite integral repetiu **316+23**, zero falhas/omissões, e a suite geral Functions passou **580**, com uma omissão prevista. A prova OpenRouter de 25/10 distingue as execuções e a conservação dos fontes frontend. CI remoto/checks obrigatórios, revisão do checkout misto e restantes áreas permanecem por comprovar; a fase 0 não é declarada operacionalmente encerrada.

O exame de segredos foi alargado a provas/artefactos: seis correspondências foram revistas como nonces de teste, expressões do tokenizador e configuração pública Firebase. A associação/restrições da chave pública foram consultadas sem alterações de produção ou valores de chaves privadas; Generative Language API está excluída. Uma anotação apenas na linha do nonce sintético evita o falso positivo no CI, com AST canónica dos testes conservada. Não se oculta o exit bruto do scanner nem se confundem estas classificações com auditoria de todo o histórico Git, execução remota ou requisitos App Check/quotas concluídos.

## Problema e decisão

O programa de lançamento exige build, lint, suites gerais, Rules e audits reproduzíveis. Uma passagem focada valida o protocolo que executou; não comprova a suite integral. O ambiente local tem mais de uma versão de Node, pelo que o executável e o PATH dos subprocessos têm de corresponder ao runtime 22 das Functions/CI.

O runner público verifica Node 22/JDK 21+ e usa o projeto fixo `demo-mnemosyne-rules`, apenas com Firestore e Storage. A CLI passou a estar fixada em **15.34.0**. A instalação de ferramentas e os downloads iniciais continuam dependentes de rede; a fixação da versão da CLI não constitui um lock de toda a sua árvore transitiva. Não foram alteradas Rules, assertivas, filtros ou timeouts para obter a passagem integral.

## Contrato TXT e lint

O formato TXT usa **`MEMÓRIA — <título>`** quando existe título e `MEMÓRIA` quando não existe. `frontend/src/utils/export.ts` e o teste correspondente contêm esse contrato. O teste não foi ignorado. A suite geral frontend de 1.695 testes/203 ficheiros é a passagem anterior referenciada abaixo.

A baseline geral de lint anterior tem zero erros e 23 avisos preexistentes. A alteração nativa subsequente em capacitor.config.ts teve lint próprio, com zero erros/avisos. Não se desativaram regras globalmente neste incremento. Esta nota distingue essas passagens da nova execução integral de Rules.

## Evidência dos comandos exigidos

| Comando/área | Evidência e âmbito |
|---|---|
| Frontend build | Passou no build Android de 23/10; código web/artefactos conservados desde essa passagem |
| Frontend lint | Zero erros/23 avisos na baseline de ledger; config Capacitor final verificado separadamente, zero erros/avisos |
| Frontend unitários | 1.695/203 ficheiros, sem omissões, no build Android anterior |
| Functions unitários | 567 aprovados e uma omissão de Rules esperada fora do emulador, na baseline de ledger |
| Runner integral de Rules | **315 Functions/Rules +23 frontend**, zero falhas/omissões, em 23/10; build Functions recompilado antes das suites |
| npm audit --omit=dev | Nova consulta de 23/10: zero vulnerabilidades nos dois packages; sem npm audit fix ou alteração de lockfiles |

As passagens anteriores são conservadas com hashes e âmbito nos relatórios de [ledger](LEDGER_MEMORIA_LOCAL_E_REVISOES_2026-10-23.md), [build Android](BUILD_ANDROID_VALIDADO_2026-10-23.md) e [piloto nativo](ANDROID_ARMAZENAMENTO_NATIVO_2026-10-23.md). A passagem integral nova está em [VALIDACAO_INTEGRAL_RULES_2026-10-23.md](VALIDACAO_INTEGRAL_RULES_2026-10-23.md). Build/lint/suites gerais não foram apresentados como novas execuções quando foram reutilizados.

## CI obrigatório e estado remoto

O workflow local declara build/lint/unitários/audits frontend, build/unitários/audit Functions, testes Windows, Rules/ensaios Chromium e secret scanning. Os jobs relevantes não estão desativados na configuração inspecionada. O secret scanner está fixado em 8.29.1, usa redaction e cobre commits novos/branches merged; isso não revoga credenciais históricas.

Em 23/10, uma consulta somente de leitura à GitHub confirmou que o HEAD local e remoto main são `4688641a4535371b05b95ef7f47e91b3153610a4`. Para esse SHA, a API devolveu zero check-runs e zero workflow runs. A API de branch devolveu `protected=false` e a consulta clássica de protection devolveu HTTP 404. Não se infere daqui o estado de todos os possíveis mecanismos de rulesets externos.

A revisão local tem alterações não publicadas e não é esse commit. **A execução remota e a exigência efetiva dos checks desta revisão continuam por comprovar. A fase 0 não é declarada operacionalmente encerrada.** Não se fizeram commits, pushes, mudanças de branch/proteção, deploys ou mutações remotas neste incremento.

## Riscos, migração e rollback

Os testes de Rules exercitam emuladores e adapters de Auth/fornecedores/GCS sintéticos quando declarados pelas fixtures. Não comprovam índices READY de produção, bindings, delivery automático de triggers, clientes antigos, hardware, backup real ou migrações aplicadas. A auditoria npm cobre dependências de produção dos dois packages; não certifica dependências nativas, todo o ambiente de desenvolvimento ou conformidade legal.

Não há alteração de schema/Rules/índices/dados neste incremento. Uma troca futura da CLI exige repetir a suite integral e conservar a evidência anterior. Rollback de aplicação segue os contratos de migração/recuperação de cada fase e conserva os gates. As fases 1–6 mantêm os seus critérios próprios; testes verdes desta baseline não os substituem.

Em 5 de novembro de 2026, o deploy passou a verificar o APK Android aprovado em public/downloads e dist/downloads, depois do build e antes da primeira publicação. O contrato fixa os bytes do APK 1.0.9 e a identidade das fontes React, recursos e configuração nativa. O workflow recebe um ID de asset do próprio repositório GitHub. O ficheiro tem de estar acessível ao token da execução. A preparação desse asset e a execução remota continuam pendentes. O procedimento está no [contrato de distribuição Android](ANDROID_RELEASE_ARTIFACT.md).

Os 30 testes focados passaram com Node 22 e a sequência PowerShell confirmou a interrupção em cada uma das 26 etapas. Um ensaio com as fontes e o APK reais recusou a ausência do ficheiro e uma alteração das fontes com a mesma versão. O preflight real terminou nas 49 condições fechadas, com zero tentativas de publicação. A primeira passagem dos testes usou Node 24 e foi recusada pelo requisito de runtime existente. A repetição usou Node 22. Não se alteraram configurações de produção nesta etapa.
