# Revisão pessoal recuperável — 9 de outubro de 2026

## Contrato implementado

A geração pessoal captura a versão do documento ao apresentar o resultado editável. A captura exige que texto e título decifrados correspondam ao conteúdo acabado de guardar. O rascunho transporta `sessionId`, revisão numérica, hash integral e hash do estado com a versão de escrita do Firestore. A gravação nunca adota silenciosamente uma versão posterior como base. A revisão de equipa conserva o seu percurso separado; este incremento não prova uma baseline de rascunho para equipas.

`personalRevisionRecovery` exige conta/cofre atuais, dono, `teamId:null` explícito e memória legível, viva e sem partilha. Captura o pedido e a baseline por valor antes dos awaits. Só inicia inferência depois de verificar a baseline. Uma mudança de conta/cofre observada permanece inválida mesmo depois de regressar. A guarda da geração acrescenta âmbito/política; a interface suprime resultados tardios e conserva o rascunho após falha.

Antes do RPC de escrita, guarda em `mnemosyne:personal-revision:v1:<uid>` um diário AES-GCM do cofre, com UUID, cifras anterior/nova, baseline e metadados estritos. Usa Web Locks por conta, verifica os bytes depois de guardar e recusa substituições durante os awaits. Retoma reutiliza o mesmo pedido; não volta a inferir, gerar IDs ou cifrar. Um diário adulterado, transplantado para outro UID, ilegível com outro cofre ou substituído permanece conservado e não é confirmado.

Os callables europeus são `preparePersonalRevision`, `applyPersonalRevision`, `getPersonalRevisionStatus` e `cancelPersonalRevision`. A preparação devolve apenas hashes/revisão, sem conteúdo/cifra do documento. A escrita valida conta ativa e estado integral/versão Firestore numa transação; cria arquivo cifrado, atualiza pai/semântica/revisão, cria recibo privado e consome orçamento diário atomicamente. Preserva dono, âmbito, timestamp inicial, anexos, tags, categoria, ligações e origem de aprendizagem; acrescenta `learning.revisedAt` e limpa projeções/prompts antigos do pai. O arquivo contém uma projeção permitida de metadados e a cifra anterior.

O recibo `personalRevisions/<UUID>` liga UID, memória, digest do pedido e resultado terminal. Repetir um commit depois de eliminar o pai confirma o resultado histórico sem recriar a memória ou consumir orçamento novamente. Cancelamento de um pedido desconhecido cria um recibo que recusa escrita tardia; cancelar um commit confirma o resultado e não o desfaz. Status/cancelamento continuam disponíveis quando o gate de escrita está fechado. Antes de remover o diário, o cliente consulta e compara novamente o resultado terminal.

## Limites e privacidade

- Pedidos estritos até 2.100.000 bytes; texto novo até 500.000 bytes UTF-8 e título até 2.000 bytes. Metadados vetoriais/posicionais seguem o contrato de sincronização; não aceitam autoridade, campos extras ou conteúdo em claro.
- Orçamento por UID/dia: 200 revisões e 20 MiB de cifras serializadas em base64. O orçamento global e a calibração de abuso de todos os modos continuam necessários. Os callables têm limite por conta e não ligam segredos de fornecedores.
- Recibos e orçamentos negam leitura, listagem e escrita direta a dono, terceiros e anónimo. A eliminação da conta enumera ambas as coleções por UID; a limpeza local usa fronteiras exatas de chaves e conserva outras contas.
- A recuperação é local ao diário do navegador/instalação. Retenção/TTL, perda do armazenamento e retoma entre instalações continuam pendentes. Não há recuperação automática sem chave do cofre.
- O servidor conserva cifras de sessões já cifradas e exige que `priorEnc` corresponda ao conteúdo anterior. Para notas legadas em claro, o cliente cifra o arquivo; o servidor valida o envelope, mas não atesta que contém semanticamente o texto legado.
- O painel de recuperação conserva o rascunho atual. Uma confirmação genérica não apaga nem rebaseia um rascunho posterior; voltar a editar a memória exige obter uma baseline atual. A persistência do rascunho existente na captura continua a exigir revisão global de privacidade.
- Se a criação já foi confirmada, mas a captura posterior da baseline falha, o serviço devolve o ID criado e a interface conserva o resultado com revisão indisponível. Não reporta falha de criação nem repete o fornecedor. A baseline transportada neste incremento pertence à vista de geração montada; persistir/reabrir essa vista e o seu rascunho com isolamento/cifra continua pendente.
- Writers/regras diretos legados, partilha/equipas, migrações, App Check, pilotos nativos e as outras fases permanecem em execução. Os gates `PERSONAL_REVISION_WRITES_ENABLED` frontend/servidor estão fechados até ao rollout completo.

## Validação

Validação terminada em 10 de outubro: passaram 830 testes gerais frontend/135 ficheiros, 78 focados finais/seis ficheiros, 237 unitários Functions (um teste de integração separado ignorado) e 156 Functions +23 frontend no emulador Firestore/Storage. A suite geral precede o tratamento final da indisponibilidade da baseline depois da criação; os focados finais e build abrangem essa alteração. TypeScript/builds, lint zero erros/23 avisos anteriores, quatro testes do procedimento de deploy/21 pontos de falha e ambas as auditorias de produção com zero vulnerabilidades passaram.

Chromium confirmou cifra/storage/Web Locks reais e o executor de revisão com base sintética em localhost, sem fornecedores ou produção. A primeira fixture transacional sem getAll e o teste que esperava mudança de versão após uma escrita sem alteração foram corrigidos; o teste final altera e restaura conteúdo, conserva o digest e exige a mudança da versão Firestore. Logs e fontes ficam na prova privada `W:\real\mnemosyne-launch-evidence\personal-revision-local-validation-20261009.json`. O preflight confirma 29 gates/14 ficheiros fechados. Este incremento não declara qualquer fase ou o produto prontos.
