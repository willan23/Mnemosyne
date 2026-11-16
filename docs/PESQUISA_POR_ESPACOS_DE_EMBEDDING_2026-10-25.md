# Pesquisa de vetores persistidos em vários espaços — 25 de outubro de 2026

A pesquisa deixava de encontrar vetores persistidos com revisão fixada quando não existia um checkpoint local preparado. Sem uma seleção local, o hook criava apenas a consulta do modelo inglês legado. Com seleção, a ausência do checkpoint também levava esse vetor ao grupo legado. O ranking recusava corretamente comparar espaços incompatíveis, mas a memória desaparecia da parte semântica dos resultados. Uma regressão antes da correção devolveu apenas a memória legada, perdendo as duas memórias versionadas.

## Encaminhamento da consulta

O hook passou a usar o mesmo encaminhador com ou sem seleção local. Cada grupo reconhecido recebe uma consulta calculada pelo seu próprio modelo: legado inglês, inglês com revisão fixada ou candidato multilingue com revisão fixada. Um checkpoint preparado válido substitui localmente o vetor desse documento para a pesquisa; na sua ausência, o encaminhador respeita o espaço do vetor persistido. Vetores preparados e persistidos do mesmo espaço partilham uma única inferência da consulta.

O reconhecimento de perfis exige o identificador completo de modelo, SHA, dtype, pooling e normalização. Um URL, identificador de modelo sem revisão ou espaço desconhecido não inicia o download de um modelo arbitrário. Vetores versionados com dimensão incorreta são excluídos antes da inferência; a validação numérica e o cálculo continuam no Worker de ranking. Memórias bloqueadas, apagadas ou com âmbito de equipa ambíguo não entram nos grupos. Duplicados, checkpoint de outro perfil e cancelamento interrompem o pedido. As verificações de autorização e de geração da conta/cofre/consulta antes e depois do processamento mantêm-se no hook.

Foi separado o nome explícito `LEGACY_EMBEDDING_MODEL` do futuro modelo por omissão. O serviço legado e o Worker sem perfil usam esse nome. Os valores atuais de `CURRENT_EMBEDDING_MODEL` e `CURRENT_EMBEDDING_SPACE` continuam iguais aos anteriores; este incremento não faz a substituição global nem reclassifica vetores históricos como se tivessem uma revisão conhecida.

A opção de desativar a preparação passou a dizer **Usar vetores guardados**, nos quatro idiomas. Retira a sobreposição local e volta a pesquisar pelos modelos dos vetores persistidos. Não apaga nem restaura vetores na cloud. O harness de ciclo de reindexação foi alinhado com esse texto e o encaminhador comum; passou a verificação de sintaxe, mas não foi executado integralmente neste incremento.

## Verificação e limites

- Regressão reproduzida antes da implementação: três testes passaram e o caso novo falhou; depois passaram **56 testes focados em nove ficheiros**.
- Suite frontend final: **1798 testes em 213 ficheiros**, sem falhas ou omissões. Build TypeScript/Vite e identidade 1.0.9 passaram. Lint geral: zero erros e 23 avisos anteriores; o âmbito alterado tem zero avisos. Mantêm-se os avisos de chunks/imports do build e os avisos de teste registados no log.
- Build Functions e **48 testes de API/SDK/relações/agrupamentos** passaram, sem omissões. A suite geral Functions e Rules não foi repetida neste incremento; os resultados anteriores 580 + uma omissão prevista e 316/23 Rules conservam o âmbito da prova OpenRouter anterior.
- Chromium real executou o encaminhador e o ranking de produção, com o Worker final do build sem alteração. Os dois modelos fixados geraram vetores reais normalizados de 384 dimensões. A pesquisa recuperou a memória inglesa e a francesa, tanto sem seleção como com seleção multilingue sem checkpoints. Os vetores/objetos de origem ficaram iguais.
- A página e o Worker usaram a CSP nativa. Dez pedidos de assets dos modelos foram servidos de cache por loopback, com zero pedidos por `main`, bloqueios ou encaminhamentos externos. Não houve chamadas generativas. Os oito ficheiros únicos foram comparados depois do ensaio com os digests Git/LFS das revisões exatas no repositório upstream; foram consultados apenas metadados públicos, sem descarregar pesos novos.

O browser usou identidade e memórias sintéticas e uma leitura de checkpoint que devolve ausência. Não montou a aplicação completa, Auth publicado, cofre ou armazenamento real dos checkpoints. O primeiro pedido após preparar três vetores demorou cerca de 38 ms e o segundo, com consulta em cache, 0,5 ms; estes valores não são um benchmark de corpus/dispositivo. O carregamento inicial e as três inferências demoraram cerca de 3,4 s nesse ambiente.

O limiar continua 0,38. A junção de scores de modelos distintos não foi calibrada nem prova abstenção factual, contradição ou recuperação multi-hop. Espaços desconhecidos continuam indisponíveis para pesquisa semântica, sem impedir os percursos lexicais autorizados. Os instaladores nativos não foram recompilados. Não houve escrita de dados de produção, leitura de payloads de secrets, pedido generativo ou deploy. A inspeção da configuração pública Firebase para classificar a chave cliente é uma leitura de configuração pública, não uma leitura de secret privado.

## Trabalho necessário para a migração global

Este encaminhamento permite uma transição com corpus misto, mas não conclui a fase 5. Faltam a publicação por CAS dos novos vetores, preservando cifra, campos de grafo, anexos e outros metadados; histórico do vetor anterior; recibos idempotentes e rollback; e journal cifrado recuperável no cliente. Os endpoints de edição existentes não devem ser reutilizados sem essa separação, porque uma revisão de conteúdo pode invalidar relações e campos gerados.

A alteração do modelo por omissão para novas memórias exige validar criação, grafo, API, exportação e sincronização em conjunto. Permanecem os critérios de qualidade/abstenção/multi-hop, percursos O(N) da interface, desempenho e pilotos nas plataformas. **Os 49 gates continuam fechados; fases 0–6 e lançamento completo não estão concluídos.**

Prova privada: `W:/real/mnemosyne-launch-evidence/embedding-space-routing-local-validation-20261025.json`, encadeada à prova OpenRouter anterior. Logs, imagens anteriores, resultados e hashes ficam em `W:/real/mnemosyne-launch-evidence/embedding-space-routing-validation-20261025/`. A prova cobre este incremento e a continuidade dos ficheiros enumerados, sem declarar revisto todo o checkout misto.
