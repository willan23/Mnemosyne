# Importação documental integral e recuperável — 5 de outubro de 2026

## Contrato de produto

Uma importação conserva um plano de pastas, documentos, originais cifrados e ligações entre pais e filhos. Os UUIDs são atribuídos antes da primeira leitura de ficheiros; texto/título e originais são cifrados localmente. Os originais e os seus checkpoints cifrados ficam em IndexedDB. O plano completo e os handles dos originais ficam num diário cifrado por UID em localStorage, antes de qualquer reserva de upload ou escrita remota do lote.

A análise de texto, PDF, Office, imagem, áudio/vídeo e o enriquecimento semântico continuam locais. Categoria, tags, embedding/modelo, cluster, posição e importância mantêm o contrato existente. Os vizinhos sugeridos pelo embedding não são escritos como ligações automáticas. Embeddings e os outros metadados de pesquisa podem ficar em claro no servidor e são dados sensíveis sujeitos à autorização e retenção; não são dados anónimos.

Textos legíveis podem ser importados sem original quando a política é `never-cloud`, o upload está fechado ou o ficheiro excede o limite de original. O texto cifrado identifica que não há original no armazenamento e que a extração indexa até 120 mil caracteres. Isto conserva o comportamento de importação de texto existente. Outros formatos exigem original cifrado e permissão de armazenamento. Quando um original faz parte do plano, falhas de preparação/envio não o removem silenciosamente do lote. A policy central continua a pedir consentimento específico antes de contactar o armazenamento; preparação local não pede consentimento de rede nem faz RPC.

Pastas com subpastas conservam os pais originais. Ficheiros soltos selecionados juntamente com uma árvore de pastas recebem um hub próprio. Um hub pode referenciar os originais dos seus documentos diretos; cada original pertence a um único documento.

## Admissão e confirmação do servidor

Há quatro callables em `europe-west1`, sem bindings de secrets de fornecedores:

- `beginDocumentImport`: valida o plano inteiro, conta viva, quota inicial, colisões de IDs e orçamento diário; grava manifesto privado, hashes de lotes e cursor.
- `applyDocumentImportBatch`: confirma criação de até dez memórias ou até cinquenta pares de ligações, com recibo imutável por lote.
- `getDocumentImportStatus`: consulta somente o estado ligado ao UID, UUID e digest originais.
- `cancelDocumentImport`: impede novos lotes e confirma o progresso conservado; também impede admissão tardia de um pedido ainda desconhecido.

Criação, recibos de criação/uso, contador e associações de anexos são transacionais. Cada anexo deve estar pronto, pessoal, ligado ao autor, ao bucket configurado e ao digest do cabeçalho original. A transação toca o registo de referências uma vez por anexo/lote, serializando a associação com a decisão de purga. Um anexo em purga, em reserva, alterado ou de outro âmbito rejeita o lote inteiro.

As ligações confirmam os dois lados e conservam histórico. Exigem endpoints pessoais, vivos e não partilhados, recibos deste plano e as cifras originais; verificam a relação de pai antes de acrescentar as ligações. Alterações legítimas de outros metadados são conservadas. Cipher ou pai alterado interrompe a retoma para revisão/cancelamento. Repetir um recibo confirmado consulta o progresso histórico: não recria uma nota eliminada nem restaura uma ligação removida posteriormente.

A quota inicial cobre o tamanho previsto do lote, **não reserva capacidade futura**. Cada lote de criação volta a validar o contador e o entitlement; trabalho concorrente ou mudança de plano pode pausar a importação sem confirmar parte desse lote. O orçamento diário é de dez admissões, 3400 memórias planeadas e 20 MiB de planos normalizados por UID/UTC. Repetir a mesma admissão não volta a consumir o orçamento. Estes limites ainda exigem calibração do piloto.

## Recuperação e cancelamento

O diário é imutável durante a operação. A retoma reutiliza os UUIDs, cifras, cabeçalhos e digests originais, verifica os ficheiros locais antes de novo trabalho e continua no cursor confirmado. Uma consulta de estado sem escrita pode preceder a leitura dos originais numa retoma: permite concluir a limpeza quando uma execução anterior já confirmou o lote e removeu parte dos checkpoints locais.

Há Web Locks por UID/plano e por ficheiro. Mudanças observadas de conta, cofre ou política de cloud permanecem latched mesmo se o valor anterior regressar. A substituição do diário durante um await impede trabalho seguinte e limpeza. O resultado e a limpeza dependem de confirmação terminal repetida.

Depois de conclusão, a limpeza de checkpoints dos originais tolera checkpoints já removidos numa limpeza anterior; rejeita checkpoints substituídos ou que não estejam prontos. Se a limpeza falha, o diário do plano conserva-se para retomar. Não há um segundo upload para resolver uma confirmação perdida.

O cancelamento confirma primeiro o plano. Cancela originais ainda pendentes, conserva notas/ligações confirmadas e conserva os originais já prontos no painel de anexos. Não executa purga implícita desses originais. Uma falha de ACK da limpeza/cancelamento mantém o diário para repetir somente os passos necessários. O painel de recuperação fica acessível mesmo com o compositor fechado e só seleciona o resultado quando a operação está concluída e o contexto continua atual.

Uma interrupção durante a preparação local, antes de existir o diário completo, pode deixar originais cifrados locais no inventário de anexos; nessa etapa não houve upload nem criação remota deste plano. Esses drafts continuam sujeitos à recuperação/exportação local existente. Não se afirma que sejam uma importação remota confirmada.

## Limites e migração

- Um a vinte documentos, até dezasseis hubs ancestrais por documento, até 320 hubs e 340 memórias por plano.
- Plano normalizado até 4 MB UTF-8; memória normalizada até 900 kB, deixando espaço para descritores/campos do servidor.
- Originais respeitam as políticas de formato/magic bytes e tamanho de `attachmentEnvelope.ts`; o plano conserva somente cabeçalhos opacos e digests, sem nomes/URLs de ficheiros em claro.
- Contratos rejeitam campos adicionais, plaintext, referências externas, ciclos, duplicados, hubs órfãos e anexos não referenciados. Não cortam silenciosamente um plano que exceda esses limites.
- O plano e os uploads ainda dependem desta instalação/perfil de navegador. Recuperação entre instalações e o piloto Tauri/Capacitor continuam pendentes.
- O percurso anterior não tinha um manifesto integral; não é possível inventar um comprovativo para importações antigas parcialmente concluídas. A migração exige inventário e reconciliação dessas operações, preservando dados.

Rules negam acesso direto a `documentImports`, recibos de lotes e `documentImportBudgets`. A eliminação da conta inclui os manifests/filhos e budgets do UID, e a limpeza local inclui a chave exata do diário sem apagar diários de outros UIDs.

Cliente e servidor permanecem com `DOCUMENT_IMPORT_WRITES_ENABLED=false`. O inventário de lançamento passou a **23 gates em 13 ficheiros**. A abertura depende dos critérios de todas as fases, das configurações/quotas de anexos e do piloto. Rollback fecha as novas admissões/escritas e conserva recibos/diários; status/cancelamento continuam disponíveis. Não remove manifests para tentar reconstruir o lote.

## Evidência de validação

Passaram **736 testes gerais frontend/127 ficheiros, 79 testes focados frontend/seis ficheiros, 224 unitários Functions, 147 testes Functions +22 frontend no emulador Firestore/Storage**, build web com TypeScript, build Functions, lint zero erros/23 avisos anteriores e quatro testes do procedimento de deploy. As duas auditorias de dependências de produção reportam zero vulnerabilidades.

O Chromium usou ficheiros, cifra do cofre/originais, IndexedDB, localStorage e Web Locks reais. RPC e transporte de upload foram sintéticos em localhost, sem pedidos externos: perda de ACK de upload/criação/final, retoma noutro separador, IDs/cifras estáveis, um POST por original, cancelamento desconhecido, gate fechado após conclusão, rejeição de cofre/UID/adulteração de diário e bytes do original, lock e substituição do diário. Validou vinte documentos Unicode. Isto não valida IAM/GCS, consentimento de produção, App Check, dispositivos nativos ou fornecedores reais.

A primeira suite geral frontend teve 732 passes e quatro falhas de fixture: o teste isolado de geração no compositor precisava de incluir o novo painel entre os painéis de recuperação simulados. O painel tem testes próprios de interação/conta/cofre/resultados tardios; a fixture de geração foi corrigida sem ignorar os quatro testes. A primeira passagem focada também identificou uma referência antiga de UI ao resultado Obsidian, um contador de fixtures a atualizar e comparação de typed arrays entre realms DOM/Node. Os ensaios iniciais do harness browser identificaram escapes/exports e ambiente Vite ausente; foram corrigidos no harness. Os logs iniciais são conservados.

A repetição geral passou os 736 testes; as falhas anteriores não foram ocultadas. Os hashes de fontes/logs/artefactos ficam na evidência privada `W:\real\mnemosyne-launch-evidence\document-import-and-revision-local-validation-20261009.json`. O objetivo completo das fases 0–6 permanece em execução; este incremento não autoriza uma publicação antes de concluir esse objetivo.

Nota de rastreabilidade (8 de outubro): os logs temporários de 5 de outubro deixaram de estar disponíveis antes de finalizar a prova. As contagens acima conservam o relato histórico; a validação foi novamente iniciada sobre o código atual, com logs permanentes em `W:\real\mnemosyne-launch-evidence\document-import-validation-20261008`. A prova de 8 de outubro só é gerada após todas as verificações terminarem com sucesso; não substitui logs ausentes por resultados presumidos.
