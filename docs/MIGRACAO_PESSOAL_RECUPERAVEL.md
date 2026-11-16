# Migração pessoal recuperável — 15 de outubro de 2026

## Âmbito e ameaça

A migração anterior cifrava texto/título por transação SDK. Comparava alguns campos e podia perder a confirmação, avançar sem um recibo recuperável ou publicar progresso depois de mudar de conta. O percurso atual conserva sessões pessoais, versões históricas e `users/{uid}/memories`, com paginação, pausa e retoma. As leituras de descoberta continuam no SDK; as escritas passam por Functions autenticadas.

Sessões e pais de versões exigem UID próprio, `teamId:null`, ausência de partilhas, ausência de contexto de chave de equipa e conta ativa. Uma versão sem UID herda o âmbito do pai; uma memória aninhada sem UID herda o caminho do utilizador. Um UID explícito diferente é recusado. Um âmbito de equipa ou ambíguo nunca usa a chave pessoal. Sessões sem `teamId` explícito aguardam o backfill operacional e a sua verificação antes do corte global.

## Preparação, cifra e arquivo

A preparação compara o hash integral do registo lido e, numa versão, o do pai. Captura os `updateTime` completos para recusar alterações revertidas. O cliente cifra texto/título e conserva uma cópia integral anterior num arquivo AES-GCM dividido em fragmentos. O arquivo usa a representação canónica tipada partilhada: mapas, arrays, strings, números, timestamps, geopontos, bytes e referências Firestore mantêm a distinção entre tipos. Formatos não suportados são recusados; não são omitidos silenciosamente.

Cada fragmento é decifrado e comparado no cliente antes de preparar o pedido. O pedido tem UUID, UID interno, base e cifras; fica cifrado em IndexedDB antes da aplicação, com Web Locks, comparação atómica, leitura de confirmação e guardas de conta/cofre. O servidor recebe hashes e cifras, sem texto/título, mnemónica ou chave em claro. Não pode demonstrar a correspondência entre uma cifra e o texto sem a chave; a verificação dessa correspondência é responsabilidade do cliente.

Uma transação cria o manifesto do arquivo, os fragmentos, recibo, evento e contador e altera somente `text`, `title`, `enc` e `personalMigrationId` no registo. Preserva presença/ausência de UID, timestamp, revisão, histórico e restantes metadados. Não provoca um re-sync por alterar artificialmente `updatedAt`. O novo identificador permite localizar o arquivo pelo registo migrado. Um endpoint autenticado permite recuperar os fragmentos próprios, mesmo após remoção da origem.

O cliente volta a consultar o recibo, lê o arquivo efetivamente guardado, decifra os fragmentos ordenados e compara o hash integral anterior. Só depois remove o pedido local e incrementa o contador da migração. Um arquivo incompleto, outra conta, mudança de cofre ou confirmação divergente conserva o pedido. Não há atualização otimista do cursor.

## Pausa, falhas e retoma

Os cursores anteriores mantêm-se compatíveis. Uma página com falha não avança; a verificação de retoma percorre também os registos anteriores ao cursor. As versões são tratadas sequencialmente para partilharem uma única intenção pendente por UID. Leituras transitórias conservam o retry limitado anterior. Uma aplicação não é preparada de novo depois de perder o ACK: a recuperação usa o mesmo pedido e consulta o recibo antes de aplicar.

O painel global permite recuperar ou cancelar. Um pedido desconhecido pode ser cancelado com novas aplicações fechadas; uma operação já gravada confirma o recibo e verifica o arquivo. Sem recibo e com âmbito revogado, consulta/cancelamento devolvem revogação apenas de leitura. As Definições invalidam confirmação, progresso e feedback ao mudar de conta/cofre ou fechar a vista. A confirmação da mnemónica e do backup continua necessária.

## Limites e operação

- Pedido máximo de 8 MB, até 96 fragmentos, cada cifra de fragmento até 260.000 caracteres. O envelope v1 de texto/título conserva o seu limite existente de 1.000.000 caracteres de ciphertext. Um registo que exceda estes limites falha inteiro e mantém a origem; não é truncado. A conclusão operacional exige resolver todos os registos recusados.
- Contador inicial por UID: 10.000 aplicações e 100 MiB de cifras por dia. Preparação/aplicação e leitura de arquivo têm limite de 300 pedidos por minuto; consulta/cancelamento, 1.000. A calibração global de custos/quotas continua exigida na fase 2 antes da ativação.
- Cinco callables em `europe-west1`, com UID capturado ligado ao token antes de limites ou base. Novas aplicações usam o gate de revisões pessoais, ainda fechado.
- `personalMigrations`, `personalMigrationEvents`, `personalMigrationBudgets` e `personalMigrationArchives`, incluindo fragmentos, recusam SDK. A purga da conta remove os arquivos recursivamente e o diário IndexedDB apenas desse UID.
- O arquivo conserva o estado completo anterior, mas este incremento não remove nem cifra todos os outros campos em claro da origem. Embeddings/tags/categoria/conexões/posição mantêm a decisão documentada de produto; campos legados adicionais continuam sujeitos à revisão e migração de privacidade. Registos já com `enc` não são reinterpretados automaticamente, mesmo que tenham campos em claro contraditórios.

## Validação local

Primeiros resultados: sete testes do protocolo servidor e onze do cliente; quatro cenários novos de Firestore real emulado e os 23 testes de regras do frontend passaram. A integração percorreu os três tipos de registo, pausa/retoma e inserção anterior ao cursor. O ensaio Chromium usa factory/painel, AES, IndexedDB/Web Locks e executor reais com Auth/base sintéticos: arquivo com vários fragmentos, ACK perdido/reload com gate fechado, arquivo incompleto, cancelamento e token trocado. Zero pedidos externos ou mutações de produção no ensaio.

A suite geral aprovou **1.325 testes/173 ficheiros** no frontend e **406 testes/uma omissão** em Functions (sem emulador nesse comando). A passagem completa das regras aprovou **238 cenários Functions +23 frontend**, sem falhas/omissões e com os emuladores demo encerrados. Build/TypeScript, quatro smokes públicos locais e quatro testes de preflight passaram; lint sem erros, com os 23 avisos anteriores. Dependências e locks conservados.

A primeira passagem geral e duas passagens isoladas expuseram verificações de carga da cache antes de concluir o hash assíncrono. Os testes passaram a aguardar a carga observável, mantendo todas as verificações de decifração apenas dos registos alterados, identidade de objetos e invalidação imediata após mudança de conta/cofre ou recusa da subscrição. Nove casos isolados e a passagem geral final passaram sem alterar o produto nem aumentar os timeouts. Os logs iniciais são conservados.

Prova consolidada: `W:/real/mnemosyne-launch-evidence/personal-migration-local-validation-20261015.json`. O [estado do lançamento completo](ESTADO_LANCAMENTO_COMPLETO.md) conserva os critérios por concluir; este documento não declara a fase 3 nem o lançamento concluídos. Os 40 gates/21 fontes permanecem fechados, sem deploy ou migração de dados reais.

## Inventário para o corte das escritas antigas

O inventário AST local examinou 284 ficheiros de produção do frontend e encontrou 13 chamadas de admissão de escritas Firestore, nove alcançáveis por imports de runtime desde `main`. Os resultados e hashes estão em `sdk-writers-readonly.json`, na pasta privada de validação. O cálculo de alcance é um limite superior; não demonstra que uma função seja executada. Não resolve todas as formas de alias, imports calculados ou wrappers em dependências, pelo que não prova sozinho a conclusão do cutover.

A migração pessoal já não aparece nesse inventário. A recifra histórica de equipa conserva o escritor SDK a substituir. Os outros candidatos alcançáveis incluem contadores/avisos, identidade pública e emparelhamento, com políticas próprias a verificar. As rotinas antigas de criação de equipa, ligações e apagamento continuam no código, sem chamador de produção identificado nesta leitura; a sua compatibilidade e as regras antigas devem ser tratadas no corte global.
