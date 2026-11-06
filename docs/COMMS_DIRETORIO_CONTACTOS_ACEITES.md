# Diretório e procura de contactos aceites — 12 de outubro de 2026

Atualização posterior: a [remoção recuperável de contactos](COMMS_REMOCAO_CONTACTOS_RECUPERAVEL.md) acrescenta a verificação do lock na leitura e o percurso em lotes/recibos. As métricas abaixo conservam o incremento anterior do diretório.

## Contrato

O painel passa a ter uma página própria de contactos aceites. A lista anterior dependia das páginas correntes de pedidos recebidos/enviados e podia omitir relações antigas. O callable EU `listCommsPage` aceita agora as famílias `contact-directory` e `contact-search`; as cinco famílias anteriores mantêm o seu contrato.

O diretório consulta `friendRequests` nas duas direções do UID autenticado, com `status == accepted`, ordenação por ID e limite de 26 candidatos em cada query. Junta os IDs em ordem UTF-8, sem duplicar o mesmo documento, e percorre até 25 por página. O cursor é o último candidato percorrido; uma linha inválida não bloqueia as seguintes. As páginas são leituras independentes, sem promessa de snapshot global ou ordenação cronológica. Relações duplicadas para o mesmo peer são deduplicadas na página apresentada, podendo reaparecer noutra página histórica.

Não são criados pares, backfills ou novos documentos nesta leitura. A lista inclui relações aceites antigas mesmo quando existem muitos pedidos pendentes anteriores ao cursor das outras listas.

## Autorização e chave atual

O UID tem de corresponder ao token antes do rate limit. Auth é verificado para o chamador e cada peer encontrado; uma transação final verifica perfis/marcadores permanentes e relê a relação. Uma relação entretanto rejeitada, eliminada ou com participantes alterados não expõe o perfil anterior.

O perfil público tem de estar ligado ao UID correto e à mesma chave de `users/{uid}`. É usada a validação existente de RSA canónica, 2048–4096 bits e expoente 65537. O fingerprint é calculado sobre a chave pública atual, sem reutilizar chaves/labels históricos do pedido. São devolvidos apenas participantes, estado/datas e UID/nome/chave pública/fingerprint do peer; email, dados privados e campos adicionais armazenados não atravessam a resposta.

Contas ausentes/desativadas/eliminadas e perfis inválidos retiram apenas a respetiva linha e aumentam a contagem de indisponíveis. Uma falha transitória de Auth/Firestore falha a página. Uma leitura já entregue ao cliente não é revogada retroativamente por este mecanismo.

## Procura pontual

`contact-search` recebe um UID ou email exato. O email é normalizado e resolvido com Admin Auth; seguem-se as duas queries limitadas, desta vez com ambos os participantes e estado aceite. Não há pesquisa por nome nem listagem de utilizadores/perfis. Um destinatário sem relação aceite não fornece um perfil nesta procura.

O cursor liga UID, família, entrada normalizada e UID resolvido. Editar a entrada impede reutilizar o cursor; uma mudança de titular do email entre páginas aborta a continuação. A projeção recusa um UID diferente numa procura por UID, múltiplos peers na resposta ou um peer que não corresponde ao cursor. O cursor é um marcador de posição, sem autoridade própria.

O cliente captura a conta, cofre, vista e revisão da entrada. Editar a procura, trocar de conta/cofre ou fechar o painel retira respostas tardias. Há procura, continuação quando necessário, erro com retry e retorno ao diretório. Selecionar um resultado usa a chave/fingerprint projetados e identifica-o como contacto aceite. O compositor conserva a página do diretório; o painel já não faz leituras SDK individuais de `publicProfiles` para construir a lista.

## Índices e rollout

O manifesto acrescenta três índices de `friendRequests`: `fromUid/status`, `toUid/status` e `fromUid/toUid/status`. Os índices anteriores e field overrides foram comparados e conservados. Os emuladores não comprovam que estes índices estejam prontos na cloud. A publicação coordenada exige deploy e estado READY dos índices antes de publicar o callable/cliente que usa as novas famílias.

Permanecem os rate limits de 60 consultas por UID/minuto e 600 por projeto/minuto, e o limite de resposta de 2 MiB. O diretório pode ler até 52 candidatos iniciais e depois as verificações limitadas de contas/perfis/relações; requer calibração operacional de custo. Não há alteração de rules, dependências, novas permissões SDK ou abertura de gates de escrita.

O rollback do incremento deve restaurar callable e cliente compatíveis. Os índices adicionados podem ser conservados durante o rollback. A leitura não tem migração persistente a desfazer.

## Validação e pendências

Passaram 1.054 testes frontend/152 ficheiros, TypeScript e build web. Lint geral: zero erros e 23 avisos anteriores; lint do escopo: zero erros/avisos. Passaram 47 testes focados/quatro ficheiros, incluindo procura, retorno ao diretório, falhas e respostas tardias após edição, conta/cofre/fecho. Functions: 317 unitários e um skip de rules sem emulador, antes do último teste negativo adicional de cursor; a passagem final cobre os 15 testes do serviço/contrato e quatro do pipeline. Três testes focados no emulador usam queries/transações reais, Auth sintético e provam limites, direções, revogação, índices declarados e recusa SDK. A suite integral de rules, audits e CI remota não foram repetidos.

O ensaio Chromium final passou diretório de 25 + 6 com 100 pedidos pendentes anteriores, UID fora da página corrente, email aceite com seleção da chave atual e destinatário sem relação. Incluiu as regressões anteriores de RSA/AES/IndexedDB/locks, relay/ACK e WebRTC nativo/fragmentação/retoma. Zero pedidos externos, chamadas de fornecedor ou mutações de produção. Os perfis adicionais são fixtures sintéticas e reutilizam uma chave RSA pública do ensaio. Os logs das falhas iniciais de fixtures e invocação foram conservados; não representam passagens bem-sucedidas.

Os resultados e hashes finais são registados na prova privada `W:\real\mnemosyne-launch-evidence\comms-contact-directory-local-validation-20261012.json`. O ensaio Chromium usa painel, serviços, RSA/AES, IndexedDB, locks e WebRTC nativos com fronteiras Auth/RPC/DB sintéticas em localhost; não substitui pilotos Firebase Auth, dispositivos ou rede externa.

Remoção recuperável de contactos aceites, conflitos/retenção de identidades, backup entre instalações e o restante programa das fases 0–6 continuam pendentes. O deploy completo está autorizado para depois da conclusão e validação de todas as áreas. O email operacional é wgftechnologies@gmail.com; configuração e entrega de alertas ainda não estão verificadas.
