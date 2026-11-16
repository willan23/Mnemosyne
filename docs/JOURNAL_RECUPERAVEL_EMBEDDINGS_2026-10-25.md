# Pedidos cifrados de publicação de embeddings — 25 de outubro de 2026

Continuação de 26 de outubro: o serviço está agora ligado ao [painel de publicação e histórico](INTERFACE_PUBLICACAO_EMBEDDINGS_2026-10-26.md), incluindo pendências visíveis, revisão/confirmação, retoma/cancelamento, exportação/importação cifrada sem aplicação automática e limpeza exata por conta. Não existe expiração automática do journal. Os 1837 testes frontend finais, incluindo os 60 do escopo focado, dois casos SDK Firestore/emulador, build/lint e ensaio Chromium de recuperação e rollback com CSS do build final passaram; a nota nova conserva os limites e resultados das tentativas anteriores. Modelo global/gates continuam inalterados e não houve deploy. As descrições de UI ainda por integrar abaixo pertencem ao âmbito histórico da prova de 25 de outubro.

O protocolo do servidor já conserva recibos e arquivos, mas um cliente que perde o ACK precisa do mesmo pedido para o recuperar. Foi acrescentado o serviço `embeddingIndexRecovery`, com publicação de checkpoints preparados, referência de rollback e retoma/cancelamento. Ainda não está ligado à interface da aplicação; não altera automaticamente o modelo global nem publica vetores no arranque.

## Vinculação e persistência antes do envio

A captura lê o documento atual do servidor e confronta o digest da vista apresentada, o UID, o âmbito pessoal não partilhado, a revisão e a identidade do envelope/epoch. O cliente decifra a memória com a chave atual para confirmar que o cofre está aberto. Antes de publicar, confronta a baseline capturada com nova leitura/preparação do servidor e compara o objeto atual apresentado com o texto/título decifrados e com o digest integral do documento. Só aceita o checkpoint validado do perfil multilingue revisto e a mesma referência imutável durante a preparação.

O pedido final é validado pelo contrato partilhado com o servidor e cifrado com a chave pessoal. O journal contém UID, propósito, versão e pedido, incluindo o nonce e a baseline exatos. É decifrado e comparado antes de ser guardado, e a leitura de confirmação dos bytes guardados precede qualquer pedido de aplicação. Falta de storage, cifra inválida ou outro pedido pendente impede a escrita. Um pedido de rollback contém apenas a referência do arquivo, sem recalcular um vetor ou reenviar conteúdo em claro.

O journal usa uma chave de storage por UID e um Web Lock pelo mesmo âmbito. Guardas de conta/cofre mantêm as mudanças observadas latched durante a operação, mesmo se o valor anterior regressar. Eventos de storage noutro separador também invalidam a operação; substituição dos bytes é verificada antes e depois dos awaits. Não são removidos journals de outras contas.

## Recuperação e cancelamento

A retoma começa por consultar o estado do mesmo pedido. Se o servidor já o confirmou, o cliente não volta a ler o documento, checkpoint, vetor ou nonce, mesmo com o gate de novas escritas fechado. Um pedido ainda desconhecido só pode ser aplicado com admissão aberta; o cancelamento continua disponível quando fecha.

Um estado `revoked` sem recibo não equivale a cancelamento permanente. O cliente exige então um cancelamento durável antes de limpar o journal. Se a conta estiver a ser apagada e o servidor recusar também o cancelamento, o pedido cifrado é conservado. A perda de ACK, confirmação inconsistente, falha da consulta terminal ou falha de remoção local conservam os mesmos bytes para nova tentativa. O journal só é removido depois de duas respostas terminais consistentes. O servidor continua a resolver a corrida entre aplicação e cancelamento.

O vetor é enviado ao Firestore pelo endpoint próprio, como metadado sensível já previsto no produto. O texto/título não fazem parte do pedido de publicação. A correspondência entre texto e vetor depende do checkpoint gerado/validado no cliente; o servidor valida espaço, dimensão, norma, autorização e CAS, sem decifrar o cofre.

## Verificação

Passaram **63 testes em quatro ficheiros**, incluindo os 18 novos casos do serviço e regressões dos checkpoints, guardas de conta/cofre e edição recuperável. Cifra AES-GCM real; RPC, identidade e storage dos testes unitários simulados. TypeScript e lint dos dois ficheiros passaram, com zero erros e zero avisos. O primeiro controlo de tipos recusou a propriedade declarada no parâmetro do construtor por `erasableSyntaxOnly`; foi substituída por campo/atribuição explícitos e repetidos os controlos. Os resultados anteriores foram conservados.

O ensaio Chromium final passou com o serviço real do cliente, Web Crypto, IndexedDB, localStorage e Web Locks. Preparou um checkpoint cifrado com um vetor sintético, enviou um pedido ao executor real do servidor com adaptador de transações em memória e perdeu a resposta depois do commit. Após recarregar a página, abriu o mesmo journal de 1943 bytes, confirmou o recibo com novas escritas desativadas e removeu-o. O envio de aplicação ocorreu uma única vez; não houve nova leitura da memória, checkpoint, vetor ou nonce na recuperação. Cifra, grafo, anexos e aprendizagem mantiveram-se.

A CSP nativa foi aplicada à página. Zero pedidos externos encaminhados, geração cloud, leituras de secrets ou mutações de produção. A identidade é sintética; o ensaio não monta a aplicação completa nem prova Auth/App Check publicados ou transações Firestore reais. Os cenários reais do servidor são verificados separadamente na suite de emuladores. Não houve inferência real de modelo neste ensaio; essa parte conserva o âmbito da prova anterior de encaminhamento.

## Integração e riscos restantes

Faltam os controlos da UI para publicar/reverter/retomar, a sua integração com estados de erro e acessibilidade, a visibilidade de pedidos pendentes e os percursos de limpeza/exportação/retention local. Este serviço ainda não é importado por um fluxo de produto. A candidata web/instaladores publicados não incorporam um percurso de migração global. Mantêm-se o gate de revisão pessoal fechado e a seleção global legada.

Persistência cifrada não protege contra código malicioso com acesso ao cofre aberto. Pedidos já enviados podem terminar depois de uma mudança de conta/cofre; o journal permite confirmar o resultado ao regressar ao âmbito correto. Perda do dispositivo/storage pode perder o pedido local; o recibo do servidor mantém o resultado, mas não existe ainda uma lista de operações recuperável sem o nonce.

Ainda são exigidos os critérios de substituição/migração global, qualidade, plataformas e as restantes fases 0–6 antes do deploy completo autorizado. Prova privada prevista: `W:/real/mnemosyne-launch-evidence/embedding-index-client-local-validation-20261025.json`. Evidência em `W:/real/mnemosyne-launch-evidence/embedding-index-client-validation-20261025/`. Nenhum deploy neste incremento.
