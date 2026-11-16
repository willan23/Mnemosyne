# Recuperação da eliminação de conta sem sessão — 3 de outubro de 2026

## Problema e garantia

O servidor pode eliminar Auth e concluir a conta enquanto o cliente perde a resposta final. Também pode parar depois de eliminar Auth e antes de persistir `complete`. A ausência de sessão continua a não constituir prova de conclusão.

Este incremento acrescenta dois percursos:

- Um comprovativo do dispositivo permite consultar o estado do mesmo pedido sem autenticação. A consulta não inicia nem retoma eliminação remota.
- Um worker privado termina exclusivamente pedidos duráveis que já chegaram à fase `auth`, depois de expirar o lease. Não executa as fases anteriores nem cria pedidos.

Os gates de novas eliminações continuam fechados. A implementação local não substitui o piloto de Auth, Storage, billing, retenção e dispositivos.

## Comprovativo e compatibilidade

Antes do primeiro pedido confirmado, o cliente gera 32 bytes com `crypto.getRandomValues`, representa-os em 64 caracteres hexadecimais e grava/relê o checkpoint `v:2`. Este contém somente UID, estado e comprovativo. A chave de armazenamento anterior é conservada para descobrir os journals existentes.

`deleteUserAccount` continua autenticado e ligado ao UID originalmente confirmado. Aceita `{uid}` dos clientes anteriores ou `{uid,recoveryToken}` do cliente novo. O digest SHA-256 inclui finalidade, versão, UID e comprovativo. Só o digest fica no marcador privado `accountDeletions/{uid}`; o comprovativo em claro não é armazenado no servidor nem emitido em logs por este código.

A gravação do digest é atómica com o pedido durável. Um pedido já em curso pode registar o dispositivo sem alterar o worker/lease atual. Conserva até oito digests distintos; repetir o mesmo não consome outra entrada. Atingir o limite recusa outro comprovativo, mantendo os anteriores. Não há rotação que invalide silenciosamente outros dispositivos.

Checkpoints `v:1` continuam legíveis. Uma repetição autenticada pendente acrescenta o comprovativo antes do RPC. Um `v:1` pendente que já perdeu Auth permanece conservado para suporte: não se fabrica prova. Um `remote-complete` antigo continua a permitir a limpeza local já autorizada.

## Consulta sem sessão

`getAccountDeletionRecoveryStatus` aceita exclusivamente `{uid,recoveryToken}` e devolve somente `{uid,status,retryAt}`. Não devolve fase interna, memórias, nomes, identidade Auth, wraps, billing ou objetos. A comparação de cada digest usa `timingSafeEqual`.

Pedido ausente, sem comprovativo, comprovativo errado ou lista de digests inválida devolvem a mesma recusa. Erro de fornecedor não é transformado em `complete`. A resposta `unknown` não faz parte deste contrato.

O endpoint limita a 20 tentativas por minuto antes de consultar o marcador. Usa apenas o IP da plataforma, nunca `X-Forwarded-For` enviado pelo cliente. Guarda um digest do IP no rate limit, sem IP em claro neste percurso. O digest é um identificador pseudónimo, sem alegação de anonimização. Uma conta revogada não é usada como chave de rate limit desta consulta.

O comprovativo é enviado no corpo do callable, sem URL ou query string. Não é uma chave do cofre, nem autoriza operações de eliminação, acesso a ficheiros ou recriação da conta. Um script que comprometa a mesma origem pode ler o armazenamento local; essa ameaça continua a exigir proteção da aplicação e revisão de telemetria. O comprovativo só dá acesso ao estado do pedido correspondente.

## Limpeza local e UI

A página `/account-deletion` oferece **Verificar conclusão do pedido** quando a sessão desaparece e existe um checkpoint `v:2` pendente. A consulta só acontece pela ação do utilizador. Uma resposta pendente/recusada/malformada mantém o comprovativo e os dados locais.

Uma conclusão válida e ligada ao mesmo UID/comprovativo é persistida como `remote-complete` antes da limpeza. Falhar essa gravação não permite limpar. Falhar a limpeza conserva a conclusão para repetição offline. O serviço revalida o comprovativo após o RPC, para não consumir uma resposta de um journal entretanto substituído.

A limpeza limita-se aos dados atribuíveis ao UID. Qualquer conta ativa diferente, incluindo entrar nessa conta e sair enquanto a resposta está em curso, interrompe a operação. A UI rejeita resultados tardios após troca de sessão ou desmontagem; não termina a sessão de outra conta. PIN/WebAuthn antigos sem binding não são atribuídos por suposição quando Auth está ausente.

Se o armazenamento recusar a enumeração, não se anuncia uma conclusão nem se inicia recuperação. Não há uso de `localStorage.clear()`.

## Worker da última fase

`repairAccountDeletionAuth` está preparado para execução a cada cinco minutos em `europe-west1`. Usa o mesmo lease de dez minutos para uma Function limitada a nove, com um lease próprio para excluir scans simultâneos.

O worker lê apenas marcadores com `phase:auth`; exige estado `deleting`, UID e lease válidos. A aquisição por conta revalida a fase dentro da transação. Uma mudança de fase, lease ativo, pedido inexistente ou esquema inválido não autoriza início de eliminação. `auth/user-not-found` confirma uma repetição após a perda do ACK de Auth. O perfil só é removido após os filhos; `complete` é persistido por último.

Cada execução limita-se a 200 marcadores e 20 tentativas. Um cursor privado, gravado antes da tentativa, progride também após falhas e leases ocupados. Ao acabar o scan, regressa ao início para repetir pendências. Se a Function parar, o lease expira; a conta conserva o seu pedido e volta a ser encontrada num ciclo seguinte. Este cursor pode conter temporariamente um UID e não é uma prova anónima.

`maintenanceCursors` e `accountDeletions` negam todo o acesso direto dos clientes. Não há TTL que reabra contas. `recoveryHashes` tem indexação desativada na configuração local. O worker emite somente contagens e suprime erros brutos de fornecedores; não emite UID, comprovativo ou cursor. A leitura por fase/ID usa o índice simples de `phase`, cuja configuração efetiva deve ser verificada no rollout.

## Publicação, rollback e trabalho restante

Publicar primeiro Functions, regras e configuração de índices compatíveis; depois os clientes que gravam `v:2`. Não abrir o gate da eliminação com base apenas nestes testes. O formato `{uid}` anterior permanece aceite para pedidos já autorizados.

Fechar pedidos novos conserva a recuperação autenticada, a consulta por comprovativo e a reparação final de pedidos já persistidos. Um rollback do cliente deve conservar os journals `v:2`; clientes antigos não os reconhecem. O suporte deve proteger o comprovativo e não o solicitar em email, logs ou capturas.

Ainda faltam o ensaio isolado com Auth/GCS/Stripe reais, perda de rede e reload em web/Tauri/Android, a configuração de App Check por cliente e a política de retenção dos marcadores/digests. Este comprovativo não prova expiração de backups, soft delete ou cópias externas.

## Evidência

- **140 unitários Functions passaram**, com build TypeScript e importação real do entrypoint. A suite de regras fica em skip nesse comando sem emulador.
- **104 Functions +22 frontend passaram na suite completa de Firestore/Storage Emulator** da revisão final, saída zero. A primeira execução de 103 +22 precedeu o cursor privado; a execução final inclui o cursor e a recusa de leitura/escrita/remoção pelos clientes.
- **21 testes frontend focados passaram**: journal antes do RPC, perda de ACK/Auth, comprovativo antigo/malformado/alterado, resposta pendente/recusada/UID diferente, mudança de sessão, falha local, upgrade de journal e UI sem anúncio prematuro.
- **Build web final passou**, com os avisos conhecidos de chunks grandes; **lint dos quatro ficheiros frontend alterados passou sem erros/avisos**. A suite geral frontend anterior não foi repetida neste incremento.
- JSON dos índices, whitespace dos ficheiros novos/alterados deste escopo e `git diff --check` de regras/índices/entrypoint passaram. Não se declara o repositório inteiro limpo.
- Logs em `%TEMP%`: `mnemosyne-account-receipt-functions-unit-final.log`, `mnemosyne-account-receipt-rules-final.log`, `mnemosyne-account-receipt-client-final.log`, `mnemosyne-account-receipt-web-build-final.log`. Todos os processos terminaram; os emuladores encerraram normalmente.

Os testes usam exclusivamente o projeto `demo-mnemosyne-rules` e adapters sintéticos para Auth, Storage e billing. Nenhuma configuração, utilizador ou dado de produção foi alterado por este incremento. As limitações de plataforma/retention e os critérios globais mantêm-se em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).
