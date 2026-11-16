# Pesquisa rápida: resultados vinculados e calibração separada — 23 de outubro de 2026

## Problemas confirmados

O `useSessions` calculava resultados lexicais/semânticos autorizados, mas `App.tsx` entregava apenas `sessions` à `CommandPalette`. A pesquisa rápida voltava a pesquisar a lista geral e não consumia o resultado semântico produzido pelo hook, incluindo os checkpoints do perfil selecionado. Um score solto numa memória também podia fazer o componente aceitar uma lista sem vínculo à consulta.

O motor tinha ainda um segundo problema: receber um mapa explícito de scores vazio não retirava um `memory.semanticScore` anterior. O teste do before-image, executado por transpilação em memória num processo privado, confirmou um resultado antigo quando se esperava vazio. O código corrigido devolve zero resultados no mesmo caso. Não foi necessário restaurar temporariamente a fonte antiga no checkout.

## Decisão e implementação

O hook expõe `searchResults` com UID, consulta exata normalizada por trim, hits atuais e estado de processamento semântico. `App.tsx` passa esse resultado diretamente à pesquisa rápida. O resultado continua em memória e não acrescenta persistência, telemetria de queries ou permissões.

O componente exige UID e cofre aberto. Quando recebe um resultado explícito, conserva um resultado vazio e recusa outro UID/consulta, sem voltar à lista geral. Revalida os filtros estruturados e o estado bloqueado antes do limite de dez hits, preservando ordem, score, snippet e tipo de correspondência do motor. Sem resultado explícito, o percurso lexical não usa scores soltos de memórias como prova de uma consulta semântica atual. A autorização por equipa continua no hook; o vínculo UID/consulta da UI não substitui essa autorização.

Um mapa explícito de scores é agora a autoridade para essa consulta. Uma memória ausente do mapa recebe score semântico zero, mesmo que contenha um score antigo. Um resultado lexical pode continuar a aparecer por texto, mas já não propaga o score antigo. Sem mapa explícito, o contrato existente do utilitário continua disponível aos chamadores que fornecem scores dentro das memórias.

As verificações existentes do hook continuam a invalidar resultados ao mudar a consulta, fonte, seleção de perfil, conta, pertença ou geração da chave. As callbacks de inferência/ranking antigas são descartadas. A UI mostra o estado semântico atual; não persiste um estado de carregamento anterior como resultado. Não há mudança de schema, rules, índices, fornecedores, pesos, perfil global ou limiar semântico.

## Calibração com perguntas separadas

O benchmark aceita `--dataset calibration`, além do conjunto de desenvolvimento anterior. O novo corpus tem **48 documentos e 176 perguntas sintéticas** em quatro idiomas. A parte de ajuste tem 88 perguntas e a parte de validação outras 88, com tópicos e textos de perguntas disjuntos. Cada parte contém 48 perguntas suportadas, 24 sobre um facto ausente de um assunto presente e 16 sobre assuntos ausentes. O conjunto também não reutiliza os textos do conjunto anterior de 112 documentos/76 perguntas.

O corpus de recuperação é fixo para ambas as partes. Só os rótulos da parte de ajuste participam na escolha do limiar. Depois dessa decisão, a validação é medida com o limiar escolhido, ou com a referência 0,38 se o ajuste foi recusado. Os textos de validação não são um conjunto independente de aprovação de produto; continuam a ser fixtures escritas nesta implementação. Nenhum rótulo ou limiar foi alterado depois de observar a validação.

O executor testa 14 limiares predefinidos entre 0,38 e 1 usando as funções reais do produto. Um limiar só seria candidato se recuperasse pelo menos uma evidência relevante em 90% das perguntas positivas e devolvesse resultados em, no máximo, 5% das negativas. A lógica recusa a solução trivial de retirar todos os resultados e recusa rótulos da validação durante o ajuste. A decisão é apenas de avaliação; não grava uma política no runtime.

### Resultado: nenhum limiar aprovado

| Medida | Inglês fixado | Candidato multilingue |
| --- | --- | --- |
| Ajuste em 0,38: positivas com alguma evidência relevante | 48/48 | 48/48 |
| Ajuste em 0,38: negativas com resultados | 36/40 | 30/40 |
| Ajuste em 1: negativas com resultados | 24/40 | 24/40 |
| Limiar escolhido | Nenhum | Nenhum |
| Validação em 0,38: recall médio das positivas | 0,5469 | 0,8958 |
| Validação: negativas corretamente sem resultados | 4/40 | 14/40 |
| Validação: facto ausente do mesmo assunto, sem resultados | 0/24 | 0/24 |
| Validação: assunto ausente, sem resultados | 4/16 | 14/16 |

As notas relacionadas continuam a passar pelo ranking lexical mesmo quando o limiar semântico chega a 1. Isto mostra que subir apenas esse limiar não resolve a falta do facto perguntado. Os resultados são correspondências de pesquisa, sem prova de que contêm uma resposta. Não houve modelo generativo, resposta fabricada ou teste de alucinação neste percurso. A abstenção exigida na avaliação continua por resolver e não foi declarada aprovada.

O conjunto de desenvolvimento anterior foi executado novamente com as fontes e artefactos atuais: o recall positivo médio mantém-se 0,6618 para a referência inglesa e 0,9118 para o candidato. Isso não prova generalização nem altera as limitações de multi-hop/atualização já registadas. O perfil multilingue não foi ativado globalmente e o limiar de produção continua 0,38.

## Validação e âmbito da evidência

- **33 testes frontend em sete ficheiros**, sem omissões: motor, hook, pesquisa rápida, filtros, âmbito, índice incremental e pesquisa do perfil selecionado.
- A composição do hook real com a pesquisa rápida real foi renderizada no teste. Verificou resultado apenas semântico, espera pela resposta, descarte da consulta antiga, resultado vazio atual e desaparecimento ao bloquear o cofre. Firestore, cifra, inferência e transporte Worker são simulados nesse teste; não certifica a app inteira com Auth publicado.
- A inspeção AST de `App.tsx` confirmou a extração de `searchResults` da chamada `useSessions` e a sua passagem ao componente. O before-image não tinha essas ligações. Esta verificação de fonte complementa a composição testada e o TypeScript; não é um ensaio da app inteira montada.
- **Nove testes Node**, sem omissões: métricas/rótulos anteriores, separação dos conjuntos, seleção só no ajuste, recusa de configurações inválidas e da solução que rejeita tudo. Entram no job CI já existente; execução remota não foi feita nesta continuação.
- Build/TypeScript frontend passou. Lint dos sete TS/TSX alterados tem zero erros e os mesmos dois avisos anteriores de set-state-in-effect na pesquisa rápida. Comparação por regra, cabeçalho, contexto da fonte e número de ocorrências confirmou que apenas se moveram linhas; não foram acrescentadas exclusões ou alteradas regras ESLint.
- A primeira passagem dos testes novos teve três falhas porque título e snippet tinham o mesmo texto. Os testes passaram a selecionar o botão acessível do resultado, mantendo os cenários e asserts de ausência; a falha original foi conservada.
- Os modelos reais fixados foram executados offline em processos separados nos dois conjuntos. Isso verifica as funções empacotadas e os modelos Node com cache local, sem executar o hook/UI com esses modelos reais. Não mede browser, Tauri, Android ou cofres grandes. O build conserva o aviso de chunks grandes.

Comandos principais:

```powershell
node --test scripts/retrieval-eval.test.cjs
node frontend/scripts/benchmark-embeddings-expanded.mjs --dataset calibration --out W:\real\mnemosyne-launch-evidence\calibracao-nova.json
node frontend/scripts/benchmark-embeddings-expanded.mjs --out W:\real\mnemosyne-launch-evidence\desenvolvimento-novo.json
```

O destino deve ser absoluto e ainda não existir. Evidência em `W:/real/mnemosyne-launch-evidence/search-result-binding-validation-20261023/`, incluindo before-images, regressão do mapa de scores, falha inicial, passagem final, calibração e comparação do lint.

## Migração, rollback e requisitos restantes

Não há migração de dados. O rollback de código deve conservar o vínculo de consulta/conta e a autoridade do mapa vazio; retirar estas verificações recupera os problemas descritos. Nenhum artefacto foi publicado nesta etapa.

Zero mutações de produção, payloads de secrets, pedidos generativos ou deploys. Os 49 gates permanecem fechados. Suites gerais, Functions e emuladores anteriores não foram repetidos neste incremento. Permanecem a abstenção de suporte factual, os conjuntos de evidência multi-hop/atualizada, calibração mais ampla, desempenho em cofres grandes e ensaios de plataformas, além das restantes fases e pré-requisitos operacionais do lançamento.
