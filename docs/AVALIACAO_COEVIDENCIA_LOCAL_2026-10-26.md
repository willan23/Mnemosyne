# Coevidência local: avaliação e decisão de não integrar — 26 de outubro de 2026

Continuação de 27/10: a [expansão limitada e o conjunto novo](RECUPERACAO_CONTEXTO_LIMITADO_2026-10-27.md) resolveram as fontes ausentes nos quatro casos multi-hop antigos, mas a relevância v2 voltou a perder cobertura no conjunto independente. A v1 original e a sua prova mantêm-se; a extensão é opcional nos scripts, com replay de 252 resultados v1 sem diferenças. Nenhum dos classificadores foi integrado na UI. Consultar o novo relatório para os resultados, correções de interpretação do diagnóstico e limites atuais.

## Problema e decisão

O filtro local por documento reduz resultados sem suporte, mas também pode retirar fontes necessárias a perguntas com vários documentos. Foi testada uma alternativa que classifica pequenos pares de passagens já autorizadas. A cobertura melhorou face ao filtro isolado, mas **não satisfez os critérios mais amplos e não foi integrada na aplicação**. O modelo multilingue padrão e o ranking atual permanecem como na prova anterior; não se alteraram limiares de produção.

Foram acrescentados apenas uma política de avaliação em `frontend/scripts/retrieval-coevidence.mjs`, os seus testes e documentação. A política não é importada pelo produto. Não há alteração de schema, Rules, índices, dependências, CSP, dados persistidos ou artefactos web/nativos. O rollback deste incremento consiste em retirar a experiência/documentação; a aplicação não depende dela.

## Método congelado antes da execução

O conjunto de candidatos continua limitado aos primeiros 16 resultados do ranking real. A política liga passagens quando partilham um termo capitalizado admitido pelo tokenizador lexical do produto, ou quando têm cosseno de pelo menos 0,82 no mesmo espaço. Cada candidato seleciona no máximo quatro vizinhos; a união mantém um limite de 64 pares por pergunta. Estes termos são pistas de superfície, não entidades semanticamente comprovadas.

O mesmo cross-encoder local revisto em 25/10 classifica a pergunta com cada passagem e com os pares selecionados. A passagem recebe o máximo do score individual e dos seus pares; desempates usam o score individual e a ordem original. Não recebe rótulos, IDs relevantes ou regras de intenção da pergunta. Parâmetros, fontes e lista de limiares foram escritos antes da inferência em `frozen-policy.json`. O score é relevância discriminativa; não é probabilidade de verdade ou prova de que o documento responde à pergunta.

Os 48 documentos/176 perguntas do conjunto de calibração e os 112 documentos/76 perguntas de desenvolvimento não foram alterados. Só as 88 perguntas do split de ajuste selecionaram o limiar. A validação existente de 88 perguntas já tinha sido inspecionada em experiências anteriores; não é tratada como um teste cego novo. Seria necessário um conjunto ainda não usado antes de qualquer integração.

## Resultados

Os números abaixo foram medidos no mesmo processo experimental, com batches de oito pares, pesos fixados e dados sintéticos. O baseline individual foi novamente calculado com essa configuração; não se pressupõe identidade numérica com a experiência anterior de batching diferente.

| Método | Recall positivo no desenvolvimento | Evidência completa no desenvolvimento | Recall positivo na validação existente | Abstenção correta na validação existente |
|---|---:|---:|---:|---:|
| Produto atual, floor 0,38 | 0,9118 | 0,7941 | 0,8958 | 0,35 |
| Cross-encoder individual, limiar ajustado 0,7 | 0,7665 | 0,5147 | 0,8594 | 0,95 |
| Coevidência, limiar ajustado 0,7 | 0,8805 | 0,7059 | 0,8802 | 0,95 |

A coevidência recuperou em média 0,78125 do conjunto multi-hop, acima de 0,5625 no produto atual, e completou uma das quatro perguntas. Contudo, o recall single-hop caiu de 0,9896 para 0,9115 e o de contradição de 1 para 0,75. A evidência completa agregada ficou abaixo de 90%. Na validação existente, o recall foi 0,9167 em pt-PT/pt-BR, 0,8125 em inglês e 0,875 em francês. A média não esconde a diferença por idioma.

O limiar 0,7 cumpre as restrições estreitas de ajuste (hit em pelo menos 90% das positivas e falso positivo em no máximo 5% das negativas), mas falhou quatro das seis verificações amplas: recall da validação abaixo do produto, cobertura por idioma insuficiente, evidência completa insuficiente e regressões por cenário. `eligibleForFurtherIndependentValidation` e `releaseReady` são falsos.

## Diagnóstico que determina o próximo passo

O diagnóstico posterior com rótulos, separado da seleção da política, verificou o teto de recall dos candidatos. Nos quatro casos multi-hop, a experiência devolveu toda a evidência relevante que chegou ao conjunto de candidatos. Em três deles faltavam fontes antes do reranking: duas fontes nas perguntas portuguesas e três na francesa. Alterar apenas a pontuação não pode recuperar esses documentos ausentes.

O próximo ponto a investigar é uma expansão limitada do contexto já autorizado, mantendo as fontes fortes e os filtros. Também é necessário conservar a cobertura dos casos single-hop e de contradição; aumentar só o recall multi-hop não autoriza promover a alternativa. Não foram reduzidos os critérios nem alterados os rótulos para declarar sucesso.

## Segurança, custo e verificação

As funções reais de ACL e filtros foram aplicadas antes do contexto e novamente após a inferência. Documentos bloqueados, apagados ou de âmbito ambíguo também são recusados pela política de avaliação. O texto recuperado permanece entrada inerte de um classificador; não existe geração, execução de ferramentas ou alteração de `never-cloud`/scopes neste percurso. Estes ensaios não montam Auth, UI ou cofre reais e não provam resistência de um modelo generativo a prompt injection.

Os quatro ficheiros do cross-encoder e os quatro do embedding vieram da cache, com digests conferidos contra a proveniência/artefactos anteriores. As duas vias de fetch da biblioteca foram recusadas. Zero pedidos de rede, downloads, leituras de secrets, chamadas generativas, mutações de produção ou deploys.

Passaram **16 testes Node**: sete novos da política e nove de métricas/datasets existentes, sem falhas ou skips. Cobrem limites, espaços de modelo, âncoras acentuadas, duplicados, flags fechadas, scores inválidos, desempate e imutabilidade. Lint e verificações de sintaxe passaram. Foram executadas 252 perguntas, 1097 contextos candidatos e 1773 entradas efetivas do classificador, com reutilização de scores idênticos. O p95 de cerca de 141 ms e pico amostrado de cerca de 949 MiB RSS pertencem a este processo Node com dois modelos carregados e frases curtas; não medem a aplicação nem dispositivos móveis.

As suites gerais, emuladores e build não foram repetidos porque o runtime do produto e os artefactos permanecem iguais à prova `embedding-default-local-validation-20261026.json`. O incremento conserva **49 gates fechados**, as fases 0–6 em curso e a política cloud exclusivamente gratuita. Prova privada: `W:/real/mnemosyne-launch-evidence/co-evidence-local-validation-20261026.json`; dados e resultados em `W:/real/mnemosyne-launch-evidence/co-evidence-evaluation-20261026/`.
