# Pesquisa local: relevância e descoberta de revisões — 25 de outubro de 2026

## Decisão

A avaliação de um cross-encoder multilingue local encontrou uma forma de reduzir resultados sem suporte factual, mas também retirou evidência necessária a outros tipos de pesquisa. **Não se acrescentou esse modelo ao produto, não se alterou o limiar de produção e não se promoveu o perfil multilingue globalmente nesta etapa.** O carregamento dos perfis existentes foi corrigido: descoberta e pesos usam a mesma revisão, o runtime ONNX vem dos assets locais e a política nativa permite o domínio exato usado para os ficheiros de modelo.

## Experiência de relevância

Foi avaliado o modelo original [cross-encoder/mmarco-mMiniLMv2-L12-H384-v1](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1), revisão `1427fd652930e4ba29e8149678df786c240d8825`, licença Apache-2.0. Usou-se o ONNX quint8 AVX2 publicado nesse repositório, sem executar código remoto ou Python. Os quatro ficheiros efetivamente carregados foram comparados com os digests upstream, incluindo o SHA-256 LFS dos pesos. Ocupam 135.704.002 bytes. Não foi usado o export de outro publicador encontrado durante a pesquisa.

O ensaio usa os mesmos 48 documentos/176 perguntas de calibração e 112 documentos/76 perguntas de desenvolvimento existentes, sem alterar textos ou rótulos. O embedding continua a ser o candidato multilingue fixado. ACL, filtros, ranking vetorial e lexical são as funções reais do produto empacotadas em memória; os primeiros 16 resultados autorizados são depois classificados em pares pergunta/documento pelo cross-encoder. Só se avaliam frases e identidades sintéticas. A etapa offline recusa fetch tanto em globalThis como no hook env.fetch da biblioteca e terminou com zero tentativas de rede, pedidos generativos ou produção.

O score é sigmoid do logit do cross-encoder; não é uma probabilidade calibrada de verdade nem uma prova de que existe resposta. Testaram-se 16 limiares predefinidos. Só as 88 perguntas de ajuste, com 48 positivas/40 negativas, participaram na seleção. O primeiro limiar que conservou evidência em pelo menos 90% das positivas e resultados em no máximo 5% das negativas foi 0,7. A validação de 88 perguntas não foi usada na escolha.

| Medida | Resultado no limiar 0,7 |
| --- | --- |
| Ajuste: positivas com alguma evidência relevante | 45/48 |
| Ajuste: negativas corretamente vazias | 38/40 |
| Validação: positivas com alguma evidência relevante | 46/48 |
| Validação: negativas corretamente vazias | 38/40 |
| Validação: recall médio positivo | 0,859375 |
| Validação: evidência completa | 35/48 |
| Validação: abstenção pt-PT / pt-BR / en / fr | 9/10, 10/10, 10/10, 9/10 |
| Desenvolvimento: recall de evidência multi-hop | 0,5; nenhum conjunto completo |
| Desenvolvimento: recall de atualização de conhecimento | 0,6875; nenhum conjunto completo |
| Desenvolvimento: recall de factos contraditórios | 0,28125; nenhum conjunto completo |

A referência anterior do candidato sem cross-encoder tinha 14/40 abstenções corretas na validação e recall positivo 0,8958. A experiência melhora a recusa de perguntas sem suporte, mas perde cobertura e é particularmente inadequada para perguntas que precisam de reunir evidência contraditória. O conjunto de desenvolvimento anterior recuperava os dois factos contraditórios por completo. Por isso, a decisão de calibração candidate **não equivale a aprovação para substituir o percurso de pesquisa**. Não se escolheu outro limiar depois de observar a validação.

As 252 consultas demoraram 22.501,897 ms no percurso medido, com p95 189,296 ms; incluem embedding da pergunta, ranking e cross-encoder, sem a inferência inicial dos documentos. O carregamento a partir da cache foi 1.270,906 ms. Não se mediu RSS, consumo energético, download inicial com instrumentação completa, WASM/browser, Tauri ou Android deste novo modelo. A designação AVX2 do export e os resultados Node não provam portabilidade para esses ambientes. O conjunto continua sintético e pequeno; não é validação independente de generalização.

## Defeito de descoberta dos perfis fixados

O Transformers.js instalado é 4.3.0. A inspeção da implementação confirmou que get_tokenizer_files e partes de get_pipeline_files consultam metadata sem encaminhar revision. Os ficheiros efetivamente carregados continuam a receber a revisão, mas a descoberta pode depender da disponibilidade ou de metadata de main. Num processo offline novo, o tokenizer do modelo novo não foi encontrado apesar de os ficheiros da revisão existirem na cache. Na experiência offline usou-se diretamente a mesma classe XLMRobertaTokenizer sobre os JSON da revisão verificada; não se alterou a biblioteca instalada.

No produto, o Worker escolhe um perfil uma única vez e já recusa trocá-lo durante a sua vida. Essa propriedade permite fixar env.remotePathTemplate à revisão escolhida antes de criar a pipeline. Assim, a descoberta sem argumento revision também usa a mesma revisão dos pesos. O percurso explicitamente legado conserva a configuração anterior; não se reclassificam os vetores históricos como fixados nem se misturam espaços.

O ensaio anterior à correção usou o embeddingWorker do dist numa instância nova de Chromium. Intercetou todos os pedidos externos e disponibilizou apenas os ficheiros da revisão fixada, a partir da cache local. O Worker pediu uma vez main e recusou inicializar. Não encaminhou pedidos externos nem leu Auth/cofre.

## Runtime ONNX e política nativa

Depois de fixar a descoberta, o ensaio encontrou pedidos do runtime a um CDN público. A política Tauri não autoriza esse domínio nem a execução de módulos externos. O Worker passou a importar URLs Vite para o .mjs e .wasm asyncify da versão ONNX Runtime instalada; ambos são publicados como assets com hash. A [documentação do ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html#envwasmwasmpaths) exige que módulo e Wasm pertençam ao mesmo build. Não houve atualização ou mistura de versões.

A cache adicional de Wasm do Transformers.js convertia esse módulo local num blob e voltava a impedir o carregamento sob a política nativa. Desativou-se apenas env.useWasmCache; o runtime usa as URLs versionadas do pacote e as caches normais de assets/modelos mantêm-se. A inferência já corre num Worker dedicado e usa agora numThreads=1, evitando threads subordinadas em plataformas sem cross-origin isolation. Não se permite execução dinâmica, módulos blob ou CDN na política para contornar a falha.

A política nativa também permitia subdomínios de huggingface.co, mas não o domínio principal que a biblioteca usa. Acrescentou-se exclusivamente `https://huggingface.co` a connect-src. Script-src, worker-src e as restantes diretivas ficaram iguais; não se acrescentou unsafe-eval. Uma sondagem de diagnóstico com a origem acrescentada só no harness confirmou o progresso até ao runtime. A repetição final usa a política atual, sem alterações no harness.

**O Worker final não instrumentado passou no Chromium com a política nativa nos headers da página e do Worker.** Carregou a revisão fixada, produziu três vetores finitos/normalizados de 384 dimensões e encontrou similaridade pt/en de 0,9754838 contra 0,0500209 para uma frase não relacionada. O carregamento a partir dos ficheiros servidos localmente demorou 3.353,6 ms nesta execução. Foram observados cinco GET de ficheiros do modelo, zero pedidos a main/CDN, zero pedidos externos encaminhados e o módulo/Wasm foram carregados do próprio servidor de teste. Não é uma medição de download público ou de inferência num WebView Tauri/Android.

A interceção redireciona os GET de modelo para um servidor HTTP local que transmite os bytes da cache. A tentativa inicial de transportar o ONNX pelo DevTools excedeu o limite de 100 MiB do browser e falhou; ficou conservada. O diagnóstico em memória acrescentou apenas observação do erro do Worker sobre frases sintéticas. Uma passagem desse diagnóstico tinha omitido o header CSP do Worker e não foi aceite como validação da política. O harness foi corrigido, e o resultado final usa o asset original sem esse observador.

## Validação, migração e limites

Passaram **19 testes frontend em cinco ficheiros**: Worker, serviço, reindexação, promoção e pesquisa do perfil selecionado. Os novos asserts cobrem descoberta dos dois perfis fixados, percurso legado, recusa de trocar de perfil, runtime local sem cache blob e recusa antes de pedidos quando o backend Wasm falta. O lint dos dois ficheiros de código tem zero erros/avisos. O build TypeScript/Vite final passou, sem drift das 922 fontes de código observadas, dos onze downloads públicos ou do feed legado durante a execução. Mantém o aviso de chunks grandes. A primeira tentativa com URLs locais teve um erro TypeScript de backend opcional; acrescentou-se a recusa explícita, sem non-null assertion.

O ensaio de CSP já existente também passou: Wasm em main/Worker permitido com a política configurada, recusado no controlo sem wasm-unsafe-eval, eval e inline recusados em ambos os casos. Identidade do bundle/manifestos e contrato da chave/canal passaram depois dos testes. A suite não foi ampliada silenciosamente para alegar testes de instalação, Auth ou cofre.

Não há alteração de dependências, schema Firestore, Rules, índices, embeddings persistidos, seleção global, espaço de modelo ou limiar semântico. Mudaram o Worker e a origem de dados permitida na CSP nativa. Os instaladores assinados da etapa anterior não foram recompilados e terão de ser construídos das fontes finais antes de publicar. O rollback deve conservar revisão de descoberta, runtime local/cache sem blob e origem de modelo permitida; retirar esses pontos repõe as falhas descritas.

As primeiras falhas do harness foram conservadas: import ESM com caminho Windows sem file URL; inventário que exigia um ficheiro opcional não carregado; e descoberta do tokenizer offline sem revisão. Não se repetiu o download para esconder essas falhas. A conclusão do inventário e a inferência usaram os ficheiros já obtidos e verificados.

Evidência privada: `W:/real/mnemosyne-launch-evidence/local-reranker-evaluation-20261025/`. Prova consolidada: `embedding-discovery-local-validation-20261025.json`, encadeada à recuperação da chave Windows de 25 de outubro. Esta etapa não repete suites gerais frontend/Functions/Rules, não configura CI remoto e não executa deploy. Permanecem os critérios das fases 0–6, incluindo substituição global/migração do modelo, cobertura multi-hop/atualização, escala e pilotos de plataforma.
