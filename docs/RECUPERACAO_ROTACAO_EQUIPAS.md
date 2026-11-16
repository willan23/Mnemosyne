# Recuperação de rotação de equipas

Estado em 30 de setembro de 2026: implementação e validação locais. Não publicada. A escrita de equipa continua fechada; esta correção prepara a conclusão da fase 3.

## Problema

O botão Concluir rotação gerava uma nova AES e novos envelopes a cada tentativa. O servidor exige um retry idêntico depois de um commit; uma resposta perdida podia deixar o cliente sem saber qual chave tinha sido aceite. Também faltava impedir publicação tardia da chave na cache depois de mudar de conta ou bloquear o cofre.

Outra janela existia entre obter as chaves públicas dos membros e enviar os envelopes: uma mudança de identidade RSA nesse intervalo podia deixar um membro sem conseguir abrir a nova época.

## Decisão e fluxo

`completeTeamRotationWithRecovery` coordena o processo, usado pelo botão de Team Settings:

1. Exigir conta atual, cofre desbloqueado e lock exclusivo por equipa. Ler a equipa com `getDocFromServer`, recusando decisões com estado offline.
2. Se o servidor já indica época ativa e nenhum pedido pendente, desbloquear a chave ativa confirmada. Isto recupera uma resposta perdida, incluindo quando outro administrador ganhou a corrida. Nenhuma nova chave é gerada neste ramo.
3. Para um pedido pendente, confirmar owner/admin e membros atuais; carregar chaves públicas do servidor. Gerar AES e envelopes localmente e verificar que o envelope do próprio operador pode ser aberto.
4. Antes de enviar o commit, persistir um checkpoint cifrado com a chave pessoal do cofre. Guarda UID, equipa, pedido, época anterior, ID novo, membros, envelopes RSA e fingerprints das chaves públicas. **Não guarda AES em claro, mnemónica, chave privada ou token.** A AES proposta pode ser recuperada do envelope RSA do operador.
5. Uma nova tentativa abre o checkpoint e reutiliza exatamente o ID/envelopes/fingerprints anteriores. Mudanças de membros, pedido ou chaves públicas tornam o checkpoint obsoleto e interrompem o envio. Ciphertext inválido ou chave pessoal errada não são sobrescritos.
6. O servidor lê perfis públicos na mesma transação do commit e compara SHA-256 do PEM com os fingerprints. Uma alteração concorrente invalida a preparação. O fingerprint normaliza apenas CRLF e espaços externos; preserva maiúsculas/minúsculas do Base64.
7. Depois da resposta, reler a equipa do servidor, confirmar estado ativo, época e ID exatamente aceites, publicar a AES na cache e remover o checkpoint. Mudança de conta, cofre ou geração de cache interrompe a conclusão e conserva o checkpoint quando disponível.

O estado local é separado por UID/equipa e validado dentro do payload cifrado. As chaves do Storage local contêm estes identificadores de encaminhamento; não constituem anonimização. Não existe export/sincronização do checkpoint entre dispositivos. A escrita local é obrigatória antes do commit; falha de quota/armazenamento impede o envio. Se a limpeza local falhar depois de um commit confirmado, o servidor continua ativo e a interface oferece verificação novamente.

## Interface e operação

A interface mostra checkpoint pendente, permite verificar uma rotação que já aparece ativa e oferece Descartar checkpoint local com confirmação. Descartar não chama uma mutação de equipa nem repõe uma chave antiga; numa tentativa posterior, o coordenador consulta primeiro o estado atual do servidor. Esta ação serve também para checkpoint obsoleto ou ilegível. Não deve ser usada como mecanismo para reverter um commit.

Web Locks é obrigatório nesta implementação para coordenar a preparação e o descarte entre separadores. Ausência de suporte ou lock ocupado impede a operação. A UI apresenta mensagem específica para plataforma sem suporte. Não foi comprovada compatibilidade em Tauri, Capacitor ou dispositivos reais nesta etapa; esse ensaio continua pendente. As transações do servidor resolvem também concorrência entre administradores em dispositivos distintos.

Os erros de conclusão têm texto fixo na interface. `unlockMembershipTeamKeys` deixa de registar o objeto do erro de decifragem. A política de histórico aparece em quatro idiomas: antigas chaves/cópias não são apagadas pela remoção, novos membros podem não ter wraps antigos e a proteção criptográfica futura depende da chave nova.

## Schema e compatibilidade

- `commitTeamKeyRotation` exige agora `publicKeyFingerprints: {memberUid: sha256Hex}` para o conjunto exato de membros ativos, além dos campos existentes.
- `teams/{id}/keyEpochs/{newEpoch}` conserva esses fingerprints como metadados. Épocas antigas sem o campo continuam legíveis.
- Retries de um commit concluído exigem também os mesmos fingerprints; não alteram wraps ou chaves já aceites.
- Não há índice novo nem alteração de regras nesta etapa. As regras existentes continuam a negar escrituras de cliente nas épocas.
- Checkpoint local `mnemosyne:team-rotation-recovery:v1:<uid>:<teamId>` guarda somente o envelope pessoal `{v,iv,ct}`. Dados incompatíveis são conservados até descarte explícito.

Clientes antigos sem fingerprints deixam de conseguir confirmar rotações quando a nova Function for publicada. Publicar Function e frontend de forma coordenada, mantendo a escrita de equipa fechada durante a transição. Não existe backfill necessário para fingerprints históricos; só commits novos os exigem. Nenhuma rotação real foi pedida ou concluída por esta alteração.

## Garantias e limites

O teste criptográfico recupera a chave nova depois de uma falha de rede, prova que outro membro ativo a abre com a sua RSA e que a chave antiga mantida pelo membro removido não abre o conteúdo sintético da época nova. Prova também que uma cópia histórica continua legível com a chave antiga. Este teste é de cliente; **não é um teste de escrita de memória nova em produção**, pois a flag/regra de escrita permanece fechada.

Fingerprints comprovam correspondência com os perfis no instante do commit. O servidor não prova que o ciphertext RSA contém uma AES correta ou que um administrador autorizado não partilhou a chave. Uma mudança de identidade privada depois do commit pode comprometer disponibilidade; a recuperação depende do cofre/identidade do membro. Esta etapa não recifra memórias, versões ou anexos históricos e não revoga cópias externas.

## Correções encontradas no piloto de 3 e 4 de novembro de 2026

O primeiro percurso com uma conta nova chegou à função de publicação da identidade Comms e recebeu HTTP 400 `FAILED_PRECONDITION`. O pedido capturado passava o contrato e a implementação gravava os dois perfis quando executada fora do processo que emula as Functions. Nesse processo, o SDK é envolvido e o método `admin.firestore` perde a propriedade estática `FieldValue`. O código passou a importar `FieldValue` diretamente de `firebase-admin/firestore`. A reprodução da condição antiga falhou antes de gravar. A versão corrigida passou os 39 testes focados de identidade e equipas e publicou as duas identidades no navegador.

A criação da equipa passou no emulador, mas a lista ficou vazia. A leitura da equipa pelo ID funcionava para o proprietário e a consulta autenticada por `memberUids array-contains` devolvia `permission-denied`. A consulta tem de demonstrar que todos os resultados satisfazem a regra de acesso. A remoção da verificação explícita `is list` tornou a consulta compatível com `hasAny`. O mesmo ensaio recusou leituras de terceiros, consultas abertas ou mistas, um documento com mapa em vez de lista e contas anónimas ou eliminadas. A alternativa com `in` aceitou o mapa malformado e foi descartada. [Regras de segurança para consultas do Firestore](https://firebase.google.com/docs/firestore/security/rules-query)


A rotação revelou também uma corrida no rascunho de captura. A disponibilidade de uma chave no cache podia cancelar a leitura do rascunho enquanto a vista mantinha a mesma geração. O rascunho usa a cifra pessoal e confirma a autorização de equipa no servidor. A correção deixa a leitura prosseguir quando apenas chega uma chave ao cache. A troca de conta, a mudança do cofre e a invalidação do cache continuam a retirar a operação. O teste isolado reproduziu a falha e passou depois da correção, com 19 testes do rascunho aprovados.

A integração de eventos das duas cenas Three Fiber passa a ligar o ponteiro apenas a elementos ainda ligados ao documento. A primeira tentativa corrigiu a cena do Universo. A repetição localizou a mesma ligação tardia na página de entrada e a proteção passou a ser partilhada. O painel de recuperação da criação também foi movido para a zona de recuperação do Universo depois de um controlo visível ficar tapado. Passaram 42 testes focados e o build do espelho.

O piloto com duas contas terminou em 4 de novembro. O destinatário pediu a verificação de email pela aplicação e confirmou o link emitido pelo emulador. O proprietário criou a equipa, convidou o membro e criou a primeira memória. Após a remoção, a consulta do membro deixou de apresentar a memória, a leitura direta foi recusada e a escrita ficou suspensa até a época 2 estar ativa. A nova época tinha uma chave diferente, com um único envelope para o proprietário. O servidor recusou leitura e escrita ao ex-membro, e a chave antiga falhou ao decifrar a nova cifra AES-GCM com o contexto correto. A cópia cifrada anterior continuou legível com a chave antiga conservada em memória.

O ensaio aguardou 30 segundos após a rotação e ocultou ao navegador uma resposta de sucesso na gravação da época 2. O clique de recuperação confirmou o mesmo pedido, o proprietário leu a memória e a contagem final ficou em duas memórias, uma por época. A execução terminou sem exceções no navegador. Antes desta passagem, outras execuções registaram contenção de transações no Firestore emulado. Uma execução anterior recuperou pelo teclado quando o botão estava tapado. A falha de resposta no ensaio final exercita a recuperação de uma gravação já confirmada pelo servidor.


Um segundo piloto usou três perfis independentes. O proprietário promoveu o membro que permaneceu na equipa e removeu o terceiro. O administrador concluiu a rotação pela interface. A época 2 continha envelopes só para o proprietário e o administrador. Os dois abriram a nova memória em cofres distintos. O membro removido recebeu as mesmas recusas e a chave antiga voltou a falhar ao abrir a nova cifra. Nesta execução, a primeira gravação falhou no emulador. A recuperação por clique confirmou o pedido, com duas memórias no servidor e zero exceções no navegador.

Uma execução isolada do teste da conta eliminada devolveu um resultado diferente. A repetição no repositório passou sem alteração das Rules ou do teste. Outro ensaio confirmou 12 transições de conta ativa para eliminada. Em cada transição, após gravar o marcador, o servidor recusou tanto a consulta como a leitura direta. A primeira passagem geral das Rules terminou antes do resumo porque dois emuladores partilharam a pasta temporária de blobs. A repetição com armazenamento temporário separado passou os 326 testes das Functions e os 25 testes do frontend em emuladores, sem falhas ou omissões. Os emuladores encerraram normalmente.


O ensaio administrativo da migração legada identificou uma pendência distinta. Com dados sintéticos, o dry-run classificou cinco equipas como elegíveis. O apply no emulador criou épocas para uma equipa válida e para quatro que deviam ficar bloqueadas. Os quatro casos tinham um marcador de eliminação da equipa, do proprietário ou de um membro, ou o estado `deleting`. O migrador passou a verificar essas condições no inventário e na transação de ativação. Os resultados e o procedimento de execução estão na [decisão da fase 3](DECISOES_FASE3.md).


Um terceiro piloto manteve o membro removido offline, desde antes da remoção até depois da primeira gravação na época 2. A memória anterior permaneceu visível offline. Ao restabelecer a ligação, a equipa e essa memória saíram da interface sem recarregar a página. O ex-membro recebeu recusas de leitura e escrita no servidor. A chave da época 1 continuou a abrir a cópia histórica e falhou ao decifrar a memória nova. O proprietário e o administrador que permaneceu abriram a memória nova nos respetivos cofres. O Chromium terminou sem exceções. O ensaio ocultou uma resposta de sucesso da gravação da época 2 e devolveu um HTTP 400 sintético. A recuperação pela interface confirmou a gravação existente.

No Android API 36.1, um APK de diagnóstico abriu o cofre de uma conta sintética criada no Firebase emulado. O WebView disponibilizou Web Locks e Web Crypto. O APK usa um projeto sintético e acesso HTTP restrito ao loopback para chegar aos emuladores. A primeira execução do verificador esperou pelo texto de um botão que só tem rótulo acessível. A repetição verificou a seleção da lista pelo rótulo e pelo estado do botão. O ensaio completo com um APK de diagnóstico é descrito abaixo.

Num piloto com um instalador NSIS privado, o proprietário usou Chromium e os outros dois usaram perfis WebView2 independentes da aplicação Windows instalada. O administrador rodou a chave na aplicação Windows e abriu a memória da nova época. O outro membro ficou offline durante a remoção e a primeira gravação. Ao voltar a ligar-se, a equipa e o histórico desapareceram da interface sem recarregar. O servidor recusou acesso ao ex-membro e a chave conservada falhou a decifragem da nova memória. O piloto usou Firebase emulado, HTTP de loopback e um instalador de diagnóstico sem assinatura de distribuição. A primeira verificação comparou os hashes diretamente. A comparação byte a byte confirmou que o empacotador alterou só os três bytes do marcador NSIS do Tauri. A primeira execução terminou à espera de um clique no botão de rotação abaixo da área visível. A repetição deslocou o painel até ao botão e fez um clique de ponteiro. A instalação foi removida após o ensaio.

Dois ensaios no Android API 36.1 repetiram a rotação e a revogação com um APK de diagnóstico. Numa execução, o membro no Android ficou offline antes de ser removido. Ao restabelecer a ligação, a equipa e a memória antiga saíram da interface sem recarregar. Noutra, o administrador no Android rodou a chave e abriu a nova memória no cofre. Nos dois ensaios, o servidor recusou novas leituras e escritas ao ex-membro e a chave antiga falhou na nova cifra. O dispositivo virtual ficou em modo de avião. No ensaio do membro, o WebView alternou o acesso às portas locais dos emuladores. A primeira execução do administrador esperou pelo indicador do sistema. A repetição verificou a conectividade com um pedido ao emulador antes da rotação. A primeira tentativa parou antes da instalação porque o ADB acrescentava um carácter de fim de linha ao nome do dispositivo. A leitura do nome foi corrigida no verificador. O ensaio de atualização do APK assinado é descrito abaixo.

O APK e o AAB 1.0.9 foram compilados com o código de versão 9 e assinados com o certificado do APK 1.0.4. O Android aceitou a atualização do código 5 para o 9 num dispositivo virtual sem rede. A instalação conservou o UID, a data de instalação, o caminho dos dados privados e um ficheiro sintético no armazenamento externo específico da aplicação. O ecrã de entrada abriu e a seleção de português persistiu após reiniciar o 1.0.9. O ensaio não usou contas reais nem abriu um cofre preexistente. O APK verificado foi preparado nas pastas locais de downloads e o APK antigo foi guardado para reversão. O AAB está assinado para validação no Google Play. A aceitação do código de versão na loja, o teste num dispositivo físico e o deploy continuam pendentes.

## Rollback e próximos gates

Não restaurar época/chave antigas como ativas. Preservar checkpoints cifrados se retirar a UI. Manter as validações de membros, fingerprints e commit idempotente no servidor; um cliente sem suporte deve falhar, em vez de voltar a aceitar uma preparação antiga. Um membro com identidade/cofre válido pode desbloquear a época confirmada noutro cliente compatível.

Antes de abrir escrita de equipa, ainda validar o estado da migração administrativa no cutover e repetir o percurso de rotação nos clientes suportados. As ligações recíprocas com CAS/cifra/histórico foram implementadas e ensaiadas localmente em 1 de outubro: [LIGACOES_EQUIPAS.md](LIGACOES_EQUIPAS.md). A recifragem histórica paginada também foi implementada e ensaiada localmente: [RECIFRAGEM_HISTORICO_EQUIPAS.md](RECIFRAGEM_HISTORICO_EQUIPAS.md); ambas estão desativadas até validação do piloto. As regras/escritores/versões de época ativa e o tombstone do owner também estão implementados: [ESCRITA_E_VERSOES_EQUIPAS.md](ESCRITA_E_VERSOES_EQUIPAS.md). A criação atómica da época inicial, retry idempotente, checkpoint cifrado e cancelamento constam de [CRIACAO_EPOCA_INICIAL_EQUIPAS.md](CRIACAO_EPOCA_INICIAL_EQUIPAS.md). O [ensaio de restauro de outubro](ENSAIO_RESTAURO_FIRESTORE_2026-10-18.md) recuperou 359 documentos numa base temporária. A cópia atual para o cutover, a recuperação integral e os restantes critérios de lançamento continuam pendentes. Estes testes locais não comprovam o piloto em produção.
