# Publicação de identidade Comms pelo servidor

## Decisão de 16 de outubro de 2026

A publicação inicial e a confirmação da identidade deixam de usar transações Firestore no cliente. `publishCommsIdentityKey`, em `europe-west1`, recebe apenas versão, ator capturado, chave pública e intenção `check`/`publish`. O servidor compara o ator com o UID autenticado antes de consultar Auth/Firestore. Chaves privadas, JWK privado, mnemónica, email e nome do cliente não fazem parte do pedido.

O âmbito desta alteração é a raiz de `users/{uid}` e `publicProfiles/{uid}`. A raiz do utilizador passa a recusar todas as criações/alterações SDK, incluindo escritas sem diferença de campos; o perfil público também recusa criar/alterar/apagar por SDK. A leitura própria e as regras de subcoleções mantêm os seus contratos. As alterações de plano/uso, eliminação e rotação continuam nos respetivos serviços Admin. Clientes antigos que publicavam diretamente deixam de funcionar com estas regras: o rollout exige publicar primeiro a callable e depois coordenar regras e clientes atuais.

## Contrato e admissão

| Entrada/resultado | Semântica |
| --- | --- |
| Pedido v1 | `actorUid`, `publicKeyPem`, `mode`; campos extra recusados |
| `check` | Lê a identidade atual; não cria/repara/atualiza os perfis |
| `publish` | Pode inicializar/reparar o par ou atualizar a metadata quando a admissão do servidor está aberta |
| `current` | Ambos os perfis ligam o UID à mesma chave pedida |
| `unpublished` | Falta um par completo; não autoriza devolver o handle privado ao chamador |
| Confirmação v1 | UID, SHA-256 exato da chave, estado e `changed` relativo aos perfis |

Há interruptores explícitos `COMMS_IDENTITY_PUBLICATION_ENABLED` no cliente e servidor. Ambos permanecem `false`. O cliente fechado só envia `check`. O servidor fechado não publica nem repara mesmo que receba `publish`; pode confirmar um par já existente. Isso conserva a leitura de identidades atuais durante a preparação do rollout. Não se usa um fallback SDK.

A callable mantém o limite comum de 30 pedidos por UID/minuto. Os contadores operacionais desse limite são atualizados também em confirmações; `changed: false` não significa ausência de todos os efeitos operacionais do pedido. A quota global e a calibração operacional do programa completo continuam pendentes.

O servidor revalida a existência/estado da conta em Firebase Auth e, dentro da transação, o marcador permanente de eliminação e o estado `deleting`. O primeiro bootstrap pode criar a raiz própria ausente, mas nunca ultrapassa um marcador de eliminação. Uma conta Auth inexistente/desativada ou um UID explícito contraditório em qualquer perfil recusa a operação. Esta admissão não cancela retroativamente pedidos que já passaram as verificações de Auth.

## Chaves, pares e recuperação

A chave tem de ser SPKI PEM canónico, RSA de 2048 a 4096 bits, expoente 65537 e até 2000 caracteres. O servidor valida a chave real com `createPublicKey`. Um valor anterior não nulo diferente em qualquer perfil recusa a publicação, mesmo quando a outra metade falta. Substituir a identidade continua exclusivamente no protocolo de rotação com base capturada e arquivos cifrados.

A transação lê ambos os perfis e o marcador antes de escrever. O primeiro bootstrap/reparo guarda a mesma chave e timestamp de publicação nos dois perfis, preservando campos existentes por merge. Um refresh de nome/hash usa o registo Auth obtido pelo servidor e não altera os timestamps da chave. O email hash mantém a normalização anterior de espaços/maiúsculas; não é um hash de bytes de chave. Nomes e hashes de email não provam identidade pessoal. A descoberta Comms por email, a pesquisa do diretório e a resolução dos convites de equipa exigem agora emailVerified verdadeiro e endereço normalizado correspondente no registo Auth, incluindo revalidação do UID. A pesquisa por UID continua independente da posse de um email. A revisão operacional dos convites/grants históricos e da visibilidade continua pendente.

Sem alterações, repetir a mesma chave não reescreve os perfis. Depois de uma resposta perdida, o cliente volta a abrir a mesma identidade cifrada local e confirma a chave atual; não gera automaticamente outra chave nem apaga a anterior. Uma chave remota mais recente produz conflito e conserva a chave privada local para recuperação explícita. A confirmação descreve o estado atual; não é um recibo histórico de uma operação com UUID, nem permite restaurar automaticamente uma chave antiga sobre uma rotação posterior.

O cliente captura UID/mnemónica e os três campos da identidade antes dos awaits seguintes. Devolve um objeto imutável com os mesmos handles CryptoKey apenas depois de validar UID/fingerprint/estado da resposta e o contexto do chamador. Trocas de conta/cofre, fecho e recuperação pendente invalidam o percurso. Os fingerprints usam SHA-256 dos bytes exatos do PEM; o helper anterior de email normalizava maiúsculas/espaços e não serve para esse fim.

## Validação e rollout

As passagens finais de 431 testes Functions (uma omissão fora do emulador), 1.428 testes frontend e regras 251 Functions +23 frontend passaram. O ensaio de Chromium encontrou a diferença de normalização do fingerprint e passou depois da correção. Usa RSA, cofre AES local, reload e Web Locks reais com a factory do cliente e o executor do servidor, mas Auth/Firestore transacional do ensaio são sintéticos. A atomicidade/concorrência Firestore e as negações SDK são verificadas separadamente no emulador demo. Os resultados finais, incluindo o âmbito de cada passagem geral/focada, são consolidados em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

Não houve alteração de conta ou dados de produção, deploy ou chamada a fornecedor generativo. Antes de abrir os gates são necessários ensaios com clientes/dispositivos reais, migração dos registos recusados e publicação coordenada. Rollback pode retirar a UI ou voltar a fechar os gates, conservando confirmações existentes e as negações SDK nas raízes. Não restaurar as regras antigas de publicação direta. A conclusão deste contrato não conclui a fase 3, a fase 6 ou o programa completo.


