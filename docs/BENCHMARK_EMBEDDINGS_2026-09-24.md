# Benchmark semântico sintético — 24 de setembro de 2026

## Método

`frontend/scripts/benchmark-embeddings.mjs` usa 16 documentos sintéticos: quatro temas, cada um em pt-PT, pt-BR, inglês e francês. Faz 16 perguntas sintéticas, quatro por idioma. Cada pergunta tem quatro documentos relevantes, um por idioma. Mede precisão e recall nos quatro primeiros resultados, posição do primeiro resultado relevante, tempo de inicialização, tempo de inferência e variação de RSS. Não lê conteúdo de utilizadores.

Execução local: Node 24.11.1, `@huggingface/transformers` 4.3.0, CPU, `dtype: q8`, pooling médio e normalização. O cache do modelo pode já existir neste ambiente; os tempos de carregamento **não** são uma medição de primeiro download no browser. As medidas de RSS incluem a coexistência dos dois modelos no mesmo processo e não representam consumo móvel.

| Modelo | pt-PT P@4/R@4 | pt-BR | Inglês | Francês | Dimensão | Load | Inferência total, 32 textos | Aumento RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `Xenova/all-MiniLM-L6-v2` | 0,625 | 0,563 | 0,875 | 0,688 | 384 | 1,7 s | 89 ms | 84 MiB |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 1,000 | 1,000 | 1,000 | 1,000 | 384 | 3,0 s | 128 ms | 396 MiB adicionais |

O conjunto é pequeno e simples. Estes números mostram uma melhoria neste teste sintético; não provam qualidade em cofres reais, abstenção, atualização de conhecimento ou prompts maliciosos. É necessária avaliação mais ampla por idioma, execução no browser e dispositivos móveis, e medição do download inicial antes da troca do modelo.

## Compatibilidade e custo de migração

O [modelo base](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) declara 50 idiomas e vetores de 384 dimensões. O [repositório ONNX](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) documenta uso com Transformers.js; a variante `q8` tem cerca de 118 MB de pesos segundo a [listagem do ficheiro](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/blob/main/onnx/model_int8.onnx). O tamanho em disco e o pico de memória no browser ainda não foram medidos.

Os vetores antigos e novos têm ambos 384 números, mas **não pertencem ao mesmo espaço semântico**. Compará-los só pelo tamanho geraria scores incorretos. O código agora grava `embeddingModel` nos novos vetores do modelo atual e só compara vetores do mesmo espaço na pesquisa, ligações, grafo, insights e API/MCP. Documentos antigos sem marcador são interpretados como `Xenova/all-MiniLM-L6-v2@legacy-main`; esta compatibilidade conserva a pesquisa atual, mas o modelo antigo descarregado de `main` não tinha revisão fixa e o marcador **não prova pesos idênticos**. Não houve troca de modelo nem reindexação.

Para uma futura troca, fixar primeiro uma revisão imutável dos pesos e atribuir-lhe um espaço novo. Reindexar no cliente após desbloquear o texto cifrado, com checkpoint e modo de recuperação, antes de exigir a nova versão nas pesquisas. Para `N` memórias legadas, a operação requer pelo menos `N` leituras e até `N` escritas Firestore, mais a inferência local e o download dos pesos por dispositivo; custo monetário e tempo real não foram medidos. O rollback deve conservar a versão de cada vetor e poder reabrir o modelo anterior sem comparar espaços diferentes.

**Decisão atual:** manter o modelo antigo enquanto se prepara reindexação com checkpoint, worker e avaliação em browser. Esta medição é uma etapa da fase 5, não uma validação de lançamento da memória multilingue.
