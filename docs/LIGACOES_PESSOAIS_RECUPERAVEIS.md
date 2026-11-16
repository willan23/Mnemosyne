# Ligações pessoais recuperáveis — 4 de outubro de 2026

## Estado e âmbito

Atualização de 5 de outubro: Obsidian/Universo inicial passam para o [protocolo do plano completo](IMPORTACAO_OBSIDIAN_RECUPERAVEL.md), com criação/recibos/progresso/ligações por lote. Este documento conserva o contrato de pares e a evidência histórica de 4 de outubro, aplicável aos restantes percursos. As pendências do lançamento completo mantêm-se.

Incremento das fases 1/4. Corrige as ligações explícitas da importação Obsidian, do Universo inicial e do lote documental. O objetivo permanece concluir as fases 0–6 antes do deploy completo autorizado. As duas gates novas permanecem `false`; esta implementação não declara a importação inteira nem qualquer fase concluída.

O percurso anterior criava `connections` num lado e atualizava os pares por escritas separadas, ocultando algumas falhas. A confirmação atual exige uma transação no servidor com os dois lados, versões cifradas dos documentos alterados e um recibo imutável. O cliente conserva um diário cifrado enquanto o resultado não for confirmado.

## Contrato e admissão

| Operação | Entrada/efeito |
|---|---|
| `preparePersonalConnection` | Dois IDs diferentes; devolve os IDs e dois hashes do documento/versão Firestore. Não devolve conteúdo, cifra ou anexos |
| `applyPersonalConnection` | ID estável da operação, dois IDs, `link`/`unlink` e hashes esperados; transação atómica |
| `getPersonalConnectionStatus` | Pedido original; consulta o recibo ligado ao UID e digest exato |
| `cancelPersonalConnection` | Pedido original; conserva um resultado já confirmado ou cria um marcador de cancelamento que impede uma aplicação tardia |

Todas as callables usam `europe-west1`, Auth e o estado vivo da conta, incluindo o marcador permanente de eliminação. Não têm bindings de segredos de fornecedores. DTOs com UID, texto, anexos, cifra, token, campos extra, auto ligação ou hashes inválidos são recusados antes das leituras de rate limit. Cada modo tem limite de 60 pedidos/minuto por UID. O `apply` fechado é recusado antes de rate limit/DB; consulta/cancelamento continuam disponíveis.

Preparação e aplicação novas exigem ambos os documentos: UID próprio, `teamId:null`, sem partilha, ambiguidade de equipa ou tombstone; texto em claro vazio, título ausente/nulo, envelope pessoal v1 e timestamps válidos. Listas de ligações existentes têm IDs únicos, sem auto ligação. Dados legados sem âmbito explícito exigem migração.

O CAS inclui o documento completo e o `updateTime` público do Firestore: uma mudança sem alterar o campo `updatedAt` também impede a escrita. Conflito não muda os hashes nem cria outro ID silenciosamente. Os dois estados anteriores são arquivados apenas quando alterados; conservam cifra, anexos e os metadados anteriores. A operação não cria memórias nem consome quota de criação.

Uma ligação prévia só num lado é reparada pelo mesmo protocolo. Quando ambos os lados já representam o pedido, grava-se um recibo sem nova versão ou alteração de timestamps. Repetir um recibo confirmado devolve o resultado histórico sem refazer ligações, ressuscitar um alvo apagado ou desfazer alterações posteriores. A mensagem da UI confirma a operação; não afirma que a ligação histórica ainda existe.

`personalConnectionChanges` é privada nas regras. Recibos/cancelamentos não têm TTL nesta etapa, para não perder idempotência. A eliminação da conta inclui esta coleção por UID e o diário local exato; os ensaios preservam as outras contas. As restantes escritas pessoais legadas continuam a exigir inventário/migração; a nova gate não fecha automaticamente todos esses escritores.

## Diário, conta e cofre

O diário `mnemosyne:personal-connections:v1:<UID codificado>` contém versão, UID e pedido original, cifrados com a chave do cofre. O armazenamento é verificado por leitura antes de `apply`. IDs, hashes e UID não ficam em claro dentro do valor armazenado. Os IDs/hashes enviados à callable são metadados operacionais; esta proteção não torna o grafo anónimo.

Web Locks recusam operações concorrentes entre abas antes do RPC. Mudanças observadas de conta/cofre ficam registadas durante a operação, mesmo que o utilizador volte à conta/cofre anterior. Cada await é seguido de confirmação do âmbito e do valor bruto do diário; substituição, corrupção, cofre errado e transplante para outro UID impedem chamadas posteriores. Um resultado terminal é consultado novamente antes de remover o diário por comparação exata.

Se a resposta de aplicação se perder, a recuperação consulta o mesmo pedido e pode confirmar o recibo mesmo com a gate de escrita fechada. Se o servidor ainda não conhecer o pedido, só se pode aplicar o original com a gate aberta ou cancelá-lo. Falha, CAS desatualizado ou resultado inválido conservam o diário. Um cancelamento já confirmado bloqueia a aplicação tardia. O painel exige confirmação explícita para cancelar e informa que as notas criadas são conservadas.

## Integração de importações

Obsidian captura UID/cofre antes de ler ficheiros, clona as notas antes da primeira criação e filtra os candidatos pessoais. O callback de guarda acompanha a cifra/persistência dentro de `persistLearnedMemory`, as ligações e o progresso. Não se migra uma importação em curso para a conta que entrou entretanto. O seletor de pastas web conserva o ator; o seletor Tauri acompanha a conta/cofre durante dialog/leitura/importação. Feedback tardio não publica sucesso após mudança de âmbito ou desmontagem.

Memórias com ligações explícitas são criadas inicialmente com `connections:[]`; as ligações só passam a existir depois da confirmação do servidor. Ligações repetidas de wikilinks nos dois sentidos são confirmadas uma vez por par; `linked` conta os pares únicos confirmados de wikilinks, excluindo as ligações à pasta. Falhas não são ocultadas e não devolvem sucesso global.

Obsidian e lotes documentais recusam a gate fechada antes de parse/upload/criação. A integração removeu também as atualizações redundantes do Sol pai nos lotes documentais. A criação sem anexos ainda usa o escritor anterior: falta ID/recibo/diário de criação e recuperação do plano completo da importação. O diário desta etapa recupera **um par de ligações**; não retoma automaticamente todos os ficheiros e pares restantes de um lote interrompido. Repetir uma importação parcial pode duplicar notas e requer o próximo incremento.

O limite de ligações pessoais e do transporte de sync passou a 2500 IDs, mantendo tags em 100 e os limites de bytes/vetores. Evita que um hub de 150 notas válidas viole o limite anterior de 100 ligações durante a sincronização. O limite de equipa continua separado. Isso não demonstra desempenho/custo de um grafo denso: rate limit, número de RPCs, históricos, quotas de criação, grandes cofres e matriz de clientes exigem piloto e admissão do lote inteiro.

## Validação local

- Build Functions e TypeScript frontend passaram.
- 59 testes frontend focados em sete ficheiros: diário/cifra reais, ACK perdido, confirmação, cancelamento, limites de conta/cofre/storage, integração Obsidian, persistência e painel.
- 203 unitários Functions passaram; a suite de regras fica omitida neste comando quando não há emulador.
- Chromium passou com cofre/cifra/localStorage/Web Locks reais e RPC sintética localhost: recuperação noutra aba, confirmação com gate fechado, repetição do pedido original, cancelamento, cofre errado/transplante/tamper e concorrência. Zero pedidos externos/produção.
- Quatro testes de deploy passaram, incluindo a sequência PowerShell de paragem em falhas. O preflight confirmou 19 gates em 11 ficheiros, todas fechadas; exit 2 recusa publicação.

As suites gerais passaram **656 testes frontend/120 ficheiros** e **136 Functions +22 frontend no emulador Firestore/Storage**. Build web passou (Vite 15,49 s) e lint terminou com **zero erros/23 avisos anteriores**. YAML/estrutura de CI, sintaxe dos scripts e diff dos ficheiros desta etapa passaram. A primeira passagem focada tinha uma falha na contabilização do histórico de um mock (`vi.fn` reutilizava o histórico do mock anterior); corrigiu-se o fixture e a passagem final de 59 testes passou. O log focado foi substituído pela passagem final; o resultado inicial fica explicitado na evidência, sem um log inicial conservado.

Fontes/logs/artefactos e limitações estão na evidência privada `W:\real\mnemosyne-launch-evidence\personal-connections-local-validation-20261004.json`. Os resultados correspondem a estas fontes estabilizadas; os incrementos anteriores permanecem históricos. Testes locais não demonstram Auth/App Check, implantação das callables, receção de alertas, restore ou pilotos em dispositivos de produção. O CI remoto e as fases completas continuam sem confirmação.

## Migração e reversão

O rollout deverá publicar funções/regras/clientes correspondentes depois dos critérios completos. Abertura coordenada das gates exige admissão/recuperação do lote inteiro, migração dos documentos legados e pilotos de custo/dispositivos. Reversão fecha novas escritas, conserva os diários e permite status/cancel das operações anteriores; não elimina recibos nem inverte silenciosamente uma relação que possa ter mudado depois.

Retenção, sincronização/relações entre dispositivos, outros escritores semânticos, eliminação, anexos, equipas e demais fases permanecem no [estado completo](ESTADO_LANCAMENTO_COMPLETO.md).
