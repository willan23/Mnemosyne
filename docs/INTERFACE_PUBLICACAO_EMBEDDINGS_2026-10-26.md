# Publicação, histórico e recuperação de embeddings — 26 de outubro de 2026

Continuação no mesmo dia: o [padrão multilingue para novas memórias](MODELO_MULTILINGUE_PADRAO_2026-10-26.md) foi implementado depois desta etapa. As referências ao modelo global ainda pendente abaixo descrevem o âmbito da prova da interface; a migração de dados existentes e os critérios operacionais continuam exigidos.

A secção IA das Definições liga agora o protocolo de publicação ao painel `EmbeddingPublicationPanel`. Preparar os vetores e ativar a pesquisa neste dispositivo continuam no painel anterior. A publicação de novos vetores e o rollback remoto exigem o gate de revisões pessoais, que permanece fechado no produto. Abrir as Definições não inicia inferência, consultas de histórico ou publicação.

## Rever e publicar um lote

O painel considera apenas memórias pessoais cifradas, desbloqueadas, não partilhadas e sem âmbito ambíguo. A revisão captura IDs, revisão e digest da vista, valida todos os checkpoints do lote antes da primeira escrita e informa quantas memórias ficam para outro lote. Cada lote tem no máximo 2000 elementos. Memórias que chegam depois da revisão ficam para a revisão seguinte.

A confirmação repete a validação e publica sequencialmente pelo serviço recuperável existente. A baseline é capturada por memória e o servidor mantém o CAS transacional. Mudança de conta/cofre, cancelamento observado ou fonte alterada interrompe o trabalho. O botão de parar impede a próxima operação; uma escrita já enviada pode terminar e ser confirmada depois. Uma confirmação perdida deixa o pedido cifrado pendente e impede começar outro lote.

O mapa por ID evita procurar o corpus inteiro por memória durante o lote. A materialização do mapa, filtros e opções da interface continua a percorrer o array de sessões recebido. Este incremento não resolve todos os percursos O(N), a virtualização ou o custo de cofres grandes.

## Pedidos pendentes e cópia cifrada

O pedido pendente fica visível, com ações explícitas de revisão/retoma, cancelamento e exportação cifrada. Recuperar um recibo já confirmado e cancelar continuam disponíveis com a admissão de novas escritas fechada. Cancelar pode confirmar uma escrita que terminou antes do cancelamento; não reverte uma escrita concluída.

Não existe expiração automática do journal nem um botão para o descartar sem confirmação terminal. O nonce pode identificar uma escrita já concluída. A exportação conserva os mesmos bytes cifrados num invólucro com formato, versão e UID; não envia RPC nem inclui texto/título em claro. A importação valida tamanho, formato, conta, propósito e pedido decifrado com o cofre atual, recusa substituir outro pedido pendente e só repõe custódia local. A aplicação exige revisão e confirmação separadas. A cópia precisa da mesma conta e chave; não é backup integral do cofre.

A limpeza local de uma conta inclui apenas a chave exata do seu journal. Não apaga a chave de outra conta nem chaves que tenham apenas um prefixo parecido. A eliminação do dispositivo/storage sem uma cópia pode continuar a perder o nonce local; não foi criada uma listagem de operações independente do nonce.

## Histórico e rollback

O histórico usa o SDK Firestore e páginas de 25 versões ordenadas por `createdAt`. Conserva o cursor mesmo quando uma página contém só versões de conteúdo, permitindo chegar a arquivos de índice mais antigos sem um índice composto novo. O cursor pertence à conta, memória e digest apresentados. O documento pessoal atual é lido antes e depois da página e decifrado com a chave aberta.

Só arquivos de índice com caminho, marcador, autorização, envelope, digest e metadados válidos aparecem como versões selecionáveis. O painel recebe data, modelo, dimensão e referência; não recebe o vetor/ciphertext para renderização. Arquivos de outro conteúdo cifrado podem aparecer, mas não permitem rollback. A confirmação captura uma baseline nova e o servidor volta a validar autorização, conteúdo/chave e CAS.

Um teste reproduziu a chegada do snapshot da própria escrita antes do ACK. O cliente verifica a fonte antes de enviar e conserva as guardas de conta/cofre durante a operação, permitindo reconhecer a sua própria confirmação. O CAS e a baseline continuam a proteger contra alterações concorrentes.

## Verificação local e limites

Passaram **1837 testes frontend em 216 ficheiros**, sem falhas ou omissões, na execução geral final com a configuração do repositório. Esta execução inclui os 60 casos dos cinco ficheiros focados, com a asserção de foco final, revisão/lote, retoma, importação/exportação, limpeza exata por conta, histórico e painel. A regressão de foco na confirmação e a regressão do snapshot antes do ACK foram observadas antes da correção e os resultados foram conservados.

As primeiras duas execuções gerais completas tiveram 1836 sucessos e uma falha cada: foco da lista acima do prazo de cinco segundos e espera inicial pela cápsula acima de um segundo. Os casos passaram isoladamente. O teste da lista passou a localizar o botão de paginação pelo texto, conservando a verificação do papel/nome/foco do resultado; a espera inicial da cápsula passou a três segundos. A configuração da suite conserva quatro workers e admite dez segundos por teste para cifra real e diálogos completos. Foram interrompidas duas tentativas posteriores após falhas conhecidas: um teste de Definições acima de cinco segundos e uma asserção imediata de foco do painel antes da conclusão da revisão assíncrona. Esta última passou a esperar pelo foco antes de clicar. Nenhuma tentativa interrompida é aprovação; o wrapper da primeira conserva também a alteração da configuração observada enquanto terminava.

Dois testes adicionais passaram com o SDK Firestore real no emulador do projeto demo isolado `demo-mnemosyne-index-sdk`: paginação por uma primeira página de 25 versões de conteúdo até um arquivo de índice, autorização do proprietário e alteração tardia de acesso. A primeira tentativa falhou porque o ambiente Node do teste não tinha `window`; a fixture passou a expor o Web Crypto real. O emulador final encerrou normalmente. Estes dois casos não substituem a suite integral anterior de 322 Functions/Rules +23 frontend/Rules, que não foi repetida neste incremento de interface.

O Chromium executou o painel React, serviços reais, Web Crypto, IndexedDB, localStorage e Web Locks. Publicou um vetor preparado sintético, perdeu o ACK depois do commit no executor real do servidor com transações em memória, exportou o pedido, perdeu a custódia local, recarregou a página e importou a cópia. Recuperou a confirmação com admissão fechada sem repetir a aplicação. O rollback explícito restaurou o vetor anterior e o marcador ausente, preservando cifra, grafo, anexos e aprendizagem. Passaram foco da confirmação/voltar, quatro idiomas e ocultação da fonte ao bloquear o cofre. O primeiro ensaio usou CSS do build anterior; o percurso final passou depois do novo build com o CSS produzido por ele, também conservado e inspecionado.

O browser usa identidade sintética e um limite Firebase substituído; não monta a aplicação completa nem prova Auth/App Check publicados ou transações Firestore reais nesse percurso. A admissão aberta é exclusiva da fixture. Não houve inferência real de modelo, pedidos externos encaminhados, chamadas a fornecedores ou mutações de produção nesse ensaio. O build TypeScript/Vite final passou e preservou os downloads públicos e o feed legado. O lint dos 14 ficheiros terminou sem erros, com um aviso de dependências de um hook de Definições já presente na imagem anterior.

Modelo global, migração de produção, calibração/qualidade entre modelos, plataformas, pilotos autenticados, CI remoto e restantes fases 0–6 continuam pendentes. Os 49 gates permanecem fechados. A política cloud conserva apenas modelos gratuitos; não foram repetidas chamadas OpenRouter anteriormente recusadas com 429. Não houve deploy. Prova privada: `W:/real/mnemosyne-launch-evidence/embedding-index-ui-local-validation-20261026.json`, com logs em `W:/real/mnemosyne-launch-evidence/embedding-index-ui-validation-20261026/`.
