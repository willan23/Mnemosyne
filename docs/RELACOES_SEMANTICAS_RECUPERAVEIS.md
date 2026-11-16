# Criação e revisão de relações recuperáveis — 14 de outubro de 2026

## Problema e decisão

A criação automática de sugestões e a revisão no detalhe usavam transações SDK. A revisão já era atómica para o par e a decisão, mas não tinha pedido recuperável após perda de resposta nem versões integrais capturadas da vista revista.

Os dois percursos passam para comandos ligados ao ator e recibos privados. O cálculo continua a ser similaridade de cosseno, com limiar de 0,75 e até sete propostas por fonte. Não demonstra causalidade, contradição ou veracidade. O algoritmo e a identificação do espaço de embedding são partilhados pelo Worker e pelo servidor.

## Preparação e cálculo

A cache fornece um hash da projeção de ID/UID/âmbito, revisão, vizinhos, vetor e modelo. A preparação valida esses hashes e captura versões integrais antes de carregar o Worker. Só entram memórias pessoais próprias, não partilhadas, não apagadas e com âmbito explícito. O pedido contém IDs/hashes; não envia texto, título ou vetores a fornecedores de IA.

O Worker mantém o ranking fora da interface. Para cada fonte, o pedido retém as versões dessa fonte e dos alvos selecionados. O servidor recompõe os scores e metadados desses pares a partir dos embeddings já guardados. Não relê o cofre inteiro em cada fonte. Esta verificação não afirma que o pedido de um cliente arbitrário contém os melhores alvos de todo o cofre.

Propostas anteriores aceites/rejeitadas são conservadas. Um resultado vazio também tem recibo, e o cursor só avança depois da confirmação. O cursor incorpora o hash do vetor/modelo/vizinhos, não apenas dimensão e revisão. A preparação está limitada a 20.000 candidatos e 6 MB; operações guardadas localmente têm limite de 64 KB. Não são medidas de qualidade ou desempenho para um cofre arbitrário.

## Revisão e recuperação

O detalhe captura os hashes mostrados de fonte, alvo e sugestão. A preparação lê os dois pais e ambas as sugestões, incluindo ausência da recíproca. Aceitar pede confirmação do par. Mudanças de seleção, conta, cofre ou vista retiram a autorização local. A lista de sugestões também está vinculada à conta, memória e geração; callbacks antigos não repõem a lista.

Aceitar valida novamente as versões e o score real, recusa uma rejeição na outra direção e grava os dois vizinhos necessários, arquivos cifrados anteriores e decisões na mesma transação. Conserva a cifra, autoria, timestamp, anexos e metadados não alterados. A evidência recíproca em estado sugerido é normalizada a partir do par verificado, conservando o registo anterior no evento. Decisões terminais anteriores são preservadas. Rejeitar não remove ligações nem reescreve o conteúdo.

O pedido é cifrado com AES-GCM e guardado por UID com UUID estável antes de aplicação. Web Locks, comparação de bytes e readback conservam pedidos danificados, substituídos ou sem confirmação. O painel global recupera ou cancela. Recuperar consulta primeiro o recibo e confirma o estado terminal antes de limpar. Recuperação confirmada de uma criação permite retomar o trabalho; cancelar não provoca uma repetição automática imediata. Memórias removidas sem recibo produzem revogação só de leitura.

## Privados, custos e compatibilidade

`semanticRelationChanges`, `semanticRelationEvents` e `semanticRelationBudgets` recusam SDK e integram a eliminação da conta; o diário usa a chave local exata do UID. As sugestões continuam subordinadas ao pai e são removidas com a árvore da memória.

Preparação e aplicação têm contadores atómicos de operações, leituras e escritas. O contrato atual limita por dia 2.000 operações, um milhão de leituras contabilizadas e 10.000 escritas, além do rate limit e do limite local de 500 fontes/dia. Calibração global, retenção e alertas permanecem na fase 2. Usa o gate existente de ligações pessoais, ainda fechado. Não abre as permissões SDK antigas; o cutover global depende dos escritores/migrações restantes.

A proveniência nova distingue sugestões inferidas. Não reclassifica automaticamente todas as ligações antigas como explícitas, nem afirma que os pesos/modelos ou a evidência por chunk já foram avaliados. Modelo multilingue, exportação/sincronização integral da proveniência e qualidade em cofres grandes continuam no programa da fase 5.

## Verificação e rollback

Logs: `W:/real/mnemosyne-launch-evidence/semantic-relations-validation-20261014/`. Incluem testes de versões/ABA, scores falsos, decisões opostas, preservação de cifra/arquivos, concorrência, nonce/ator, quota, recusa SDK e purga. Chromium usa factory/painel, AES, localStorage, Web Locks e executor reais com Auth/base sintéticos. Os testes de interface verificam prévia do par, cancelamento da prévia e mudança do alvo durante preparação.

Manter fechado o gate interrompe novas aplicações e preserva consulta/cancelamento/recuperação. Não apagar diários antes de confirmar o estado terminal. Conservar leitores, recibos/eventos e arquivos. Reverter uma decisão aplicada exige rever as versões atuais; não reutilizar um pedido antigo como operação inversa. Não houve deploy, fornecedor generativo ou mutação de produção neste incremento. Resultados consolidados em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).
