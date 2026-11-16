# Abstenção extractiva e proveniência de spans — 15 de novembro de 2026

## Problema, decisão e limites da experiência

Foi avaliada uma segunda tarefa para distinguir informação ausente de texto apenas relacionado com o assunto. Na cópia instalada de Transformers.js 4.3.0, a pipeline question-answering mascara o candidato CLS antes de escolher o trecho. A experiência usa diretamente os logits de início/fim e conserva esse candidato de resposta ausente. Não altera a biblioteca instalada nem o ranking/modelos da aplicação.

O novo módulo frontend/scripts/retrieval-answerability.mjs é exclusivo de avaliação. Valida dimensões, máscaras, IDs permitidos e scores finitos, limita a 512 tokens/dois donos, limita a extensão da resposta e procura apenas spans contíguos pertencentes ao mesmo documento. Uma posição de pergunta, padding, separador ou outro documento não pode completar o trecho. O score compara o melhor trecho com CLS; não é probabilidade calibrada de verdade, autorização ou uma resposta final. O chamador continua obrigado a aplicar ACL antes de ler/tokenizar texto e após a inferência. Os helpers usam os filtros reais do produto sobre fixtures sintéticas; não são validação de Auth numa aplicação em execução.

O modelo fixado é onnx-community/bert-multi-english-german-squad2-ONNX, revisão 75656ef30cdf4e7c954640c89b8b1de8f3693159, ficheiro onnx/model_quantized.onnx, SHA-256 223fdebe8d8d24e13a91194163007c78cc77bf523f1922f97b0ec7dfb26fbe61. A [conversão](https://huggingface.co/onnx-community/bert-multi-english-german-squad2-ONNX) aponta para o [modelo original](https://huggingface.co/deutsche-telekom/bert-multi-english-german-squad2), cujo cartão indica MIT e treino inglês/alemão sobre mBERT. Português/francês são transferência a verificar, não suporte aprovado por esta escolha. O cartão convertido não especifica uma licença própria; não se distribuem pesos com o produto.

Quatro assets públicos, 181.368.090 bytes no total, foram descarregados sem credenciais e verificados pelos digests upstream. Revisão, oito pares do piloto e descodificador foram fixados antes da inferência. A primeira tentativa do helper esperava a propriedade cls_token_id que não existe nessa instância; foi conservada e corrigida para convert_tokens_to_ids a partir da configuração. Não tinha executado forwards. No piloto corrigido, os quatro casos positivos extraíram três/three/trois e os quatro casos com informação ausente preferiram CLS. Isso não constitui aprovação de qualidade.

## Avaliação maior e critérios preservados

Foram pontuados 5.388 contextos para as 316 perguntas dos conjuntos já conhecidos: calibração/validação 176, desenvolvimento 76 e holdout anterior 64. Embeddings, pools de candidatos e seleção de pares são históricos e foram verificados por hashes; logits QA são novos. Cada par foi lido nas duas ordens. Um score de par é atribuído apenas ao documento que contém o trecho escolhido. Não se cortou texto: o maior input teve 102 tokens. A execução foi offline, sem pedidos de rede ou inferência de fornecedor. O tempo total dos queries foi 71,5 s, p95 856,7 ms nesta máquina; não é um SLO, ensaio browser ou aceitação de dispositivos.

A política pré-declarada inclui score individual, máximo de suporte com dono, média de suporte com zero quando o trecho pertence ao outro documento e média com grafo. Nenhuma variante QA isolada encontrou um limiar que cumprisse simultaneamente 90% de perguntas positivas com algum resultado correto e até 5% de falsos positivos nos 88 casos de calibração. A auditoria dos 144 pontos críticos por variante, incluindo o próximo float representável, confirmou a rejeição. A decisão em cache coincidiu com o algoritmo direto em 9.152 comparações da grelha original. Só a parte de calibração foi usada nessa pesquisa.

| QA isolado | Menor taxa de falsos positivos mantendo hit >= 90% | Maior hit mantendo falsos positivos <= 5% |
|---|---:|---:|
| Individual | 20% | 83,3% |
| Máximo com dono | 22,5% | 83,3% |
| Média com dono, com/sem grafo | 17,5% | 66,7% |

Hit é a fração de perguntas positivas com pelo menos um documento relevante no top-k; não é recall médio dos documentos. Não havendo limiar aprovado, os oito critérios posteriores dessa política não foram avaliados num limiar utilizável. Os booleanos falsos do relatório inicial não devem ser interpretados como nove falhas empíricas independentes. O critério de calibração falhou e os seguintes ficaram sem avaliação válida.

Foi depois congelada uma experiência de combinação com relevância: multiplicar relevância e resposta extraível do mesmo documento ou do mesmo par, mantendo a atribuição do trecho ao dono. O produto desses scores também não é probabilidade calibrada. A variante primária de média com grafo voltou a falhar calibração. Um controlo de máximo com dono encontrou limiar 0,6481508163390747 apenas na calibração. No conjunto de validação de 88, recall 85,4% ficou abaixo do baseline de 89,6%; no holdout anterior de 64, recall 82,2%, evidência completa 65% e abstenção correta 23/24. Falhou seis dos nove critérios originais. Nenhuma variante foi integrada. Não se escolheram limiares com validação/desenvolvimento nem se alteraram rótulos, k ou metas. São experiências de desenvolvimento em dados já observados; um conjunto independente continua necessário.

## Testes, reprodução e rollback

Passaram 51 testes Node de recuperação, incluindo oito novos do descodificador, lint frontend zero erros/21 avisos anteriores e 23 contratos de distribuição. O workflow inclui o novo teste, sem carregar modelos ou usar rede nesse teste. Os 2.447 testes frontend/252 ficheiros, 126 focados/4, build/identidade, ensaios SDK/browser, backend/Rules e auditorias anteriores são conservados por hashes, sem repetição.

~~~powershell
node --test scripts/retrieval-eval.test.cjs scripts/retrieval-coevidence.test.cjs scripts/retrieval-evidence-graph.test.cjs scripts/retrieval-answerability.test.cjs
npm --prefix frontend run lint
node --test scripts/desktop-release-entrypoints.test.cjs scripts/release-gates-preflight.test.js scripts/secret-scan-policy.test.cjs
node W:/real/mnemosyne-launch-tools/run-answerability-pilot-20261115.mjs
node W:/real/mnemosyne-launch-tools/evaluate-answerability-context-20261115.mjs
node W:/real/mnemosyne-launch-tools/audit-answerability-calibration-20261115.mjs
node W:/real/mnemosyne-launch-tools/evaluate-joint-answerability-20261115.mjs
~~~

Os comandos da versão corrigida terminaram com exit code 0; a rejeição metodológica da opção é resultado da avaliação, não uma execução interrompida. Fontes, assets, protótipo falhado, políticas congeladas, scores e logs estão referenciados em answerability-local-validation-20261115.json. O carregamento usa o ficheiro int8 inalterado; dtype fp32 serve apenas para selecionar esse nome sem acrescentar um sufixo. Não foram usados tokens dos fornecedores.

O risco residual inclui extração do atributo errado, competição entre traduções, suporte relevante sem resposta e distinção insuficiente de informação atual. Restringir spans a donos não prova verdade nem resistência generativa a prompt injection. Não houve geração de respostas/ferramentas, mudança de modelo padrão, runtime, schema, Rules, índices, TTL ou dados de produção. Não há migração. Rollback: retirar o módulo/teste de avaliação, o item adicional do workflow e a documentação; nenhum consumidor do produto depende deles.

Continuam por aceitar qualidade representativa, recuperação de falhas, SDK online de 100.000 notas, aplicação completa/memória/dispositivos, instaladores e rollout. A política anterior continua com os seus cinco critérios falhados. PR em rascunho, fases 0–6 abertas, 49 gates falsos e sem merge/deploy. Configuração Google conservada; migrações, índices/TTL, alertas e bindings de produção não foram executados neste incremento.
