# Expansão limitada de contexto e avaliação independente — 27 de outubro de 2026

## Decisão e âmbito

A expansão recuperou as fontes que faltavam nas quatro perguntas multi-hop do desenvolvimento e incluiu toda a evidência relevante das 40 perguntas positivas do conjunto novo. Contudo, **a classificação experimental posterior voltou a perder evidência e não foi promovida para a pesquisa da aplicação**. O ranking apresentado e o limiar vetorial 0,38 permanecem iguais.

O índice e o cliente têm uma nova operação local `context`, disponível para integração posterior. `useSessions` e a UI ainda não a chamam. A operação é transportada pelo Worker compilado, mas não muda os resultados do fluxo atual. A extensão de relevância v2 fica apenas nos scripts de avaliação. Não há novos schemas, Rules, índices Firestore, dependências, CSP, chamadas cloud ou alterações de dados persistidos.

## Problema, ameaça e alternativas

O diagnóstico anterior encontrou fontes relevantes fora dos primeiros 16 resultados. Um classificador que só recebe esse conjunto não pode recuperá-las. As alternativas consideradas foram aumentar todo o conjunto, percorrer novamente o texto do cofre em cada consulta, ou aproveitar as tabelas incrementais já existentes. Foi escolhida uma expansão limitada dessas tabelas para medir a utilidade antes de ligar um novo ranking ao produto.

Os riscos são atravessar filtros/permissões, reutilizar uma revisão obsoleta, manter texto depois do bloqueio, sobrecarregar o Worker com listas comuns, atribuir uma pista ao documento errado ou confundir texto recuperado com autorização. O corpus continua a exigir ACL no chamador; o Worker recebe apenas a projeção autorizada e não consulta identidades nem serviços externos. O contexto é intersectado com a elegibilidade da consulta e o cliente rejeita IDs estranhos, metadados inválidos e respostas obsoletas. A avaliação volta a aplicar ACL antes e depois da classificação. Não se testa aqui Auth publicado ou um agente generativo.

## Política limitada

`SEARCH_CONTEXT_POLICY` é congelada: até 16 candidatos, os quatro primeiros resultados como sementes, preservação dos resultados com score pelo menos 0,9 enquanto houver espaço, oito pistas por semente, 256 documentos por lista e duas fontes de listas por pista. O limite superior é 16.384 visitas. Uma lista com 257 ou mais documentos é ignorada; 16 lugares já ocupados evitam a expansão.

As pistas usam os rótulos de entidade já indexados e até 64 termos de superfície capitalizados por documento, com no máximo 128 caracteres cada. São pistas lexicais; não provam identidade ou equivalência semântica. Reutilizar os conjuntos de entidades existentes retirou uma duplicação de cache encontrada na revisão. Os caracteres dos novos termos entram no orçamento do índice. Não se volta a normalizar o corpus ao pedir contexto.

Cada resultado contém apenas ID, tipo de contribuição, número agregado de pistas e, quando aplicável, ID da semente. O tipo e a semente referem-se à mesma contribuição mais forte; o número de pistas agrega as contribuições distintas. Duas regressões corrigidas e testadas foram a entidade com o mesmo termo ocultar a lista lexical e a proveniência combinar tipo e semente de contribuições diferentes. A revisão da consulta guarda cópias dos hits e filtros, para que mutações dos objetos devolvidos não alterem as sementes.

O cliente conserva os limites, sequência, cancelamento, revisão e validade do corpus. A operação não transporta texto, snippets, vetores ou pistas em bruto na resposta. O corpus autorizado em claro continua temporariamente na memória do Worker, como no índice anterior, e tem de ser destruído na mudança de conta/cofre.

## Método da avaliação

Os parâmetros foram escritos em `frozen-evaluation-policy.json` antes de carregar os modelos. Foram avaliadas 316 perguntas: 176 de calibração/validação existente, 76 de desenvolvimento e 64 novas. Só as 88 perguntas do split de ajuste escolheram o limiar, a partir da mesma lista fixa. O limiar escolhido foi 0,7 nos dois classificadores. A validação antiga já era conhecida. O conjunto novo, com 80 documentos, quatro idiomas, 40 positivas e 24 negativas, foi congelado antes da primeira inferência e não foi usado para escolher parâmetros. Não tem textos exatamente iguais aos conjuntos anteriores; isso não demonstra independência temática universal. Depois desta execução, também já foi observado e não deve ser apresentado como um novo teste cego noutra experiência.

Foram comparados no mesmo processo o ranking real atual, a coevidência v1 com os primeiros 16 resultados e a expansão com relevância v2. Esta exige ganho de pelo menos um logit face ao score individual da outra passagem antes de atribuir o score do par. Uma propagação densa, opcional e não transitiva, só usa pares do mesmo espaço com cosseno pelo menos 0,95. Os pares continuam limitados pela política anterior: quatro vizinhos por candidato, até 64 pares, cosseno 0,82 ou pista de superfície partilhada. Estas regras não recebem os rótulos relevantes.

Usaram-se os mesmos pesos locais fixados do embedding multilingue e cross-encoder, com hashes conferidos contra a prova anterior, batches de oito e limite de 512 tokens. As duas vias de fetch foram bloqueadas. O avaliador calcula primeiro embeddings de todas as strings sintéticas do dataset, incluindo as marcadas como bloqueadas/fora do âmbito, e só depois filtra o corpus do índice/classificador. Assim, este ensaio prova ACL antes do índice/contexto/reranking, mas não antes de toda a inferência local de embeddings. Não processou dados reais. O índice real foi atualizado uma vez por dataset e reutilizado nas perguntas seguintes sem renormalizar documentos. Cada ranking bruto foi comparado ao adaptador anterior e coincidiu em IDs e scores. As três alternativas partilham os mesmos filtros e âmbito; scores de entradas idênticas são reutilizados.

## Resultados e limite da conclusão

| Método | Recall no desenvolvimento | Evidência completa no desenvolvimento | Recall novo | Evidência completa nova | Abstenção correta nova |
|---|---:|---:|---:|---:|---:|
| Produto atual | 0,9118 | 0,7941 | 0,8688 | 0,6500 | 8/24 |
| Coevidência v1 | 0,8805 | 0,7059 | 0,8625 | 0,6750 | 22/24 |
| Expansão e relevância v2 | 0,8824 | 0,7206 | 0,8281 | 0,6250 | 22/24 |

Na validação antiga, a v2 teve recall 0,8802, evidência completa 0,8125 e abstenção 38/40. Falhou sete das nove verificações amplas pré-definidas, incluindo regressões por cenário e qualidade do conjunto novo. Não se reduziram os critérios após a medição. A comparação muda o conjunto de candidatos e a regra de relevância em simultâneo: suporta rejeitar a combinação, mas não atribui a queda à expansão isoladamente.

| Idioma no conjunto novo | Recall v2 | Evidência completa | Abstenção correta |
|---|---:|---:|---:|
| pt-PT | 0,8125 | 0,60 | 5/6 |
| pt-BR | 0,8000 | 0,50 | 6/6 |
| Inglês | 0,8750 | 0,70 | 6/6 |
| Francês | 0,8250 | 0,70 | 5/6 |

O diagnóstico posterior, com rótulos usados apenas para explicar os resultados, distingue disponibilidade de seleção. A cobertura de todos os candidatos de desenvolvimento subiu de 0,9835 para 0,9963; no conjunto novo, de 0,9750 para 1. Não se perderam fontes relevantes do conjunto anterior nestes datasets. As quatro perguntas multi-hop de desenvolvimento passaram a recuperar toda a evidência. Nas oito novas, a evidência está no conjunto, mas o classificador exclui entre três e seis fontes relevantes por pergunta; o recall final desse cenário foi 0,3594. Dez perguntas positivas novas perderam alguma fonte pelo limiar e cinco perderam alguma pela posição no top-k. As duas negativas falhadas pertencem a perguntas sem o facto pedido. Estes números não provam generalização para cofres reais.

Há duas correções explícitas no diagnóstico privado: `candidateCeiling` no relatório inicial mantém a ordem e trunca no k da pergunta, pelo que não é o teto de todos os 16 candidatos; `fullPoolCeilings` da análise final calcula esse teto. A primeira análise também omitiu o grupo multi-hop por usar a grafia errada do cenário; o ficheiro inicial foi conservado e o agrupamento final verifica quatro casos de desenvolvimento/oito novos. As métricas do ranking escolhido e os scores dos modelos não mudaram. O próximo problema de qualidade está na seleção e atribuição da evidência, incluindo identidades ambíguas, e não na ausência dessas fontes no conjunto novo. Não se deve ajustar esta alternativa ao mesmo conjunto e voltar a tratá-lo como independente.

## Validação e desempenho observado

Passaram 164 testes focados; a suite final teve **1.933 testes em 219 ficheiros, sem falhas ou omissões**. Os 92 novos casos cobrem o índice (34), o cliente (41) e as pistas (17). Passaram também os 26 testes Node de métricas/política e o replay de 252 resultados v1, sem diferenças nem nova inferência. TypeScript e build passaram. O lint inicial detetou uma quebra de linha num teste; a correção e a execução final dos nove ficheiros passaram com zero erros/avisos. Os resultados iniciais foram conservados. O build mantém o aviso de chunks grandes.

A revisão independente confirmou outra lacuna: os campos `kind` e `matchKind` aceitavam objetos `String` em vez de strings primitivas. O ID continuava limitado ao corpus elegível, mas a classificação de proveniência podia passar sem a validação prevista. Os dois testes novos falharam antes da correção e passaram depois, usando `structuredClone`. O primeiro ensaio do teste em Node sem `window` foi uma falha do harness, conservada; a prova válida antes/depois usa jsdom. A suite de 1.933, o build e o browser foram repetidos nas fontes corrigidas.

O Chromium executou o cliente/corpus reais e o Worker final sem modificar os seus bytes, sob a CSP nativa. Dos 10.002 documentos sintéticos fornecidos, o helper real de ACL excluiu um e o corpus excluiu um bloqueado, ficando 10.000 no índice. Na repetição final, a primeira preparação demorou cerca de 294 ms e uma expansão cerca de 1,9 ms, com atividade do temporizador da página. Uma consulta sem alterações normalizou zero documentos; uma edição normalizou um. Passaram filtro por tag, proveniência, remoção, lease obsoleta, abort, reinicialização e retirada do âmbito. As respostas de contexto não transportaram texto. O Worker passou de 12.519 para 15.710 bytes sem compressão; o classificador experimental não entra no bundle da aplicação. São amostras de um Chromium desktop; não provam desempenho em telemóveis, fluidez do Universo ou um piloto instalado.

A avaliação Node teve p95 de consulta de cerca de 898 ms, p95 da operação de contexto de 0,22 ms e pico RSS amostrado de cerca de 1.126 MiB, com os dois modelos carregados. Correu em simultâneo com testes/build; não serve de benchmark isolado de latência, memória da aplicação ou aceitação móvel. Foram 3.186 entradas efetivas do classificador e 3.163 reutilizações de score, somando 3.773 pares nas duas alternativas. A revisão de cache usa medições instantâneas sem GC forçado, não um perfil de pico de heap.

## Migração, rollback e lançamento

Não há migração de dados neste incremento. Uma reversão retira a API de contexto e as extensões de avaliação, recompila o frontend e mantém o ranking anterior; nenhum cliente atual depende da nova operação. Os instaladores Windows/Android e os downloads públicos não são substituídos por este build web. As Functions/Rules não foram alteradas nem repetidas: 594 Functions e 322/23 Rules continuam evidência anterior do respetivo âmbito.

Zero geração cloud, downloads de modelos, leituras de secrets privados, dados reais, mutações de produção ou deploys nesta execução. A verificação de segredos classifica separadamente a configuração pública Firebase e consulta apenas a associação/restrições da chave pública; não recupera chaves privadas. A política cloud continua exclusivamente gratuita. **49 gates continuam fechados; as fases 0–6 e o lançamento completo não estão concluídos.**

Prova privada: `W:/real/mnemosyne-launch-evidence/context-expansion-local-validation-20261026.json`. Resultados: `W:/real/mnemosyne-launch-evidence/context-expansion-validation-20261026/`. A prova identifica precisamente fontes, tentativas, limites e artefactos; não certifica o checkout inteiro nem autoriza a integração do classificador.
