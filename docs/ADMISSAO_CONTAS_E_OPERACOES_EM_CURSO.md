# Contas, login desktop e operações em curso — 2 de outubro de 2026

## Estado

Implementação local de verificações de conta ativa nos percursos abaixo. **Não conclui todas as fases, não abre os gates de escrita e não autoriza antecipar o deploy condicionado à conclusão das áreas.** Nenhum token real foi emitido, nenhuma chave real foi criada e nenhum fornecedor externo foi chamado nesta validação. Os testes usam identidades e respostas sintéticas.

## Autoridade de revogação

`accountAccess.ts` lê perfil e `accountDeletions/{uid}` numa transação. O marcador permanente prevalece mesmo se um perfil antigo permanecer ou for restaurado por engano. Contas sem perfil são recusadas nos pedidos de IA, utilização, API/MCP e chaves. O login desktop admite perfil ainda ausente na criação de uma conta, mas exige confirmação independente da existência e estado da identidade em Firebase Auth, além de recusar marcador ou perfil `deleting`.

`withLiveAccount` verifica a conta antes e depois da operação externa. Os handlers de geração verificam novamente depois de registar o circuit breaker e antes da resposta. Um resultado revogado é descartado com erro fixo, sem conteúdo. **Um pedido já enviado ao fornecedor não pode ser recolhido:** os checks reduzem janelas de concorrência, sem constituir uma transação distribuída com terceiros. Reservas de budget continuam cobradas quando a operação já foi admitida e falha; a recuperação não atribui crédito inventado.

Pesquisa verifica as fronteiras de pesquisa e leitura de fontes. Geração de texto/imagem recusa contas indisponíveis antes de contactar o fornecedor. Uma revogação não é registada como avaria do fornecedor; uma lease de prova é libertada sem fechar ou penalizar o circuito por esse motivo.

## Login desktop

O pedido estrito contém só `bridgeId`. O servidor valida o UUID e o UID, recusa substituir o bridge de outra conta, e conserva o prazo original de três minutos nas repetições. Depois da consulta Auth e da emissão do custom token volta a verificar a conta e o nonce na transação de publicação. Um token produzido entretanto para uma conta fechada não é persistido nem devolvido.

O resgate confirma a identidade Auth e consome o bridge na mesma transação que observa a conta. Cria `desktopAuthBridgeReceipts/{bridgeId}` com apenas `{v,status:'consumed',consumedAt}` e remove o bridge. Dois polls concorrentes não recebem ambos o token. O recibo permanente impede reutilizar o mesmo UUID para outro login; rules recusam acesso e alterações pelo cliente.

Esta garantia diz respeito à entrega pelo bridge, não a uma promessa adicional sobre utilização ou prazo de tokens Firebase já entregues. Perder o ACK do resgate exige iniciar outro login com novo UUID. Ainda falta piloto desktop/Auth real, validação de retenção/custo dos recibos e cobertura de troca de conta no frontend.

## Quotas e chaves de API

O budget mensal lê perfil e marcador na mesma transação que cobra. Perfis ausentes, em eliminação ou revogados não recriam budgets após a limpeza. Contadores negativos, fracionários, não finitos ou fora dos inteiros seguros são recusados. O ID legado de budget continua existente; quando duas sanitizações colidem, um UID diferente do guardado é recusado, sem alterar a quota do outro. A migração desses IDs continua pendente.

Rate limits autenticados usam SHA-256 da chave completa para separar UIDs que a sanitização antiga confundia. Guardam a chave completa `uid:<uid>` como metadado de remoção, sem bearer token. A transação observa o marcador antes de escrever. A janela anterior só é migrada quando a sanitização antiga era integral e o dono corresponde; IDs legados ambíguos exigem inventário. IPs mantêm o formato anterior.

Criar, listar, revogar, validar e atualizar o uso de chaves de API respeitam a conta ativa. A criação lê a lista e incrementa `users/{uid}.apiKeyRevision` na mesma transação, serializando o limite de dez chaves ativas mesmo quando a primeira lista está vazia. A chave em claro é devolvida uma vez; o registo contém hash e metadados. Uma lista com cinquenta registos exige revisão antes de criar mais, para não inferir ausência de chaves ativas além da página. O painel e a migração desse inventário ainda precisam de revisão.

Sessões delegadas, consentimento/troca/revogação OAuth, alteração do estado de acesso de agentes, recibos de utilização e ledger recusam o marcador. A revogação de um grant não cria eventos sob um perfil removido. Leituras de memória da API/MCP verificam a conta antes e depois de preparar o resultado; o erro REST tardio é `403 account_unavailable`, sem conteúdo. Escritas API continuam fechadas até o percurso de aprovação no cliente estar concluído.

## Reset mensal

O job deixa de fazer `batch.set(..., merge:true)` a partir de snapshots antigos, que podia recriar um perfil. Cada UID é revalidado numa transação e apenas uma utilização de período anterior é posta a zero. Utilização já contabilizada no mês UTC atual e períodos futuros são conservados. Campos adicionais da utilização são preservados.

O scan ordena IDs de documento, com páginas de cem e grupos de dez operações concorrentes. Avança também sobre perfis sem alterações ou fechados. O limite de quinhentas páginas significa cinquenta mil perfis por execução; uma página além desse limite é verificada e o job reporta erro se a passagem estiver incompleta. Falha ou timeout não apaga cobranças do mês atual, mas a operação em grande escala e a retoma persistente precisam de piloto.

## Purge de equipa

Uma repetição do pedido de purge de órfão volta a exigir pertença atual e wrap, mesmo quando o estado `pending` já foi guardado. Uma equipa em eliminação também recusa esse pedido normal. Os workers de remoção confirmada conservam o protocolo de lease, geração, ausência de objetos e libertação única de quota.

## Destinatários, partilhas e filhos

As rules recusam criar transmissões, pedidos de contacto ou salas P2P para um UID com marcador. Leitura/alteração dos registos existentes e novos candidatos P2P também observam os dois participantes. Uma sala removida não autoriza criar filhos. Avisos de importação exigem cápsula cifrada existente, dono correspondente e sem marcador. Acesso público/incrementos da cápsula cessam com o marcador do dono. Callbacks de estatísticas verificam caller e dono na transação do incremento e não recriam a cápsula removida.

Na fase `documents` da eliminação, a remoção de membership e o pedido de rotação precedem a enumeração/remoção das memórias do UID. Um teste começa por aceitar a escrita com arquivo por outro membro, suspende a eliminação depois da remoção efetiva, confirma que essa mesma escrita deixa de ser permitida durante a rotação e só então permite a limpeza dos filhos. A equipa de outro dono permanece com os membros restantes.

Leitura de anexos legados verifica também o autor da memória. Leitura cifrada verifica caller, autor e uploader. Reserva, publicação depois do signer, recuperação e criação com anexos observam o marcador da conta. Novas associações/criações verificam o uploader dos ficheiros referenciados. Remover membros e aguardar eliminação de objetos não permite emitir novos grants para esses percursos.

## Verificação e limites abertos

### Convites e épocas — incremento mais recente

Foi corrigida a corrida que etiquetava um envelope preparado antes da rotação com a época lida depois. Convites novos exigem UID esperado, época/keyId e UID/fingerprint do destinatário, com revalidação transacional de conta, membership, identidade e auditoria. Aceitar um convite verifica autor/owner/destinatário e atualiza também os fingerprints da época. O cliente observa mudanças de conta/cofre/contexto entre awaits e guarda a chave aceite na época correta. Criação/cancelamento e commit de rotação também observam o marcador permanente. Decisão e limites: [CONVITES_E_EPOCAS_DE_EQUIPA.md](CONVITES_E_EPOCAS_DE_EQUIPA.md).

Evidência deste incremento:

- **80 testes Functions + 22 frontend** aprovados na suite completa com Firestore/Storage reais no emulador, sem skips; saída zero. Inclui concorrência de convites, falha de auditoria com rollback, marcadores durante lookup/aceitação e commit de rotação. Log `%TEMP%/mnemosyne-team-invite-rules.log`.
- **17 testes frontend focados** aprovados (serviço de convites/aceitação e TeamSettings), build web aprovado e ESLint dos ficheiros frontend alterados sem mensagens. Logs `%TEMP%/mnemosyne-team-invite-frontend.log`, `mnemosyne-team-invite-build.log` e `mnemosyne-team-invite-lint.log`.
- Depois da suite completa foi retirado o fallback de resolução Auth para `publicProfiles.emailHash`. A falha/identidade desativada recusa o lookup e o convite. A revisão final passou **125 unitários Functions** (uma suite de rules ignorada nessa execução por falta de emulador) e **os três testes focados de convites no emulador**. Não se afirma que a suite completa tenha sido repetida depois desse ajuste. Logs `%TEMP%/mnemosyne-team-invite-unit.log` e `mnemosyne-team-invite-auth-rules.log`.
- Build TypeScript Functions e verificação de whitespace dos ficheiros alterados aprovados. Node 22.23.3, JBR 21.0.6 e projeto `demo-mnemosyne-rules`. Todos os processos/emuladores terminaram. Nenhuma consulta Auth real, dado real ou configuração de produção foi usado nesse teste.

Os blocos seguintes conservam a cronologia da validação anterior.

### Pedidos/notificações de rotação — revisão final deste turno

Pedidos normais verificam a conta mesmo antes de ACK de recibo existente. A autoridade interna de limpeza exige marcador v1 em `deleting/documents`, só saída do próprio UID e sem idempotency key. Scheduler tem autoridade interna separada; não basta um UID literal `system`. Pedido/supervisão observam destinatários antes de escrever; admins revogados não recebem notificações, owner revogado/equipa em eliminação impede novos registos. Colisão na auditoria reverte equipa, rotação, notificações e recibo. Membership cleanup conserva equipas próprias inesperadas em vez de apagar só o pai, e só corre na fase `documents`.

A revisão final passou **126 unitários Functions**, **quatro casos focados no emulador** (novos pedidos/supervisão, saída interna e fase, a eliminação real com congelamento de writes e o convite através de rotação) e **um caso adicional no emulador** que confirmou remoção, rekey, repetição de recibo e scheduler positivo em equipa legada. Todos tiveram saída zero, sem skips nos testes focados. Logs `%TEMP%/mnemosyne-team-rotation-admission-unit.log`, `mnemosyne-team-rotation-admission-rules.log` e `mnemosyne-team-rotation-scheduler-rules.log`. A última suite completa permanece a de **80 + 22** acima; não se afirma execução completa dos dois casos adicionados depois dela. Testes frontend/build/lint não foram repetidos nesta revisão exclusiva do backend. Todos os emuladores terminaram.

Incremento de papéis: alteração do papel e evento de auditoria são agora atómicos e observam marcador/estado de owner e alvo, além de equipa em eliminação. Alterações concorrentes de dois membros preservam ambos os papéis; colisão do evento não deixa a equipa alterada; IDs de equipa/alvo não aceitam caminhos. Perfis legados ainda ausentes podem existir nesse helper, mas não ultrapassam o marcador permanente nem a autorização de owner na equipa. Essa compatibilidade não substitui a migração de contas legadas.

Depois da suite completa abaixo foi executado **um teste adicional focado no emulador real**, que provou concorrência, rollback do evento e recusa de alvos/owner revogados; saída zero. A execução completa de Functions voltou a passar **122 unitários**. Não se soma este caso ao total da última suite completa como se os 77 casos tivessem sido corridos juntos. Log: `%TEMP%/mnemosyne-team-role-rules.log`.

Validação final: **122 testes unitários Functions aprovados** (a suite de rules foi ignorada nessa execução por ausência de emulador), **76 testes Functions e 22 frontend aprovados nos emuladores reais de Firestore/Storage**, build TypeScript Functions e verificação de whitespace dos ficheiros alterados. Todos terminaram com saída zero. Builds/testes usam Node 22.23.3 e o emulador usa JBR 21.0.6; nenhum emulador aponta para produção.

Uma primeira execução unitária encontrou um mock do ledger sem a API de leitura de perfil/marcador. O fixture foi corrigido para representar ambos e passou a testar também um marcador com perfil ainda existente; a execução completa final passou. As respostas esperadas `PERMISSION_DENIED` dos testes negativos e mensagens de limite de expressões em pedidos inválidos não foram suprimidas. Os casos positivos completos, incluindo ligações de equipa e queries, passaram; não se declara perfil de custo/expressões de produção.

Logs locais finais: `%TEMP%/mnemosyne-account-final-unit.log` e `%TEMP%/mnemosyne-account-final-rules.log`. Executar os mesmos comandos sobre produção não faz parte desta evidência. A suite geral de frontend/build/lint permaneceu na evidência do bloco anterior; neste incremento voltou a correr a suite de rules frontend. Não foram executados smokes nativos nem pilotos de Auth/GCS/Stripe reais.

Ainda faltam outros escritores de equipas e o deleteTeam normal, atualmente sem protocolo equivalente de objetos/filhos; inventário de metadados de equipas que referenciam o UID; política e migração dos ficheiros de um uploader que sai de uma equipa de outro dono, incluindo referências de outros autores; recuperação ACK/Auth da eliminação; migração de órfãos e IDs legados; GCS/Stripe/Auth isolados; retenção/restauração; plataformas. Ver [ELIMINACAO_ANEXOS_E_CONTAS.md](ELIMINACAO_ANEXOS_E_CONTAS.md) e o prompt mestre para o restante das fases 0–6. A proteção dos percursos testados não prova o encerramento de todos os escritores do produto.

A corrida de época dos convites e as guardas do cliente foram corrigidas e testadas no incremento acima. O gate de equipa permanece fechado até concluir os restantes critérios de migração, recuperação, dispositivos e revogação real.
