# Alterações incrementais entre Firestore e índice híbrido

## Problema e implementação

O Worker já normalizava apenas documentos alterados. Porém, o cliente reconstruía um Map com todas as memórias, comparava todas as referências e gerava uma lista completa de ordem em cada novo snapshot. O custo de descobrir uma alteração unitária continuava proporcional ao corpus na interface.

`useSessions` passou a alimentar `HybridSearchCorpus` com os IDs de `docChanges()` do Firestore. A autorização usa o UID e as equipas do âmbito capturado antes de admitir referências no corpus; registos bloqueados ou eliminados são excluídos antes da projeção. A primeira carga contém todos os documentos. Atualizações seguintes conservam os objetos imutáveis inalterados e fornecem apenas alterações/remoções.

O journal contém IDs de alterações, até 256 batches e 20.000 IDs contabilizados. Não conserva cópias de texto de revisões antigas. Ao saltar snapshots intermédios, a leitura agrega os IDs e usa apenas o seu valor atual. Um cursor anterior à janela disponível exige um Worker novo e reconstrução completa, evitando conservar documentos cuja remoção já saiu do journal. Não há truncagem silenciosa do corpus ou dos resultados.

## Âmbito, concorrência e ordem

Cada corpus pertence a uma subscrição de conta/cofre/equipas. Capturas têm revisão e são reconhecidas por um WeakMap interno; um objeto externo com os mesmos números não é aceite. Preparação/ranking recusam uma resposta se o corpus mudou entretanto. A limpeza retira as referências e fecha permanentemente esse âmbito: callbacks antigos não podem voltar a preenchê-lo. Mudança de chave limpa-o imediatamente; troca de conta/equipas, nova subscrição e desmontagem retiram o anterior. A aplicação volta a construir o corpus no âmbito novo.

IDs de alterações são acumulados enquanto há decifração pendente. Assim, um snapshot novo que substitua um anterior ainda por concluir não perde os documentos iniciais inalterados. Uma subscrição recusada remove os IDs desse bucket; o resultado combinado respeita a autorização corrente. Erros de limites/identificadores deixam a pesquisa indisponível, com resultado vazio e loading terminado, sem reutilizar um índice parcial como completo.

A ordenação deste percurso é calculada no Worker por timestamp descendente. Nos empates conserva-se a ordem de entrada no índice; uma alteração não reposiciona um empate pela ordem incidental do novo snapshot. A API anterior por array conserva a sua ordem explícita e continua coberta pelos testes de equivalência. Não se alteram scores, limiar 0,38, filtros ou espaços de embedding.

## Validação

- **99 testes frontend em dez ficheiros**, sem omissões, incluindo o hook, corpus, cliente/índice, pesquisa estruturada e selecionada, cache de checkpoints, reutilização de snapshots e propagação de erros do manifesto de versão. TypeScript e lint dos 13 ficheiros do âmbito passaram, sem erros/avisos; a verificação final do teste Node atualizado também passou.
- O ensaio `node scripts/hybrid-search-worker-browser.cjs` usa o cliente/corpus reais e o **Worker compilado pelo build**, em Chromium com 10.000 registos sintéticos. A reutilização normalizou zero documentos; uma alteração normalizou um; uma remoção normalizou zero e retirou um ID. As três operações leram zero propriedades dos objetos de origem inalterados para preparar o pedido incremental. O ensaio não mede todos os percursos da aplicação.
- O mesmo percurso cobre alteração de timestamp no Worker, filtros, fusão semântica com scores sintéticos, lease antiga, cancelamento e reconstrução. Expirar o journal reconstrói 9.998 registos e não recupera os dois eliminados. Conteúdo bloqueado e campos fora da projeção não são enviados. A limpeza recusa a lease e a escrita do âmbito retirado. Os Workers criados são encerrados. Zero rede externa e persistência neste ensaio; Auth, modelos e dispositivos reais não estão abrangidos.
- A passagem inicial teve 96 aprovações. Um caso adicional reproduziu a aceitação indevida de uma escrita após limpeza no código novo, ainda não publicado: sete casos passaram e esse falhou. A limpeza passou a fechar o âmbito; o mesmo caso e a suite de 97 passaram. Outro caso reproduziu a perda de um bucket recuperado após falha de mapping quando o snapshot seguinte não tem docChanges: 16 casos passaram e esse falhou. Uma primeira carga/recuperação agora admite todos os IDs desse bucket, mesmo sem docChanges. Ambos os casos passaram na suite final de 99, sem alterar asserts/timeouts. Logs e fontes anteriores às correções foram conservados.

## Escritor dos manifestos de versão

O build voltou a falhar ao abrir `public/version.json` no closeBundle, apesar de não haver testes sobrepostos. O motivo exato do erro Windows UNKNOWN não foi demonstrado. `writeVersionFile` passou a evitar escritas quando os bytes já coincidem e a escrever uma substituição num temporário exclusivo da mesma pasta, seguido de rename. Uma falha de escrita/substituição conserva os bytes anteriores e é propagada; temporários próprios são limpos quando possível, preservando o erro principal. Não há retry infinito ou sucesso após falha.

O wrapper deixou de ocultar erros do manifesto dist. Passaram **cinco testes Node 22 em Windows**, com ficheiros temporários reais, criação/substituição, escrita indisponível com conteúdo igual e falhas injetadas de escrita/rename. O teste frontend separado confirma que uma falha dist chega ao build. A configuração CI exige os testes Node em Linux e Windows. Não se afirma consistência de builds concorrentes no mesmo checkout, resistência a falhas físicas do disco ou diagnóstico definitivo do bloqueio inicial.

O ficheiro write-version.ts foi adotado como fonte revista: não fazia parte do manifesto pai. A imagem anterior foi reconstruída pela inversão da alteração e o texto normalizado coincide com HEAD; não havia hash bruto do ficheiro de trabalho registado antes da edição. A reconstrução da alteração CI foi confirmada byte a byte pelo hash pai. Esta proveniência limitada é explícita na prova e não declara o checkout inteiro verificado.

Testes e build foram executados em sequência porque o plugin de versão de Vite/Vitest escreve os mesmos ficheiros gerados. Não foram repetidas as suites gerais frontend/Functions nem Rules; mantêm o seu âmbito histórico. O ensaio alarga a etapa de Chromium já obrigatória na configuração de CI, mas não comprova a sua execução remota.

## Trabalho restante

Foi retirado o varrimento integral redundante de descoberta/projeção deste cliente de índice no percurso Firestore. A carga inicial e a reconstrução após perda do cursor continuam completas. Mantêm-se a materialização/merge/ordenação dos snapshots, filtros de ACL da vista, mapas de candidatos e recursos de UI com percursos O(N). A comparação vetorial exata continua O(ND) no Worker. Não se declara toda a interface incremental, ausência de long tasks, a fase 5 ou o lançamento concluídos.

Qualidade de abstenção, promoção multilingue global, proveniência restante, pilotos operacionais/nativos, CI remoto e restantes critérios das fases 0–6 continuam exigidos. Não há migração de schema, Rules, índices Firestore, secrets ou dados. O rollback exige cliente e Workers do mesmo build. Os artefactos Android anteriores não foram recompilados nesta alteração web.

Evidência privada em `W:/real/mnemosyne-launch-evidence/search-deltas-validation-20261024/`, prova `search-deltas-local-validation-20261024.json`, encadeada à prova de cache de checkpoints. **49 gates continuam fechados; zero mutações de produção, leituras de payloads de secrets, pedidos generativos ou deploys neste incremento.**
