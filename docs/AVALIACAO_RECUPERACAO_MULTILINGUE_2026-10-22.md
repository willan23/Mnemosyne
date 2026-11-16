# Avaliação sintética de recuperação multilingue — 22 de outubro de 2026

## Âmbito e decisão

A fase 5 passou a ter um corpus reproduzível com **112 documentos e 76 perguntas**, em pt-PT, pt-BR, inglês e francês. Cada idioma tem 19 perguntas. As oito famílias são recuperação direta, evidência em vários documentos, filtro temporal, atualização de conhecimento, factos contraditórios, pergunta sem suporte, revogação de equipa e instruções maliciosas em documento recuperado. Todas as frases, identidades e relações de acesso são sintéticas; não há leitura de cofres, credenciais ou produção.

O candidato multilingue melhorou a recuperação neste conjunto, mas **não foi aprovado para ativação global**. Persistem falhas de abstenção, cobertura de evidência em vários documentos e preferência pela informação atual. O conjunto é de desenvolvimento, com traduções paralelas e apenas quatro perguntas em cada família especializada; não é um conjunto independente de aprovação nem uma estimativa estatística da qualidade geral. Não foram ajustados os limiares semânticos para fazer este conjunto passar.

## Execução e contratos usados

Com Node 22, a partir da raiz do repositório:

```powershell
node --test scripts/retrieval-eval.test.cjs
node frontend/scripts/benchmark-embeddings-expanded.mjs --out W:\real\mnemosyne-launch-evidence\novo-relatorio.json
```

O destino tem de ser absoluto e ainda não existir. O benchmark usa as revisões fixas de `embeddingProfiles.json`, q8, mean pooling, normalização e 384 dimensões. Cada modelo é carregado num processo novo, a partir da cache local existente. `local_files_only`, acesso remoto desativado e um bloqueio de fetch impedem chamadas externas; cache em falta faz o comando falhar. O corpus é inferido de novo em cada execução e os vetores não são persistidos no relatório.

O executor empacota em memória as funções reais `canReadCachedMemory`, `filterSearchCandidates`, `rankSearchVectors` e `searchMemories`. Não contém um ranker alternativo. Usa a regra de acesso antes de selecionar candidatos e volta a aplicá-la antes de expor resultados, com uma revogação sintética entre as duas etapas. Isso testa a composição dessas funções com identidades de fixture; não executa o hook completo, Auth/Firestore nem a autorização publicada. O relógio do ranking é fixado em 01/10/2026 para não variar com a bonificação de recência.

Os casos multi-hop medem a recuperação do conjunto de documentos necessário, sem gerar uma resposta ou executar raciocínio multi-hop. O caso de contradição mede a presença dos dois factos incompatíveis, sem alegar deteção lógica de contradição. O caso de injeção verifica que texto recuperado permanece dado inerte neste percurso, sem alterações à política ou execução de ferramentas; não testa a resistência de um modelo generativo a esse texto.

## Falha encontrada e correção

O primeiro ensaio expôs falsos positivos lexicais: palavras funcionais dos quatro idiomas eram tratadas como evidência, e uma pergunta sobre uma estação podia combinar com `stationery`. Um teste de regressão falhou antes da correção: sete testes existentes passaram e o caso novo falhou.

O motor passou a excluir palavras funcionais pt/en/fr do cálculo por tokens e a limitar correspondência de prefixos a formas próximas: pelo menos quatro letras e razão de comprimentos de 0,8. Correspondência literal de título/frase continua anterior a esse cálculo; pesquisas parciais como `quant`, formas como `memória cifrada` e resultados semânticos relevantes têm casos positivos. Não há alterações de schema, embeddings persistidos, pesos, perfil global, limiar semântico ou regras de acesso. Rollback do código repõe o comportamento lexical anterior; não exige migração de dados.

## Qualidade observada

As 68 perguntas positivas usam k=4, ou k=8 para os conjuntos maiores. Em cada pergunta positiva deste corpus, o número de documentos relevantes coincide com k; por isso P@k e R@k coincidem. A suite das métricas também testa denominadores diferentes. As oito perguntas negativas são contabilizadas separadamente e não entram na média positiva.

| Idioma | Inglês fixado P@k / R@k | Multilingue P@k / R@k |
| --- | --- | --- |
| pt-PT | 0,6471 / 0,6471 | 0,8971 / 0,8971 |
| pt-BR | 0,6324 / 0,6324 | 0,9265 / 0,9265 |
| Inglês | 0,7941 / 0,7941 | 0,9265 / 0,9265 |
| Francês | 0,5735 / 0,5735 | 0,8971 / 0,8971 |
| Média positiva | 0,6618 / 0,6618 | 0,9118 / 0,9118 |

Antes da correção lexical, no mesmo corpus, as médias positivas eram 0,5496 para a referência inglesa e 0,8879 para o candidato. Os rótulos e perguntas foram conservados. Estes resultados medem a correção no conjunto que a revelou, sem prova de generalização num conjunto independente.

| Caso especializado | Referência inglesa | Candidato multilingue |
| --- | --- | --- |
| Evidência multi-hop: recall médio | 0,5625 | 0,5625 |
| Evidência multi-hop completa | 0/4 | 0/4 |
| Filtro temporal: recall médio | 1 | 1 |
| Atualização de conhecimento: recall médio | 0,5 | 0,5 |
| Factos contraditórios: recall médio | 1 | 1 |
| Perguntas sem suporte: abstenções corretas | 1/4 | 0/4 |
| Revogação após ranking: resultados retirados corretamente | 4/4 | 4/4 |

Não se mistura a abstenção semântica com a retirada por ACL para alegar qualidade de resposta. Não houve exposição de memórias bloqueadas, pessoais de outra conta ou de equipas removidas nos casos executados. Em ambos os perfis, o primeiro resultado de injeção era relevante, mas a recuperação de todo o conjunto relevante continuou incompleta; este resultado não constitui aprovação contra prompt injection generativo.

## Tempo, memória e bytes nesta máquina

| Medida da passagem verificada | Inglês fixado | Multilingue |
| --- | --- | --- |
| Carregamento da cache | 174,8 ms | 832,5 ms |
| Inferência dos 112 documentos | 247,6 ms | 416,1 ms |
| Inferência das 76 perguntas | 164,5 ms | 264,5 ms |
| p95 da inferência de documento | 3,41 ms | 6,06 ms |
| p95 do ranking completo deste corpus | 2,13 ms | 2,28 ms |
| RSS máximo amostrado do processo | 141,4 MiB | 480,9 MiB |
| RSS inicial do processo | 33,5 MiB | 33,9 MiB |
| Artefactos do modelo na cache | 23.685.047 bytes | 135.392.208 bytes |

O RSS é amostrado a cada 10 ms e inclui bibliotecas, inventário da cache, buffers, empacotamento e runtime; não é a memória exclusiva dos pesos nem um máximo garantido. Os tempos do corpus medem o custo de gerar vetores para 112 textos nesta execução, sem cifra, IndexedDB, checkpoint, sincronização ou promoção. Não são uma projeção linear de reindexação de um cofre grande. A referência inglesa fixada não certifica a revisão desconhecida dos vetores legados.

O build atual contém 5.440.512 bytes de JavaScript e 26.861.777 bytes de Wasm nos assets. O Worker de embedding tem 549.134 bytes e o Worker de ranking 1.112 bytes. Pesos/tokenizer da cache são medidos separadamente. Não foram medidos download inicial, bytes de rede comprimidos, consumo energético, browser/WASM, Android, Tauri ou desempenho da aplicação completa. O aviso de chunks acima de 1.000 kB permanece.

## Validação e evidência

- **26 testes frontend em seis ficheiros**: motor, filtros, âmbito de leitura, índice incremental, perfil selecionado e hook de sessões.
- **Seis testes Node**: cobertura dos idiomas/casos, precisão/recall independentes, abstenção, rótulos inválidos, oracle de agregação e proteção das métricas contra campos devolvidos pelo retriever.
- Build/TypeScript frontend aprovado e lint dos cinco ficheiros frontend do incremento sem erros/avisos.
- CI inclui os seis testes de rótulos/métricas. O benchmark de pesos em cache é um comando separado; CI remoto não foi executado nesta continuação.
- Relatórios antes, intermédio e finais em `W:/real/mnemosyne-launch-evidence/multilingual-retrieval-evaluation-20261022/`. A passagem `benchmark-verified.json` vincula as fontes, revisões, assets e bundle das funções usadas.

Zero leituras de payloads de secrets, pedidos generativos, mutações de produção ou deploys. Os 49 gates permanecem fechados. As suites gerais e de regras não foram repetidas neste incremento. Para concluir a fase 5 ainda é necessário corrigir/avaliar a abstenção com um conjunto independente, resolver a recuperação dos conjuntos de evidência e de informação atual, validar cofres grandes e dispositivos reais e completar os critérios de ativação/reindexação/rollback. As restantes fases do lançamento mantêm o seu âmbito.
