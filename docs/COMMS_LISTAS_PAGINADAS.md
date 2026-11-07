# Listas Comms paginadas — 12 de outubro de 2026

Atualização posterior: o [diretório e a procura de contactos aceites](COMMS_DIRETORIO_CONTACTOS_ACEITES.md) acrescentam duas famílias e três índices declarados. Os contactos já não dependem das páginas de pedidos. Este documento conserva o contrato e os resultados do incremento anterior das cinco listas.

## Problema e decisão

As cinco listas do painel usavam queries SDK sem limite para transmissões recebidas/enviadas, contactos recebidos/enviados e rooms recebidas. As rules exigem ambos os participantes ativos: a revogação de um deles podia recusar a query inteira. O novo callable `listCommsPage`, em `europe-west1`, mantém autorização no servidor e avalia cada registo. As rules não foram relaxadas.

O pedido contém UID capturado, família da lista e cursor, com schema exato. O UID tem de corresponder ao token antes dos rate limits. A query limita-se ao campo do participante autenticado e lê no máximo 26 candidatos; cada resposta percorre até 25. O cursor pertence à mesma conta/família. Não confere acesso a outras contas e é um marcador de posição, sem assinatura ou autoridade própria.

A ordenação por ID inclui candidatos antigos sem timestamp. O cliente usa comparação UTF-8 consistente com Firestore, incluindo IDs Unicode. O cursor aceita IDs Firestore até 1.500 bytes: um registo indisponível com ID longo não bloqueia o avanço. Registos que não cumprem o contrato de transmissão/contacto/room contam como indisponíveis; não são retornados como dados válidos.

Após verificar Auth do chamador e participantes, uma segunda transação relê os registos, perfis e marcadores permanentes de eliminação. Participantes desativados/eliminados/ausentes ou autoridade alterada entre leituras retiram apenas os respetivos registos. Falha transitória de Auth/DB falha a página, com mensagem de erro; não é apresentada como inbox vazia confirmada. A decisão vale para a leitura autorizada; não revoga uma cópia já entregue ao cliente.

## Dados e limites

O servidor projeta somente os campos definidos para cada família: cifra/metadados de transmissão, labels/estado/datas do contacto ou proposta de room. Campos adicionais armazenados não atravessam a resposta. Cifra v2 também tem digest conferido. UIDs de participantes indisponíveis não são enviados nos itens; o cursor pode conservar o ID do último candidato percorrido. O aviso informa somente o número de registos indisponíveis, sem indicar motivos ou identidades.

A resposta tem limite de 2 MiB. Se uma cápsula válida não couber, termina antes dela e conserva cursor para a página seguinte; não corta os bytes cifrados. Texto/anexos/cifras seguem os limites de [entrega](COMMS_ENTREGA_RECUPERAVEL.md). Rate limits: 60 consultas por UID/minuto e 600 por projeto/minuto. Calibração de custo/quotas operacional continua pendente.

Não há novas rules, índices, dependências ou schema persistente. O endpoint é de leitura. O ID do registo vem do snapshot e não de um campo `id` que o conteúdo possa forjar. Registos de outra conta ou com participante alterado são recusados/excluídos nas verificações finais.

## Painel

Anterior/Seguinte/Atualizar percorrem uma página de cada vez. Apenas a página corrente conserva cifras/conteúdo aberto; o histórico contém cursores. O refresh não publica novamente dados idênticos e pedidos concorrentes são serializados. Troca de conta/cofre, fecho da vista e unsubscribe retiram callbacks de dados e progresso. Falha limpa os itens anteriores e mostra erro.

Atualização automática a cada 30 segundos, apenas com o documento visível e a secção relevante ativa; não é um stream em tempo real. Aceitação/rejeição atualiza as páginas de contactos. Um erro pontual ao ler o perfil de um contacto não retira todos os outros. Os contactos disponíveis refletem as duas páginas correntes de pedidos: navegar permite percorrer os restantes.

Páginas são ordenadas pelo ID para garantir cobertura do legado; itens da página são apresentados por data quando existente. Não há promessa de ordenação cronológica global nem snapshot imutável entre páginas. Novos registos anteriores ao cursor aparecem ao regressar/atualizar a primeira página. Pesquisa global e uma lista independente de contactos aceites continuam por implementar.

## Verificação

1.006 testes gerais frontend /149 ficheiros; 38 focados /quatro ficheiros antes e depois do ajuste final, TypeScript/build web e lint escopo sem erros/avisos. Lint geral zero erros/23 avisos anteriores. 276 unitários Functions +um teste separado ignorado, antes do último teste/correção de cursores; oito focados finais. Quatro testes pipeline. Três testes finais no emulador verificam paginação/isolamento, revogação durante Auth e ordenação Unicode/cursor longo reais.

Chromium usa painel, controlador paginado, executor, RSA/AES, storage e locks reais; Auth/RPC/DB são fronteiras sintéticas localhost. Verifica primeira página de 25 cápsulas, segunda de quatro, três registos indisponíveis e retorno à primeira, mantendo os cenários de recuperação/cancelamento/ACK de entrega. Zero pedidos externos/fornecedor/produção. Não substitui pilotos Firebase Auth/rede externa/Android/Tauri.

Falhas iniciais conservadas: o teste de navegação tentava avançar antes de terminar refresh; o browser procurava conteúdo em `p` quando o painel usa `div`. Corrigidos os fixtures. Prova privada `W:\real\mnemosyne-launch-evidence\comms-pagination-local-validation-20261012.json`; logs `comms-pagination-validation-20261011`. 36 gates /17 fontes continuam fechados.

## Rollout, rollback e pendências

Disponibilizar callable e cliente coordenados no rollout autorizado, com teste de Auth real e observação de erros/custo. O manifesto de índices permanece igual. Rollback deve conservar as rules atuais e reverter somente este incremento; a query SDK anterior continua sujeita ao problema de revogação. Não fazer reset da árvore misturada nem abrir gates para simular conclusão.

P2P ainda exige admissão/sinalização/ACK/fragmentação/retoma e reconciliação de rooms. Retenção/backup/conflitos de identidades, revisão de equipa/writers legados, cloud/segredos/alertas/restauração/pilotos, qualidade, agentes e acessibilidade permanecem no objetivo das fases 0–6. Este incremento não conclui Comms/fase 4/produto. Deploy completo depois de todas as áreas concluídas, conforme autorização humana.
