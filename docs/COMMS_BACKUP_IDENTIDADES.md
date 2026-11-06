# Backup, restauro e retenção das identidades Comms — 13 de outubro de 2026

## Guardar e verificar um backup

Nas definições, secção **Identidade**, o painel **Backup das identidades Comms** guarda um ficheiro JSON cifrado separado do export soberano de memórias. Este ficheiro contém a cifra primária, o pedido de troca local e até 20 cópias históricas do próprio UID. A mnemónica, as chaves privadas em claro e os dados de outras contas não entram nos metadados do ficheiro.

São necessárias a mesma conta e as 12 palavras para abrir o ficheiro. As identidades RSA são aleatórias: as palavras sem a cifra da identidade não recriam uma chave perdida. Guarda também o ficheiro num local seguro e separado do dispositivo que pretendes recuperar. A operação de download só confirma que foi iniciada; não demonstra que uma cópia foi guardada. **Selecionar backup para verificar** relê o ficheiro e confirma a cifra, o UID e cada identidade.

O formato externo é `mnemosyne.comms-identity-backup`, versão 1, com apenas `format/v/enc`. O conteúdo protegido inclui UID, UUID/data do backup e snapshot de primary/pending/history. O limite do ficheiro é 4 MiB. Os contratos recusam campos adicionais, proprietário/cofre incorretos, cifras alteradas, IDs repetidos ou inválidos e arquivos com associação de chaves inconsistente. Cada chave passa por validação RSA de 2048–4096 bits, expoente 65537 e uma operação real de cifra/abertura que prova a correspondência do par.

## Restaurar noutra instalação

A verificação mostra as contagens e as impressões digitais da chave publicada e da chave que pode ser restaurada. **Confirmar restauro da identidade** exige uma confirmação humana e relê o mesmo ficheiro. A prévia fica ligada ao digest do ficheiro, ao snapshot local e à base remota completa. Uma mudança antes da admissão exige nova verificação.

O restauro da identidade ativa lê o par remoto e os recibos necessários através dos RPCs existentes, vinculados ao UID capturado. Não escreve perfis, recibos nem budgets. Sem um pedido pendente, a chave escolhida tem de corresponder à publicada. Com um pedido pendente, a seleção conserva uma identidade compatível com o diário, para permitir recuperar/cancelar o mesmo UUID; uma troca já substituída pode continuar a exigir a resolução explícita descrita em [COMMS_IDENTIDADE_CONFLITOS.md](COMMS_IDENTIDADE_CONFLITOS.md).

A chave primária anterior do dispositivo fica cifrada no histórico. Uma chave primária do ficheiro distinta da chave escolhida também é conservada. Os diários históricos são unidos sem substituir bytes diferentes do mesmo UUID. Um pedido local existente não é apagado nem substituído por outro incompatível. Os pedidos importados são arquivados com os mesmos bytes, reservando espaço para a recuperação posterior. O limite de 20 entradas é verificado antes de começar.

**Importar apenas identidades históricas** conserva a identidade ativa e o pedido pendente do dispositivo. Permite recuperar a leitura das mensagens e wraps anteriores mesmo sem acesso aos RPCs remotos. Não transfere implicitamente uma intenção pendente para substituir a chave publicada. Depois de unir identidades de vários dispositivos, guarda e verifica um novo backup que inclua todas as cópias locais.

## Falhas e recuperação local

Antes de alterar várias chaves, o cliente guarda um diário cifrado de recuperação no namespace exato `mnemosyne:comms-identity-backup:v1:<UID-encoded>`. O diário v2 guarda cada cifra uma vez e usa referências por SHA-256 nos snapshots anterior/destino; evita duplicar 20 entradas grandes ao remover uma só. O leitor conserva suporte ao formato inicial v1.

As cópias históricas são instaladas antes do pedido e da primária; remoções correm depois. Cada valor é relido imediatamente. Quota, falha de escrita/leitura, perda de contexto ou alteração da base remota conservam o diário e as cifras necessárias. **Recuperar restauro ou retenção** continua o plano guardado após reload, sem outro UUID. **Reverter operação local** exige confirmação e repõe o snapshot anterior, recusando valores que já não correspondam ao plano. Nenhuma destas ações modifica a identidade publicada.

O mesmo Web Lock por UID protege publicação, troca e backup. Enquanto existe recuperação de backup, a publicação/troca e o carregamento de handles históricos são recusados. Conta, cofre, vista, ficheiro e eventos de armazenamento têm guardas durante os awaits e até à última alteração/download. Fechar a vista desmonta o controlador; mudança de conta/cofre retira o ficheiro e a prévia. A eliminação da conta limpa também o novo namespace exato, preservando outras contas.

## Purga confirmada do histórico

Depois de selecionar e verificar um ficheiro guardado, o painel lista apenas as entradas locais cujos UUIDs e cifras exatas estão nesse backup. O arquivo do pedido de troca ainda pendente fica protegido. É necessário escolher as entradas e confirmar a consequência: mensagens antigas podem exigir o backup e as palavras para voltar a abrir.

O cliente relê e verifica novamente o ficheiro antes de admitir a purga. Nunca remove a cifra primária ou o pedido pendente. A purga também tem um diário cifrado: pode continuar ou repor as entradas removidas se uma parte falhar. As chaves retiradas podem voltar a ser importadas como históricas. Remover uma cifra não revoga cópias externas, plaintext já lido ou handles que outros callers já receberam.

## Validação e limites

Os testes focados verificam RSA/AES reais, recuperação de mensagens e wraps de equipa, diários de troca v1/v2, retenção v3, checkpoint de backup v1/v2, tamanho/capacidade, contexto, quota/readback e reversão. Chromium verifica ficheiros guardados e selecionados, restauro numa instalação vazia depois de fechar a origem, pedido recuperado com gate fechado, purga/reimportação e falha da primária recuperada/revertida após reload. Auth, transporte RPC e base do executor são fronteiras sintéticas locais; não equivalem a um piloto real Firebase/dispositivo.

As contagens finais e a prova estão em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md). Não existem novos RPCs, rules, índices ou dependências neste incremento; os perfis, recibos e budgets remotos permanecem intactos durante as operações de backup. Gates continuam fechados. O rollout e o rollback têm de preservar leitores de histórico v3, diários de recuperação de backup v1/v2 e a sua limpeza por conta.

Este backup cobre identidades Comms e wraps que possam ser abertos por essas chaves. Não é um backup completo de Auth, Firestore, GCS, anexos, ciphertexts de mensagens P2P ou de todas as memórias. Não recupera uma chave já perdida que nunca foi guardada. Ensaios de cloud/restauro isolado, pilotos de plataformas e os restantes critérios das fases 0–6 continuam necessários antes do deploy completo autorizado. `wgftechnologies@gmail.com` está confirmado; ativação e entrega dos alertas continuam por verificar.
