# Importação Obsidian recuperável — 5 de outubro de 2026

## Estado e âmbito

Incremento das fases 1/4: importação de vault Markdown e Universo inicial. A criação, os hubs, os pais e os wikilinks passam a fazer parte de um plano cifrado imutável, conservado antes da primeira chamada. A recuperação retoma o cursor confirmado pelo servidor com os mesmos IDs e cifras. Os dois gates `OBSIDIAN_IMPORT_WRITES_ENABLED` continuam fechados. Nenhuma fase nem o lançamento completo fica concluído por este incremento.

O protocolo anterior recuperava um par de ligações, mas não a criação nem os passos restantes da importação. Esse contrato continua disponível para ligações explícitas de outros percursos. O novo protocolo cobre o plano inteiro de Obsidian/Universo inicial; lotes genéricos de documentos ainda exigem recuperação integral própria.

## Contrato e privacidade

| Callable em `europe-west1` | Efeito |
|---|---|
| `beginObsidianImport` | Valida o plano inteiro, quota inicial e colisões; grava manifesto de hashes/cursor e orçamento diário |
| `applyObsidianImportBatch` | Confirma um lote ordenado de até dez criações ou 50 pares; transação de dados, histórico, utilização, recibo e cursor |
| `getObsidianImportStatus` | Consulta pelo ID e digest originais, ligado ao UID autenticado; devolve somente estado e contadores |
| `cancelObsidianImport` | Conserva progresso confirmado e impede passos novos; pode registar cancelamento antes da admissão |

Auth e perfil vivo/marcador permanente de eliminação precedem todas as operações. DTOs têm allowlist estrita: cifra pessoal `enc:{v,iv,ct}`, IDs, papel hub/nota, metadados admitidos e topologia do plano. Não admitem UID, texto, título, tokens ou anexos. Texto/título são analisados e cifrados no dispositivo. Tags, categoria, posição, taxonomia e relações permanecem em claro segundo a decisão do prompt mestre; podem revelar informação e não são anunciados como anónimos. O diário completo — incluindo UID, plano e resultado local — fica cifrado pelo cofre.

Não há chamadas de IA, embeddings, fornecedores ou secrets neste importador. Não associa o novo vault a memórias preexistentes por inferência semântica. O servidor conserva no manifesto apenas hashes dos lotes, origem e progresso; as cifras ficam nas sessões e no diário local. Recibos permanentes ligam criação e cifra ao pedido original, permitindo repetição sem recriar dados.

## Atomicidade, utilização e alterações concorrentes

Criações incluem âmbito pessoal explícito, cifra, recibo de criação e recibo de utilização. O contador mensal muda na mesma transação. O trigger de utilização encontra o recibo e não cobra novamente. A admissão inicial verifica a quota para o plano inteiro; cada lote volta a verificar a quota atual.

**A admissão não reserva quota mensal.** Outro escritor pode consumir capacidade depois dela; nesse caso o lote inteiro fica suspenso sem gravação parcial e o diário conserva o trabalho restante. A reserva global entre todos os escritores, calibração e pilotos continuam necessários. O orçamento diário limita dez planos, 1 500 memórias planeadas e 20 MiB por UID/dia UTC; repetição do mesmo plano não cobra de novo. Cancelamento não devolve esse orçamento, para evitar ciclos de admissão/abuso. Estes valores são limites locais propostos, sujeitos a calibração operacional.

Os pares são únicos, sem auto ligação e restritos aos IDs deste plano. A criação termina antes da fase de ligações. Cada lote de ligações relê as duas pontas em transação, exige propriedade pessoal/sem partilha/tombstone e confirma a cifra original pelo recibo. Acrescenta os pares reciprocamente às ligações atuais e conserva outros metadados/relacionamentos. Arquiva o documento cifrado anterior uma vez por ponta alterada/lote; um par já existente não cria arquivo inútil. Até cem pontas e 202 writes por lote ficam abaixo do limite transacional.

**Uma edição da cifra ou mudança do pai antes do lote de ligações interrompe a aplicação**, conservando o plano para cancelamento/investigação. Não faz rebase automático de wikilinks antigos sobre uma nota editada. Mudanças concorrentes em metadados não relacionados são preservadas pelo merge transacional. Repetir um lote já confirmado devolve o estado histórico atual do plano; não recria notas apagadas nem repõe ligações removidas mais tarde. “Confirmado” descreve a operação histórica e não garante que os dados continuam presentes após edições posteriores.

## Cliente, recuperação e interfaces

Um diário por UID e Web Lock exclusivo impedem duas abas de iniciar o mesmo percurso simultaneamente. Todos os IDs, notas analisadas, hubs, metadados e pares são capturados antes da gravação; todas as cifras são produzidas antes da primeira RPC. Falha/quota de armazenamento local recusa a operação antes da admissão. Não há fallback para diário em claro, truncação silenciosa ou repetição com outro ID.

Guardas de conta/cofre mantêm a mudança de contexto bloqueada mesmo numa troca de conta e regresso. Depois de cada await, o cliente confirma o contexto e os bytes exatos do diário antes de continuar. Cifra adulterada, cofre diferente, transplante de UID e substituição do diário não podem provocar RPC ou limpeza indevida. Terminal `complete`/`cancelled` exige segunda consulta coerente antes de limpar. Consulta/cancelamento continuam disponíveis com gate fechado; progresso incompleto exige o gate de escrita aberto para retomar.

O painel de recuperação fica no input do Universo, acessível mesmo sem uma captura ativa. Mostra notas/wikilinks confirmados, permite retomar e exige confirmação para cancelar os passos restantes. Cancelamento conserva notas/ligações já confirmadas. Sucesso/seleção de nota não atravessa troca de conta/cofre ou desmontagem do painel. Erros apresentados são fixos, sem conteúdo/caminhos privados.

App, CognitiveInput e os dois seletores de pasta das definições capturam a conta/cofre antes de selecionar/ler ficheiros. Vaults nas definições passam pelo novo protocolo sem o antigo corte genérico de vinte ficheiros. A leitura Tauri verifica o contexto antes/depois de cada leitura e recusa a seleção inteira se um ficheiro não puder ser lido, sem imprimir o caminho ou ocultar a falha.

Para o Universo inicial, a preferência local de assimilação é gravada e relida **antes** de apagar o diário confirmado. Se essa gravação falhar, a recuperação confirma o mesmo plano e conclui a preferência sem criar novas notas. A preferência é por browser; não é uma chave de deduplicação global entre dispositivos ou novas intenções de importação.

## Limites, compatibilidade e retenção

- Entre uma e 150 notas, até 150 hubs, dez criações ou 50 pares por lote; até 2500 ligações atuais por memória.
- Ficheiro Markdown até 1 000 000 bytes, texto de nota até 120 000 caracteres e plano normalizado até 4 000 000 bytes UTF-8. Diário descifrado até 4 200 000 bytes; quotas reais de localStorage podem recusar valores menores. Os limites recusam o lote, sem cortar conteúdo.
- Anexos de vault e notas fora da seleção não são importados; o parser/resultados indicam ficheiros ignorados e wikilinks não resolvidos. Links resolvidos são pares únicos; contadores de notas excluem hubs e contadores de wikilinks excluem pais.
- Regras recusam acesso direto, mesmo do dono, a `obsidianImports`, filhos `batches` e `obsidianImportBudgets`. Callables são a fronteira autorizada. Eliminação de conta remove recursivamente os artefactos do UID e apenas as suas chaves locais, conservando as de outros utilizadores.
- Não há TTL automático de recibos ou descarte por idade. Política de retenção, migração de clientes/instalações e recuperação sem o diário original continuam por definir/testar. Sem diário, não inventar um plano a partir do manifesto.
- Escritores legados, semânticos, genéricos e de equipas, quota global, grandes cofres, densidade extrema, Android/Tauri reais, Auth/App Check, custo e piloto de migração continuam pendentes. O teste de 150 notas em Chromium não demonstra desempenho de um grande cofre.

## Publicação e reversão

A autorização de deploy exige todas as áreas concluídas. O preflight passa a 21 gates/12 ficheiros, incluindo cliente e servidor deste protocolo. Piloto isolado, compatibilidade, artefactos e checks remotos precedem abertura. Suspender begin/apply conserva consulta/cancelamento e os diários/recibos; não apagar ledgers para desbloquear importação nem reativar a escrita direta antiga.

## Evidência local

A validação final e os hashes são registados no estado completo e na prova privada `W:\real\mnemosyne-launch-evidence\obsidian-plan-local-validation-20261005.json`. Emuladores usam exclusivamente `demo-mnemosyne-rules`; o browser usa RPC sintética localhost. Nenhuma chamada de fornecedor, escrita de produção ou deploy.

Passaram **691 testes gerais frontend/124 ficheiros, 68 focados/oito ficheiros, 214 unitários Functions**, build Functions/web com TypeScript de projeto, lint **zero erros/23 avisos anteriores**, quatro testes de deploy/21 pontos de falha e análise de sintaxe/YAML/diff. Chromium confirmou parsing de File Markdown, cifras reais, diário real, recuperação noutra aba de ACK de criação/final, IDs/cifras originais, consulta com gate fechado, cancelamento antes de admissão, recusas de cofre/UID/adulteração, Web Locks, substituição do diário e 150 notas Unicode. A RPC é sintética; emuladores validam separadamente as transações/regras com SDK real.

A primeira passagem geral teve 690 passes e uma falha no teste novo porque o DOM de testes não oferece `File.text()`; corrigiu-se o fixture para `FileReader`. A primeira lint encontrou defaults de dois argumentos legados não usados; passaram a opcionais, mantendo a posição/API. Os logs iniciais ficam conservados. A auditoria atual de dependências encontrou três pacotes afetados na árvore Functions: atualizou-se Admin para 13.10.0 e busboy para 3.2.2 e removeu-se forge; ambas as auditorias finais reportam zero vulnerabilidades. [A decisão de dependências](DEPENDENCIAS_NODE22_2026-10-01.md) conserva as fontes oficiais e a compatibilidade de credenciais.

As duas passagens completas do emulador passaram **142 Functions +22 frontend**, incluindo a final com a árvore SDK corrigida. Exercitaram admissão/criação/ligações concorrentes, ACK repetido, utilização do trigger, arquivo exato, replay após eliminação, quota inteira e após admissão, alteração da cifra/âmbito, cancelamento concorrente nos três momentos, regras privadas e eliminação recursiva por UID. O teste adicional do limite agregado prova recusa UTF-8 antes de transação para metadados multibyte cujo comprimento JavaScript é inferior ao teto de bytes. Não são ensaios de produção ou de desempenho de grandes cofres.
