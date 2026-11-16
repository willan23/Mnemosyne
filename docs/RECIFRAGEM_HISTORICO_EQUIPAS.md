# Recifragem opcional do histórico de equipa

## Continuação local de 16 de outubro de 2026 — protocolo recuperável

O coordenador deixou de gravar por transação SDK. Usa quatro callables em `europe-west1`, com ator autenticado ligado ao pedido: preparação, aplicação, consulta e cancelamento. A implementação está local e os gates frontend e servidor `TEAM_HISTORY_REENCRYPTION_ENABLED` continuam falsos. A configuração remota de manutenção continua separada de `writesEnabled`. Não houve migração nem publicação de dados reais.

### Preparação, cifra e confirmação

O cliente fornece os hashes integrais da vista do documento, pai e equipa. O servidor captura também as versões `updateTime` desses registos, da época ativa e da época histórica, incluindo a ausência desta última. Ao aplicar, uma alteração revertida ou o aparecimento de uma época antes ausente recusa a preparação. Verifica novamente conta, owner/admin, pertença, equipa fora de eliminação, rotação, wraps e contexto. Versões legadas sem `teamId` herdam apenas o pai explícito permitido; tombstones continuam incluídos.

A recifra usa o JSON original decifrado, sem normalizar espaços do título, campos opcionais, Unicode ou disposição do JSON. O cliente valida estritamente o payload, cifra os mesmos bytes com AAD v2 e volta a decifrar para comparar. Formatos incompatíveis ou sem chave histórica interrompem o registo inteiro. O servidor recebe somente cifras e contexto; não recebe texto decifrado, mnemónica ou chaves.

Antes de enviar, o cliente guarda o pedido AES-GCM em IndexedDB, com UID/equipa/UUID, comparação atómica e readback. Mantém Web Locks por trabalho e por entrada, guardas de conta/cofre/cache e o mesmo UUID após falhas. Dois resultados terminais concordantes precedem a confirmação do cursor. O checkpoint v1 existente continua compatível; passa a ter CAS, roundtrip cifrado e verificação de leitura.

O callback persiste o cursor e contadores antes de apagar o pedido. Uma falha no armazenamento conserva a entrada pendente. Ao retomar, o coordenador reconcilia essa entrada antes de consultar a próxima página, inclusive quando uma pausa chegou depois de guardar o cursor. A reconciliação é idempotente: um cursor já contabilizado não incrementa outra vez. Uma falha de gravação do cursor também não publica em memória contadores como se estivessem confirmados.

### Arquivo e recuperação

| Coleção privada | Finalidade |
| --- | --- |
| `teamHistoryChanges` | Recibo imutável por UUID e ator |
| `teamHistoryEvents` | Evento sem conteúdo decifrado |
| `teamHistoryCipherArchives` | Cifra e presença/valor exatos dos sete campos substituídos |
| `teamHistoryBudgets` | Contador diário por ator/equipa |
| `teamHistoryTeamBudgets` | Contador diário agregado da equipa |

Arquivo, atualização, recibo, evento e contadores são atómicos. São alterados apenas `enc`, `teamId`, `keyEpoch`, `keyId`, `rekeyRevision`, `rekeyJobId` e `rekeyedByUid`. Não há versão semântica adicional nem alteração de `updatedAt`, autoria, datas, tags ou campos desconhecidos. O arquivo anterior privado conserva cifra antiga; esta implementação não comprova eliminação de todas as cópias antigas, nem fornece restauro automático dessa cifra. Retenção operacional, descoberta/exportação de arquivos e corte das permissões SDK antigas continuam critérios de lançamento.

Um recibo terminal próprio é consultado antes de exigir a disponibilidade atual da equipa/pai. Recuperação continua possível após remoção de pertença ou fonte; exige conta e cofre próprios válidos. Sem recibo, uma fonte revogada produz resultado apenas de leitura. Cancelar um pedido desconhecido funciona durante rotação, mesmo sem documento da época ativa. Nunca reverte uma operação já gravada. Não cancela um pedido de outro `jobId`.

`TeamHistoryChangeRecoveryPanel` encontra pedidos do UID atual em páginas de 20 equipas, sem exigir que a equipa continue visível. Recupera/cancela com admissão fechada e impede feedback tardio após troca de conta/cofre. O painel das Definições observa reconciliações e retira callbacks de contextos abandonados. Purga de conta limpa o diário local do UID e registos privados do ator; purga da equipa inclui as cinco coleções, inclusive arquivos de outros administradores dessa equipa.

### Validação e limites atuais

- Oito testes de protocolo servidor; cinco cenários em Firestore real emulado: reenvios concorrentes, CAS/ABA dos cinco contextos, aparecimento de época histórica, cancelamento/fecho, SDK privado e purgas de conta/equipa.
- 62 testes focados de serviços/interface aprovados. O leitor/coordenador real passou no emulador com 28 documentos, páginas de versões, pausa/retoma, metadata conservada e IDs Unicode suplementares.
- Chromium real passou com factory/painel, AES, IndexedDB/Web Locks e executor reais; Auth/base/acesso a chaves de equipa sintéticos. Comprova payload exato, resposta perdida/reload/recuperação com gate fechado, cursor antes da limpeza sem dupla contagem, cancelamento durante rotação e token trocado. Zero pedidos externos ou mutações de produção.
- As primeiras falhas e correções permanecem nos logs. O ensaio nativo passou a esperar a libertação real dos locks antes de iniciar outro trabalho, em vez de inferir conclusão apenas pela ausência momentânea do diário.

Evidência atual: `W:/real/mnemosyne-launch-evidence/team-history-validation-20261015/` (iniciada a 15/10 e continuada a 16/10). Validações gerais e prova consolidada são registadas no [estado do lançamento](ESTADO_LANCAMENTO_COMPLETO.md). O preflight cobre agora **41 gates em 22 fontes**, todos fechados. Quotas/limites globais e custos, retenção/exportação, cutover, piloto com RSA e dispositivos reais e todos os restantes critérios das fases 0–6 continuam pendentes.

## Registo histórico da implementação de 1 de outubro

Os parágrafos seguintes descrevem a versão anterior, com transações SDK. O protocolo acima substitui esse percurso do coordenador atual; as regras de compatibilidade ainda aguardam o corte global.

Implementação local de 1 de outubro de 2026. Funcionalidade não ativada nem publicada; não foi executada sobre dados reais. A fase 3 continua aberta até migração, ligações recíprocas, piloto, restauração isolada e plataformas estarem verificados.

## Decisão e ameaças

A rotação continua a revogar apenas escritas futuras. O cliente owner/admin pode optar por substituir o ciphertext antigo armazenado no Firestore por v2 na época ativa. A ação inclui sessões, tombstones e subdocumentos de versões; não recifra anexos e não apaga cópias externas de um ex-membro. Nenhuma chave nova de grupo é gerada neste processo. A rotação não espera pela conclusão do histórico.

Guardar outra versão com o ciphertext antigo em cada recifragem conservaria a exposição que se pretende reduzir. Por isso, esta manutenção altera apenas ciphertext/contexto e marcadores de manutenção, sem criar versões semânticas nem alterar a autoria, conteúdo, timestamps, tags ou outros metadados. A edição normal continua a exigir o par pai/versão; a exceção de manutenção tem permissões e bloqueio separados.

O servidor não possui as chaves e não consegue comprovar igualdade de plaintext. Apenas owner/admin atual pode substituir ciphertext antigo. O cliente decifra de modo estrito e recifra o mesmo payload `text/title`; formato incompatível, campo adicional dentro do payload ou falta de chave histórica interrompem a operação sem descartar conteúdo. Não se aplica recifragem de backend nem fallback para cifra pessoal, plaintext ou chave antiga de escrita.

## Componentes e fluxo

- `teamHistoryReencryption.ts`: coordenador, leitor paginado e transação de manutenção.
- `TeamHistoryReencryptionPanel.tsx`, integrado nas definições de equipa: confirmação explícita, iniciar/retomar, nova verificação, progresso, pausa e cancelamento; textos nas quatro línguas do produto.
- `teamVault.ts`: leitura estrita opcional do payload para esta manutenção, conservando a leitura existente para os outros fluxos.
- `firestore.rules`: exceção de manutenção para sessões/versões com âmbito e metadados preservados.

O coordenador lê a equipa do servidor, vincula o trabalho à época/ID ativos e persiste primeiro o checkpoint cifrado pelo cofre pessoal. Usa Web Locks exclusivo por equipa. Uma plataforma sem Web Locks ou com lock ocupado falha sem improvisar coordenação. Há no máximo uma escrita em curso.

As sessões são consultadas por `teamId`, ordenadas por ID, em páginas de cinco. Cada página é consumida uma vez. O pai é lido de novo antes de preparar a cifra; as versões são percorridas por ID em páginas de dez. Um cursor de sessão e outro de versão permitem retomar dentro de uma sessão com muitas versões. Os pedidos de páginas usam a fonte de servidor; não se declara conclusão a partir de cache offline.

Por documento, o cliente seleciona a chave histórica, decifra localmente, seleciona a chave ativa e produz v2 com AAD `{teamId,keyEpoch,keyId}`. A transação relê equipa, pai, documento e época ativa. Verifica papel, pertença, estado ativo/wrap, contexto alvo e ciphertext/revisão ainda iguais aos lidos. Uma alteração concorrente provoca conflito e pausa; não se substitui o conteúdo novo por uma preparação antiga. A comparação do envelope usa valores, independentemente da ordem das propriedades do mapa Firestore.

Uma versão legada sem `teamId/keyEpoch/keyId` recebe âmbito do pai, época de origem 1 e leitura v1. Na manutenção passa a ter âmbito explícito e v2. Versões v2 exigem contexto válido. Um documento já no alvo é apenas verificado. Nova rotação ou alteração de pertença/papel interrompe a ação; um trabalho antigo não é redirecionado silenciosamente para outra época.

## Schema, checkpoint e idempotência

| Local | Dados |
| --- | --- |
| Sessão/versão | `enc`, `teamId`, `keyEpoch`, `keyId`; os restantes metadados são conservados |
| Manutenção | `rekeyRevision` inteiro crescente, `rekeyJobId` UUID, `rekeyedByUid` igual ao ator autenticado |
| Checkpoint cifrado local | versão 1, UID/equipa/jobId, época/ID alvo, cursores, estado e contadores |
| Estados | `running`, `paused`, `cancelled`, `complete` |
| Métricas | documentos verificados, recifrados pelo trabalho e já na época alvo |

O checkpoint não contém AES, wraps, mnemónica, privada ou conteúdo de memória. No armazenamento só existe o envelope cifrado do cofre. A validação recusa UID/equipa trocados, campos extra, cursores inválidos, contadores inconsistentes e formato ilegível; um checkpoint inválido é conservado para análise, sem sobrescrita automática.

O cursor avança só depois da confirmação da transação. Uma resposta perdida ou falha de armazenamento após commit deixa o cursor anterior; na repetição, o documento já no alvo com o mesmo `rekeyJobId` comprova o resultado e é contado sem outra escrita. Não se incrementa novamente `rekeyRevision`. Outro trabalho que já o tenha convertido é contado como atual. Os marcadores guardam a última manutenção; não são uma auditoria append-only de todas as execuções.

Pausa/cancelamento impedem o próximo pedido e conservam progresso. Uma escrita já enviada pode terminar. Pausar permite retomar o mesmo trabalho; cancelar é terminal e não restaura chaves/ciphertexts antigos. Uma nova verificação exige confirmação e um checkpoint anterior terminal. O cancelamento local está disponível mesmo com a flag fechada ou destino obsoleto, desde que o cofre/UID permaneçam válidos.

UID, cofre e geração da cache são vigiados durante a ação. Conclusões tardias depois de mudar conta/cofre/cache não confirmam progresso no contexto novo. Fechar a vista pede pausa; um cancelamento já confirmado mantém a intenção de cancelar. A interface identifica a época alvo dos contadores, inclusive se existir um checkpoint de época anterior. Erros são apresentados de forma fixa, sem ciphertext ou diagnóstico recebido.

## Regras, migração, índices e publicação

`TEAM_HISTORY_REENCRYPTION_ENABLED=false` permanece no frontend. A regra exige separadamente `config/teamSecurity.historyReencryptionEnabled=true`; configuração ausente/falsa fecha a manutenção. Não se permite ao cliente configurar esse documento. `writesEnabled` continua a controlar edições normais. O ensaio demonstra manutenção autorizada com escrita normal fechada, sem abrir o caminho de membros comuns.

As regras exigem owner/admin atual, conta fora de apagamento, época ativa/wrap e transição de época crescente ou conversão v1 para v2 na mesma época. Só os sete campos de cifra/contexto/manutenção podem mudar. O servidor fixa o UID do ator e exige incremento do marcador; timestamps de criação/revisão, conteúdo em claro e metadados não podem mudar por este caminho. Versões continuam inacessíveis a ex-membros e não podem ser apagadas pelo cliente.

Não foi adicionada migração administrativa de dados por esta funcionalidade: a transformação é opcional e feita com chaves no cliente. Exige a migração de épocas já definida e o backfill/índices de âmbito já exigidos em `MIGRACAO_ESCOPO_SESSOES.md`. As consultas usam índices automáticos de `teamId` e ID; o manifest tem `fieldOverrides:[]`. O emulador não comprova que índices estejam disponíveis em produção, pelo que isso deve ser verificado antes do piloto.

Antes de ativar: concluir os gates gerais, verificar ambas as configurações fechadas, publicar regras e frontend compatíveis com o release completo, ensaiar numa equipa piloto e só então ativar a manutenção autorizada. Validar owner/admin/membro/removido, navegador suportado, offline, falha após commit e cofre bloqueado. O piloto ainda não foi realizado; não se afirma suporte real Tauri/Capacitor por ter passado no navegador simulado.

Rollback: fechar `historyReencryptionEnabled` primeiro; conservar a época ativa, ciphertext já convertido e checkpoints. A UI pode ser retirada mantendo a possibilidade futura de retoma compatível. Não voltar à cifra/chave antiga nem reabrir edições antigas para reparar disponibilidade. Um cliente antigo sem v2 pode deixar de ler versões convertidas; a compatibilidade do cliente é um requisito de publicação.

## Evidência de validação

Os testes usam exclusivamente dados e chaves sintéticos. A suite do coordenador comprova paginação com mais de dez versões, concorrência máxima um, pausa/cursor, nova verificação, cancelamento, storage/ACK perdidos, contexto alterado, lock ausente/ocupado e recusa de checkpoint/acesso inválidos. Os testes da UI cobrem confirmação, flags/papel/cofre, pausa, cancelamento e abandono da vista.

O emulador executa as transações criptográficas e o leitor/coordenador de produção: 25 versões antigas em várias páginas, pausa e retoma a partir do cursor, 28 documentos verificados sem duplicação, metadados imutáveis, chave antiga recusada e nova legível. Recusa membro comum, ex-membro, campos/época/ator forjados, conta em apagamento, bloqueio administrativo e payload incompatível. Wraps dos fixtures são placeholders; este ensaio não comprova RSA de produção.

Comandos usados: `npm --prefix frontend test -- --run`, `npm --prefix frontend run build`, ESLint do escopo, e `emulators:exec --only firestore,storage --project demo-mnemosyne-rules` com JDK 21/Firebase CLI 15.32.0 e credenciais removidas. Resultados finais e limitações estão em `DECISOES_FASE3.md`. Alguns pedidos negativos produzem mensagens do limite de expressões no emulador; transações válidas são comprovadas, sem afirmar profiling geral de regras.

Durante o ensaio alargado, corrigiu-se o suporte de `dispatchEvent` no fixture Node e a expectativa do cursor para a ordem real dos IDs. O produto não foi alterado para evitar esses testes. A correção da comparação do ciphertext por valores tem teste próprio para mapas com propriedades em ordem diferente.
