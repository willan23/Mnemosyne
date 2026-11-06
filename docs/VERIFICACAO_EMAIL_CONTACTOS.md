# Email verificado na descoberta de contactos

## Alteração local de 17 de outubro de 2026

A descoberta de destinatários Comms por email, a procura por email no diretório de contactos aceites e a resolução dos convites de equipa exigem agora um registo Firebase Auth ativo, `emailVerified === true` e o mesmo endereço normalizado. O UID resolvido é revalidado pelo servidor. Um hash de email num perfil público não é autoridade para resolver essa identidade. A pesquisa explícita por UID mantém o seu contrato independente de email.

A definição de conta apresenta o endereço e permite pedir uma mensagem de verificação por ação explícita. Depois de confirmar o endereço, a ação de atualizar recarrega o utilizador e renova o ID token. As mensagens estão disponíveis em pt-PT, pt-BR, inglês e francês. Trocar de conta/endereço ou fechar o painel retira callbacks pendentes. Um pedido já admitido pelo fornecedor não pode ser recolhido pelo fecho da interface.

## Evidência e limites

Os 17 testes de serviço/painel verificam a sequência de atualização, recusa de conta/endereço substituídos, transições ABA, fecho e falhas. Chromium executa o painel e serviço reais com o SDK Firebase real ligado exclusivamente ao Auth Emulator do projeto `demo-mnemosyne-rules`: não há pedido automático; um painel fechado recusa o envio; a ação explícita cria um código no emulador; aplicar o código e atualizar confirma `email_verified` no token. Códigos, passwords e tokens não são registados no resultado.

O emulador não envia email. O ensaio não comprova entrega real, templates, domínios autorizados ou providers de produção. Usa a [API oficial do emulador para códigos de verificação](https://firebase.google.com/docs/reference/rest/auth); esses códigos só existem em memória durante o ensaio local.

O servidor e as regras têm testes adicionais de endereços não verificados, desativados, contraditórios ou resolvidos para outro UID. A admissão não oferece uma transação atómica entre Firebase Auth e Firestore nem cancela pedidos que já a ultrapassaram. A revisão operacional de convites/grants históricos continua exigida; o endurecimento da descoberta não recolhe chaves já partilhadas.

Este incremento não conclui a fase 3 ou 6. Os resultados gerais e os critérios ainda abertos estão em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md). Não houve envio real de email, deploy ou mutações em produção.

