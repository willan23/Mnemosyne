# Benchmark de embeddings com revisões fixas

Execução local em 27 de setembro de 2026, Windows, Node v24.11.1, comando `node frontend/scripts/benchmark-embeddings.mjs` a partir da raiz do repositório. Só dados sintéticos do script; nenhuma leitura do cofre ou de produção.

## Configuração reproduzível

O script lê `frontend/src/services/embeddingProfiles.json`. Ambos os perfis usam q8, mean pooling, normalização e 384 dimensões. Valida dimensões e valores finitos e liberta o pipeline de cada modelo após medir. A aplicação continua no espaço legado; estes perfis ainda não são a política de ativação do runtime.

| Perfil | Revisão verificada no Hub |
| --- | --- |
| Xenova/all-MiniLM-L6-v2 | `751bff37182d3f1213fa05d7196b954e230abad9` |
| Xenova/paraphrase-multilingual-MiniLM-L12-v2 | `2c4055b12046f11709e9df2c122e59ffbdc2f900` |

Fontes: [revisão inglesa](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/751bff37182d3f1213fa05d7196b954e230abad9), [revisão multilingue](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/tree/2c4055b12046f11709e9df2c122e59ffbdc2f900). Os hashes foram obtidos da API de metadados pública do Hub e usados no parâmetro `revision` do pipeline.

## Resultados observados

16 documentos, 16 queries, quatro tópicos, quatro documentos relevantes por query. Cada idioma tem quatro queries. Por esta construção, precision@4 e recall@4 têm o mesmo valor.

| Idioma | Inglês P@4 / R@4 | Multilingue P@4 / R@4 |
| --- | --- | --- |
| pt-PT | 0,625 / 0,625 | 1 / 1 |
| pt-BR | 0,563 / 0,563 | 1 / 1 |
| en | 0,875 / 0,875 | 1 / 1 |
| fr | 0,688 / 0,688 | 1 / 1 |

MRR = 1 nos quatro idiomas para ambos os modelos.

| Medida | Inglês | Multilingue |
| --- | --- | --- |
| Carregamento nesta execução | 1508 ms | 3062 ms |
| Inferência total, 32 textos | 116 ms | 146 ms |
| Média arredondada por texto | 4 ms | 5 ms |
| Aumento de RSS do processo | 76 MiB | 370 MiB |

O teste usa a cache disponível nesta máquina e não mede download inicial. RSS mede a variação do processo, não o pico nem memória exclusiva do modelo; os modelos correm sequencialmente no mesmo processo e o garbage collector não é controlado. As durações não representam browser/WASM, Android ou Tauri. Não foi medido tamanho de bundle, consumo energético ou custo total de reindexação. O conjunto é pequeno, tem traduções paralelas e não mede contradição, multi-hop, atualização, abstenção ou ataques por documentos. Um resultado de 1 neste conjunto não prova qualidade geral.

## Ensaio adicional no browser

`node frontend/scripts/smoke-pinned-embedding-worker.mjs` executou o Worker compilado `embeddingWorker-DKDfYtr8.js` em Chromium headless, numa página local isolada, sem aplicação, credenciais ou dados do cofre. Usou o perfil `multilingualCandidate`, três frases sintéticas e um contexto de browser novo. Carregamento: **7905 ms**; inferência das três frases: **142 ms**. Os três vetores tinham 384 dimensões, valores finitos e norma dentro de 0,001 de 1. Similaridade entre as frases equivalentes em pt/en: **0,97548**; com a frase não relacionada: **0,05002**. As 14 requisições HTTPS observadas foram GET. O script terminou com sucesso e fechou o Worker/browser/servidor local.

Este é um smoke de carregamento e inferência real, não uma avaliação de qualidade estatística. Não mede memória do browser nem valida Android/Tauri, download em redes lentas, modo offline, cancelamento durante download ou reindexação de um cofre grande. Os tempos não devem ser comparados diretamente com Node, pois incluem ambientes e estados de cache diferentes.

## Decisão de ativação

Manter o candidato com revisão fixa para a implementação da reindexação recuperável e os ensaios seguintes. Não substituir nem reetiquetar os vetores legados: a revisão histórica não é conhecida. A ativação continua pendente de checkpoint/retoma, rollback e validação de memória/latência em dispositivos reais.
