# Agrupamentos recuperáveis — 14 de outubro de 2026

## Problema e decisão

O backfill anterior usava as memórias filtradas pela pesquisa e gravava até 400 documentos diretamente por SDK. Não conservava um pedido recuperável nem a versão integral dos documentos que contribuíam para o cálculo.

O cálculo continua a preencher apenas agrupamentos em falta a partir dos componentes das ligações existentes. Não é Louvain, não infere novas relações e não decide se um conteúdo é verdadeiro. Conserva agrupamentos já preenchidos. Para novos identificadores, usa um namespace separado por conta pessoal ou equipa.

`App` passa agora `allSessions`. O plano separa cada equipa do âmbito pessoal do proprietário e exclui documentos partilhados, bloqueados, apagados, ambíguos ou sem projeção verificável. A preparação confirma a projeção apresentada e captura as versões integrais Firestore antes de calcular os identificadores. Uma ligação de saída para outro documento ativo do mesmo âmbito que ficou fora do pedido recusa o componente incompleto.

## Admissão, interrupção e repetição

- Quatro callables em `europe-west1` ligam o ator capturado ao token antes de limites ou leituras. Usam os gates existentes das revisões pessoais e das escritas de equipa, que continuam fechados.
- Cada lote admite até 100 alterações e até 20.000 dependências, com pedido de até 6 MB. O servidor deriva os mesmos identificadores e recusa labels arbitrários, versões obsoletas e alterações de autoridade/época.
- Antes de qualquer aplicação, guarda um UUID e o pedido com AES-GCM no IndexedDB do UID. Web Locks, comparação atómica e readback impedem substituir ou limpar um pedido diferente. O UID e o UUID estão ligados ao corpo cifrado e ao cabeçalho.
- A transação altera apenas `semanticClusterId` e `updatedAt`. Conserva texto, título, cifra, autor, timestamp, anexos, vizinhos e restantes campos. Cria recibo, evento com metadados anteriores e contadores privados; não fabrica versões de conteúdo para esta operação de metadados.
- O próximo lote avança somente as versões das alterações próprias confirmadas. Não volta a preparar/rebasear o componente entre lotes. Usa `updateTime` do recibo criado no mesmo commit; `serverTimestamp` tem precisão de milissegundos e não serve para reconstruir a versão integral. Ver [referência Firestore](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write#servervalue).
- Uma resposta perdida conserva o pedido. O painel global oferece recuperar ou cancelar; a recuperação consulta primeiro o resultado. Um recibo terminal próprio continua consultável após remoção da equipa e com a admissão fechada. Revogação definitiva sem recibo não cria novas referências.
- Um lote com labels já iguais não altera os pais nem cria arquivos de conteúdo; regista o resultado e uma operação de manutenção. Repetir um recibo terminal não debita outra operação.

## Privados e eliminação

Novas raízes: `semanticClusterChanges`, `semanticClusterEvents`, `semanticClusterBudgets` e `semanticClusterTeamBudgets`. As regras recusam leituras e escritas SDK, inclusive do proprietário. A eliminação da equipa inclui as quatro raízes. A eliminação da conta purga os seus contadores e referências como ator, proprietário ou autor contribuinte. A limpeza local usa comparação atómica do registo exato do UID e conserva outras contas. Eventos locais, BroadcastChannel e foco atualizam a vista de recuperação.

## Limites e trabalho de lançamento

O algoritmo foi ensaiado com uma cadeia de 20.000 nós, sem recursão. Isso não prova a manutenção de um cofre arbitrariamente grande numa única passagem. Componentes acima do limite, pedidos acima de 6 MB e quotas esgotadas interrompem a operação; um pedido já guardado continua disponível para recuperação. Os contadores diários locais deste contrato precisam da calibração global de custos da fase 2 antes da abertura em produção.

A preparação protege o conjunto declarado e as suas ligações de saída. Não é um snapshot global de todas as ligações de entrada não recíprocas legadas. A migração, reconciliação de referências e o cutover das permissões SDK antigas continuam obrigatórios. Memórias sem `teamId` explícito não são reinterpretadas como pessoais pelo hash. Não houve backfill, deploy ou alteração de dados de produção nesta validação.

## Validação

Logs e artefactos privados: `W:/real/mnemosyne-launch-evidence/semantic-cluster-validation-20261014/`.

Os testes incluem isolamento pessoal/equipas, preparação por valor, cadeia grande, três lotes com versões próprias, concorrência/ABA, recusa de alteração arbitrária, cifra/metadados intactos, no-op, quotas, overflow de revisão, recuperação durante rotação, troca de conta/cofre/token, diário danificado ou substituído e limpeza por participante/UID.

Chromium usa os serviços e painel reais, AES, IndexedDB, Web Locks e executor do servidor, com Auth/base sintéticos. Passou perda de ACK, reload, recuperação com gate fechado, cancelamento, token trocado e limpeza atómica que conserva outra conta. Zero pedidos externos no ensaio. Os testes de emulador confirmam os timestamps/versões reais e a recusa dos quatro conjuntos privados.

O estado consolidado, com os resultados gerais e a prova imutável, está em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

## Migração e rollback

Publicar exige concluir as restantes fases e o cutover compatível. Ao suspender esta manutenção, fechar os gates existentes e conservar os leitores de recuperação, recibos, eventos e limpeza. Não apagar um pedido sem confirmar o seu estado terminal. As labels aplicadas não alteram o conteúdo cifrado. Uma eventual reversão administrativa de metadados deve usar os valores anteriores do evento e comparar a versão atual com o commit esperado, recusando alterações posteriores.
