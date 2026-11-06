# Avisos de cápsulas: confirmação pelo servidor

## Contrato implementado localmente

O cliente deixa de escrever diretamente `capsuleImportNotices/{id}`. A conclusão da importação no servidor continua a criar o aviso na mesma transação do contador da cápsula. A nova callable EU `acknowledgeCapsuleNotice` recebe apenas versão, UID do ator, ID do aviso e SHA-256 da origem capturada. Não recebe título, texto, chave, cifra ou lista de memórias.

O contrato puro `functions/src/capsuleNoticeContract.ts` é partilhado pelo cliente e servidor. Captura os campos escalares antes de operações assíncronas, valida identidades sem separadores de caminho, contagem inteira até ao máximo admitido pelo contrato backend de importação (**300**, conservado numa constante comum), data inteira positiva, booleano `read`, título opcional até 1.000 bytes UTF-8 e, quando presentes, `importId` igual ao ID e `planDigest` de 64 caracteres hexadecimais. O codec de packs mantém o seu limite de 150 itens. Não fabrica contagens/datas para origens malformadas e não apaga os documentos recusados.

A origem é a serialização JSON exata de versão/ID/proprietário/cápsula/importador/contagem/data/título e identificação do plano. Não normaliza Unicode nem remove espaços. `read`/`readAt` ficam fora do digest para permitir confirmar novamente a mesma origem depois de uma resposta perdida. **O hash não anonimiza estes metadados nem certifica a legitimidade de um evento legado.**

## Autoridade e repetição

O servidor liga o ator ao UID autenticado, consulta Auth de novo e recusa utilizadores ausentes, desativados ou com UID diferente. A admissão limita esta operação a 120 pedidos por minuto/UID, com contador no servidor; falhar a admissão recusa a operação. A callable tem limite de três instâncias e timeout de 30 segundos. Estes limites não substituem orçamento global, calibração de custos ou pilotos de plataforma.

Na transação, o servidor exige perfil existente, ausência de estado de eliminação e ausência do marcador permanente. Lê o aviso existente, confirma o proprietário e recompõe o digest da origem. Muda apenas `read: true` e `readAt` do servidor. Repetir depois de confirmar não reescreve a data; um aviso removido não é recriado. Avisos ausentes e de outro proprietário produzem o mesmo erro `not-found`. Uma origem alterada, perfil indisponível ou marcador de eliminação recusa o pedido. A consulta Auth e a transação Firestore são verificações separadas: não há garantia de atomicidade entre os dois serviços.

O campo `read` conserva a semântica anterior de **aviso colocado na fila de apresentação**. Não prova leitura humana. Uma resposta perdida pode ser repetida sem outra mutação do aviso. Se o pedido não chegou a confirmar, o documento continua por ler e outra subscrição/reload pode entregá-lo de novo; não se promete entrega visual exatamente uma vez. O estado do aviso é suficiente para repetir esta operação de metadata; não foi criado outro journal com conteúdo.

## Leituras, cache e conta

- As regras recusam **todas** as criações, atualizações e eliminações SDK deste tipo, incluindo escritas sem diferença. O proprietário mantém leitura direta. As listagens exigem proprietário e limite inteiro de 1–40; listas sem limite ou com 41 são recusadas.
- A consulta do cliente seleciona só avisos `read == false`, com limite 40. Os já confirmados deixam de ocupar a janela. Mudanças só de metadata são incluídas; cache e escritas locais pendentes não são tratadas como confirmação do servidor.
- A subscrição fica vinculada ao UID. Sign-out/troca de conta retira callbacks antigos, incluindo quando o mesmo UID regressa. O ACK captura a origem antes do hash, volta a verificar a conta/vista antes do RPC e verifica o ator/ID/digest da resposta.
- Os avisos de cápsulas na memória da UI recebem o UID de origem. O render oculta os de outra conta mesmo antes do callback Auth inicial; mudanças de conta limpam os toasts e desmontar retira callbacks. Este incremento não certifica os restantes tipos de notificação da aplicação.
- Falhas não imprimem objetos/diagnósticos SDK com metadata. Um ACK falhado não declara o aviso confirmado e conserva o estado no servidor.

## Verificação e limites operacionais

Resultados recolhidos em 18 de outubro:

| Verificação | Resultado e âmbito |
| --- | --- |
| Frontend geral final | **1.483 testes/188 ficheiros**, com o filtro de conta e o limite comum de 300; inclui os 13 novos testes de serviço/UI |
| Functions geral final | **464 aprovados/uma omissão** da suite que exige emulador; compilação atual, incluindo 11 testes novos do executor/contrato |
| Regras gerais | **262 Functions +23 frontend**, sem falhas/omissões, com as regras finais; foram executadas antes dos últimos ajustes do executor de ACK |
| Executor final no emulador | **Quatro casos focados**, após recompilar o executor com limite 300 e erro comum ausente/estrangeiro: matriz SDK/lista, concorrência/repetição, recusas e fronteira 300/301 |
| Build/lint | TypeScript/build aprovados; lint zero erros/23 avisos anteriores; permanecem avisos de chunks/imports mistos |
| Páginas públicas | Quatro smokes Chromium aprovados no build local, com `CI=1` e `BASE_URL=http://127.0.0.1:4173`, em pasta de resultados própria |
| Inventário SDK | AST de **296 fontes** não teste/declarativas: cinco admissões SDK e um candidato alcançável por imports, em `ShareView`; não prova execução ou cobertura de aliases/dependências externas |
| Gates | **45 em 24 fontes**, todos fechados |

As regras Firestore não mudaram entre a passagem geral e os quatro casos finais; os hashes são iguais. Os snapshots do executor/testes da passagem anterior foram conservados. A suite geral não foi repetida para os dois ajustes do executor: o limite de avisos passou de 150 para o máximo backend existente de 300, e avisos estrangeiros/ausentes passaram a partilhar `not-found`. Os quatro casos finais usam o executor recompilado. A suite frontend e a suite Functions finais usam o contrato corrigido.

Os testes cobrem captura da origem, Unicode, digest estável após ACK, identidade/contexto trocados, resposta ligada ao pedido, cache, confirmação só de metadata, escritas pendentes, conta ABA, vista retirada, montagem noutra conta, Auth/perfil/marcador/quota, origem alterada, aviso removido, tempo inválido e resposta perdida. O emulador usa Admin Firestore real e doubles de Auth/admissão; não confirma o transporte ou o ciclo Auth de produção. Os logs conservam as duas correções de lint no mock e a correção do limite, sem suprimir regras. Depois dos testes foi retirada uma linha vazia no fim do codec; a transpilação JavaScript antes/depois foi comparada e ficou idêntica. O aviso de linha vazia já existente em `firestore.rules` foi conservado, sem alterar o hash ensaiado.

O código, regras e testes estão em validação local. **Não houve deploy deste incremento, alteração de regras de `(default)` ou chamadas generativas.** O ensaio real de restauro Firestore anterior é documentado separadamente em [ENSAIO_RESTAURO_FIRESTORE_2026-10-18.md](ENSAIO_RESTAURO_FIRESTORE_2026-10-18.md).

Continuam necessários antes do rollout:

- Classificar avisos/metadados históricos e a sua proveniência. A confirmação de entrega de uma origem legada sintaticamente válida não prova que existiu uma importação legítima; não concede memórias, autoridade ou acesso a outra conta.
- Definir retenção/recuperação global e orçamento/frequência de leituras. Limitar cada query a 40 não limita a repetição de pedidos de leitura por um proprietário autenticado.
- Pilotar índices/query, transporte callable, ciclo Auth, clientes antigos e dispositivos nas configurações reais. Os doubles Auth e os emuladores locais não substituem esses pilotos.
- Concluir o restante corte SDK: continua a existir a escrita de aberturas em `ShareView`, além dos módulos antigos encontrados no inventário. Este incremento não conclui o corte global ou uma fase inteira.

Evidência em `W:/real/mnemosyne-launch-evidence/capsule-notice-validation-20261018/`; prova consolidada em `W:/real/mnemosyne-launch-evidence/capsule-notice-local-validation-20261018.json`. Todos os critérios das fases 0–6 continuam a preceder o deploy completo autorizado.
