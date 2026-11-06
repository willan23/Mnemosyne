# Publicação e gestão de cápsulas cifradas

## Estado e decisão

Implementação local de 18 de outubro de 2026. Os gates de publicação do cliente e servidor continuam fechados; a abertura depende do rollout global validado. A leitura e retirada são complementares ao [transporte público](CAPSULAS_PUBLICAS_SERVIDOR.md). Nenhuma configuração TTL, Function ou regra foi publicada neste incremento.

O painel da memória passa a abrir a partilha por cápsula. A cifra AES-GCM com chave derivada da passphrase por PBKDF2 é preparada no dispositivo; só a cifra, as referências/revisões autorizadas e a expiração chegam ao servidor. Não se enviam passphrase, texto ou título em claro. O modo de link com chave no fragmento continua opt-in e é apresentado como uma chave de leitura que pode ficar no histórico do navegador. Copiar o link pela gestão nunca inclui a chave.

A cápsula é uma cópia externa congelada. Uma mudança posterior da equipa, da chave ou do conteúdo original não recolhe cópias já recebidas. A interface explica essa limitação antes da publicação, incluindo o caso de memórias de equipa.

## Autoridade e expiração

`mutateCapsulePublication` recebe um comando fechado, ligado ao ator, a um UUID v4, à cifra, às fontes e à expiração fixa. O servidor consulta Auth e verifica perfil/marcador. Na publicação de uma nova cópia, verifica também todas as fontes na transação; consultar ou recuperar um recibo conhecido não volta a exigir que as fontes existam. Uma cápsula usa entre uma e 13 fontes do mesmo âmbito, conservando a capacidade anterior de uma memória e até 12 relacionadas.

- Fonte pessoal: pertence ao ator, não está eliminada ou ambígua e conserva um envelope pessoal válido sem texto/título em claro.
- Fonte de equipa: exige membro atual, equipa e proprietário ativos, ausência de eliminação/rotação pendente, época ativa e wrap do ator. O autor de cada fonte também é verificado contra os marcadores de conta.
- A revisão selecionada tem de corresponder à revisão atual de cada fonte. A autorização verifica essas referências; o servidor não consegue provar que o conteúdo cifrado corresponde exatamente ao texto de origem. O digest vincula o comando, sem certificar autoria ou veracidade do conteúdo.

O prazo máximo de um novo pedido é de 30 dias, com timestamp fixo. Relógios de dispositivo e plataformas continuam sujeitos ao piloto operacional. O codec de packs conserva os seus limites de importação; a leitura de uma cápsula grande não certifica que o conteúdo cabe nos limites de importação de cada memória.

## Repetição, cancelamento e recuperação

A confirmação cria, numa transação, o documento público cifrado, um recibo privado e o consumo de quota. Repetir o comando mantém nonce, cifra, digest e prazo e não volta a cobrar ou alterar a publicação. Uma origem retirada ou cujo documento desapareceu não é recriada enquanto o recibo existir. Depois de purgar o recibo na retenção prevista, a expiração original já impede o replay desse comando.

Os modos `status` e `cancel` continuam disponíveis com o gate de publicação fechado. Cancelar antes da confirmação cria um recibo terminal sem partilha. Se a publicação já foi confirmada, o servidor responde honestamente `committed`; a interface apresenta o link e orienta para a retirada. Não apresenta uma publicação confirmada como cancelada.

**O pedido completo fica apenas na memória da janela de partilha.** Não se guarda a passphrase ou um novo journal persistente. Enquanto a janela estiver aberta, uma resposta perdida pode ser repetida com o mesmo comando, consultada ou cancelada. Depois de recarregar/fechar, a gestão permite descobrir e retirar publicações confirmadas. Não recupera a passphrase ou um pedido ainda desconhecido do servidor. A aplicação não inicia publicações automaticamente ao abrir ou recarregar a interface. Esta decisão conserva a semântica anterior de passphrase fora do servidor; não deve ser descrita como uma fila durável de publicação.

## Gestão independente do cofre

`/capsules` consulta apenas metadata do proprietário, com Auth e marcador de conta válidos, sem exigir a chave do cofre. A consulta por ID e a paginação devolvem no máximo 40 linhas; o servidor pode ler uma 41.ª para determinar o cursor. A projeção da listagem exclui cifra, texto e título. Os dados antigos inválidos aparecem como desconhecidos, sem fabricar zeros ou disponibilidade do serviço.

A retirada usa versão 2, ator, ID e um token ligado à criação física do documento. Uma janela antiga não pode retirar um documento recriado com o mesmo ID. Mudanças nos contadores não invalidam esse token. Depois de uma recusa por origem desatualizada, a interface pede para atualizar a lista. Repetir uma retirada confirmada não reescreve a data nem apaga a cifra.

As regras recusam **todas** as leituras e mutações SDK de `shares`, incluindo do proprietário; consulta e mutações passam pelo servidor. Recibos e orçamentos permanecem privados. A eliminação de uma memória primária ou secundária remove a árvore da cápsula; a eliminação da conta inclui os novos recibos e orçamentos.

## Quotas e retenção preparada

- Por conta/dia: 40 novas operações de publicação/cancelamento, 20 publicações e 10 MiB da representação JSON da cifra. Recuperar recibos já conhecidos não volta a consumir quota.
- Gestão: 200 consultas por conta/dia, com rate limit adicional. Não é um orçamento global monetário ou de tráfego.
- Orçamentos diários: Timestamp de expiração no início do terceiro dia seguinte ao identificador diário.
- Recibo de publicação: Timestamp no prazo original da cápsula mais um dia.
- Documento da cápsula: `retireAt` no prazo original mais dois dias; os recibos de abertura têm a retenção própria documentada no transporte público.

As políticas TTL estão preparadas em `firestore.indexes.json`, com os campos de retenção sem índices. **Não foram aplicadas em produção.** TTL é assíncrono; a validação do prazo e a autorização não dependem de uma eliminação imediata. A calibração de custos, aplicação/readback das políticas e alertas continuam necessários.

## Validação e limites

Os logs locais distinguem suites gerais, testes focados, emulador e Chromium. `scripts/capsule-publication-browser.cjs` usa componentes/fábricas reais, wrappers callable reais e WebCrypto real, com Auth e armazenamento sintéticos. Cobre payload grande, resposta perdida, uma publicação/quota, gestão após recarga com cofre bloqueado, leitura/decifragem pública, token de origem desatualizado, atualização e retirada sem apagar a cifra/recibo. O diálogo nativo é ensaiado com fundo inativo, ciclo Tab/Shift+Tab e Escape/restauro do foco. O teste de Firestore real fica separado no emulador; não se declara aceitação em dispositivos, WebViews ou leitor de ecrã.

O CI inclui o novo ensaio depois do build dos estilos; YAML local não comprova execução remota protegida. As restantes áreas das fases 0–6 e a aceitação integral continuam exigidas antes do deploy completo autorizado.
