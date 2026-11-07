# Modelo multilingue padrão para novas memórias — 26 de outubro de 2026

Continuação de qualidade no mesmo dia: a [experiência de coevidência](AVALIACAO_COEVIDENCIA_LOCAL_2026-10-26.md) manteve este modelo padrão e o runtime, mas não aprovou a integração do classificador adicional. A avaliação ampla conserva os casos em falta e o diagnóstico de fontes ausentes antes do reranking.

A candidata local passa a gerar novos embeddings com `Xenova/paraphrase-multilingual-MiniLM-L12-v2`, revisão `2c4055b12046f11709e9df2c122e59ffbdc2f900`, q8, mean pooling, normalização e 384 dimensões. O marcador completo fica em cada memória criada pelo motor cognitivo. Os testes ligam o modelo/loader padrão ao espaço já revisto pelo contrato de publicação. O identificador interno `multilingualCandidate` é conservado para manter as seleções e checkpoints persistidos legíveis.

## Compatibilidade e migração

A ausência de marcador continua a significar `Xenova/all-MiniLM-L6-v2@legacy-main`. Não significa o novo padrão. O serviço legado mantém um Worker separado para consultas históricas e a pesquisa continua a agrupar os vetores pelo seu espaço real. Relações inferidas e ligações do motor nunca comparam vetores de modelos diferentes só porque têm a mesma dimensão.

Os documentos existentes não são reescritos no arranque. A migração usa preparação local, revisão do lote e o protocolo CAS/histórico/rollback da [publicação recuperável](INTERFACE_PUBLICACAO_EMBEDDINGS_2026-10-26.md). O gate pessoal continua fechado e não foi feita migração ou publicação em produção. Memórias antigas sem revisão exata dos pesos continuam a ter a limitação histórica de proveniência; o marcador legado não comprova qual revisão as gerou.

## Bloqueio do cofre e caches

O serviço padrão deixa de ser o singleton inglês. A aplicação chama agora `resetEmbeddingServices` ao mudar a conta, falhar a restauração da autenticação ou mudar a chave/cofre. Esta ação termina o Worker legado e os perfis fixados e limpa as suas caches. O cancelamento de um perfil de preparação conserva a sua operação específica de limpeza.

Também foi corrigida uma janela em que uma resposta do Worker já resolvida podia chegar ao chamador depois do reset. O serviço verifica a geração novamente após receber a resposta e recusa devolver o vetor antigo. O teste reproduziu a ordem resposta → reset → retoma do await antes da correção.

## Validação

Antes da implementação, três casos novos falharam: serviço padrão ainda inglês, divergência com o espaço multilingue revisto e resposta entregue depois do reset. As cópias dos testes e o resultado anterior foram conservados. Depois da correção passaram **64 testes focados em sete ficheiros**, **1841 testes frontend em 216 ficheiros**, **594 testes Functions** e TypeScript/Vite. O único skip nos 595 casos gerais Functions é a suite de Rules fora do emulador. O lint dos oito ficheiros frontend/script alterados terminou sem erros ou avisos. O teste de backend novo também verifica que propostas de relações conservam grupos legado/multilingue separados.

O Chromium usou o serviço padrão, motor cognitivo, router, ranking e Worker compilado reais sob a CSP nativa. Gerou vetores finitos normalizados de 384 dimensões em pt-PT, pt-BR, inglês e francês. A consulta recuperou os quatro exemplos sobre um comboio e o exemplo inglês fixado, excluindo o exemplo de sementes. Cada grupo recebeu a consulta do seu modelo. A ligação automática nova só incluiu a memória do mesmo espaço e os objetos de origem mantiveram-se iguais.

Os dois Workers inicializados no browser foram terminados pelo reset; as caches ficaram vazias e uma chamada posterior criou um terceiro Worker com o mesmo vetor. Os testes unitários cobrem também o serviço legado inicializado e a corrida de resposta/reset. A aplicação completa, Auth, cofre/storage e o modelo legado sem revisão não foram exercitados neste browser. A identidade e as memórias são sintéticas; não houve escrita remota. O loader de checkpoints foi isolado porque este percurso usa vetores persistidos sem seleção local.

Os oito ficheiros dos dois modelos vieram da cache local. Os seus hashes atuais foram confrontados com os artefactos e a proveniência Git/LFS já selados em 25 de outubro para as mesmas revisões fixas. Nenhum pedido externo do browser foi encaminhado, nem houve inferência cloud ou leitura de secrets. O tempo de cerca de 4,47 segundos inclui carga local e chamadas deste conjunto pequeno nesta máquina; não mede downloads pela Internet ou desempenho de dispositivos móveis.

## Trabalho restante

Esta alteração substitui o padrão da candidata para novas memórias; não altera a aplicação publicada. Continuam exigidos a migração operacional de dados existentes, avaliação ampla/calibração por idioma e modelo, custos de memória/download em dispositivos, percursos O(N), pilotos Windows/Android, CI remoto e restantes critérios das fases 0–6. A suite integral anterior de 322 Functions/Rules +23 frontend/Rules mantém o seu âmbito; não foi repetida para esta alteração de modelo/cliente. Os 49 gates permanecem fechados e não houve deploy. A política de fornecedores cloud continua a admitir apenas modelos gratuitos.

Prova privada: `W:/real/mnemosyne-launch-evidence/embedding-default-local-validation-20261026.json`. Logs e imagens anteriores de fonte em `W:/real/mnemosyne-launch-evidence/embedding-default-validation-20261026/`.
