# Escrita semântica em lotes — validação de 28–29 de outubro de 2026

O cálculo dos vizinhos durante `CognitiveEngine.processMemory` e `findConnections` passa para um Worker temporário. A captura manual e a edição no Universo fornecem candidatos sem construir primeiro uma cópia completa de `MemoryObject`. A integração cumpre parte do item 5 da fase 5; não conclui a escalabilidade nem as restantes fases do prompt mestre.

## Comportamento e âmbito

O cliente verifica a elegibilidade antes de ler ou projetar o embedding. Percorre os candidatos em tarefas de até 128 registos de origem, envia no máximo 128 vetores por mensagem e espera a confirmação antes do lote seguinte. Mesmo um lote só com registos excluídos cede tempo à interface. O Worker calcula o cosseno exato no espaço atual e conserva os sete melhores resultados, com limiar 0,55 e desempate pela ordem de entrada. Não ordena a coleção inteira.

Cada mensagem de candidatos contém apenas ID, vetor e marcador do espaço. Texto, título, UID, posições e agrupamentos ficam no cliente. O vetor da consulta também é sensível e só existe neste Worker enquanto a operação decorre. A metadata dos sete selecionados determina o agrupamento e o centroide no cliente, preservando a ordem de soma anterior. Vetores legados ou incompatíveis não são comparados com o modelo atual. Registos elegíveis sem vetor continuam a contar para a classificação e importância, como antes.

O Worker termina no fim, em erro, timeout ou cancelamento. Respostas com IDs desconhecidos, duplicados, sequência errada, scores inválidos ou desempates fora da ordem são recusadas. Os observadores de chave são instalados antes de pedir o embedding; uma alteração de chave rejeita o resultado tardio. Este observador não cancela, por si só, a inferência em curso no serviço de embeddings; a política de reset desse serviço conserva o seu âmbito anterior.

Na edição do Universo, uma revisão da publicação dos candidatos protege a operação inteira. Uma publicação durante a edição, incluindo uma publicação de metadata sem alteração material, invalida o resultado antigo antes de guardar. A verificação é deliberadamente conservadora: o utilizador pode precisar de repetir a edição. Falhas normais de inferência com âmbito ainda válido conservam o comportamento de metadata semântica pendente; uma revisão ou autorização ultrapassada recusa a escrita.

A captura continua a guardar conexões inferidas como lista vazia, seguindo o fluxo existente de revisão. Não foram introduzidas arestas recíprocas automáticas.

## Validação

- **2.093 testes frontend em 225 ficheiros**, sem falhas ou omissões; **93 focados em seis ficheiros**, incluindo 27 testes novos.
- TypeScript e build Vite passaram; lint dos 16 ficheiros do âmbito sem erros ou avisos. O aviso de chunks grandes do build permanece.
- Testes do índice com 10.000 candidatos comparam a seleção com cosseno e ordenação completos; cobrem empates entre lotes, espaços/dimensões inválidos e protocolo recusado.
- Testes do cliente cobrem exclusão antes de ler vetores, lotes, alteração de âmbito, chave retirada durante inferência, abort, timeout, respostas inválidas e operações concorrentes isoladas. O hook recusa guardar o resultado antigo quando a coleção muda durante a edição.
- Chromium executou o motor e cliente reais com o Worker compilado sem alterações e a CSP nativa. Dos 10.000 registos sintéticos de 384 dimensões, 8.240 eram elegíveis e 8.040 tinham espaço compatível. Os 79 lotes conservaram paridade de IDs, centroide, agrupamento, importância e marcador do modelo. Medição desta execução: **216,8 ms**, com 38 ticks do temporizador de 5 ms. É uma observação local, sem promessa de latência em outros dispositivos.
- O browser confirmou origem vazia sem criar Worker, rejeição do embedding tardio e cancelamento após um lote. Ambos os Workers criados terminaram. Zero pedidos externos encaminhados.

O browser usa vetores e eventos de chave sintéticos. Não executa inferência real do modelo, autenticação, cofre, SDK Firestore ou aplicação instalada. A inferência real multilingue pertence à evidência anterior. Os mocks unitários do Worker executam o índice real com mensagens clonadas, mas não medem o escalonamento nativo.

As tentativas iniciais ficaram preservadas: a primeira revelou a remoção incorreta de uma constante também usada na análise de anomalias; a segunda revelou uma importação `waitFor` em falta no teste novo. Ambas foram corrigidas e as verificações finais repetidas. Não são falhas preexistentes.

## Limites e continuidade

A elegibilidade/projeção ainda percorre a origem inteira em tarefas limitadas; a comparação exata continua linear dentro do Worker. Os vetores dos candidatos são reenviados em cada escrita. Não há índice global persistente nem pesquisa aproximada neste percurso. Importadores e serviços de aprendizagem que preparam arrays antes de chamar o motor ainda precisam de revisão; os seus cossenos passam pelo novo Worker, mas essa preparação não foi alterada. Construção de grafo, PageRank e análise de anomalias conservam os seus percursos síncronos.

Carregamento inicial, facetas, outros percursos de pesquisa, qualidade ampla, migração operacional e pilotos continuam exigidos. A candidata de classificação de relevância anterior continua recusada. Functions/Rules não foram alterados nem repetidos neste incremento: os 594 testes gerais e 322 + 23 testes de Rules são evidência anterior. Downloads e artefactos nativos são conservados; os instaladores anteriores não incluem este novo build web.

A prova privada `W:/real/mnemosyne-launch-evidence/semantic-write-local-validation-20261028.json` vincula fontes, build, testes, browser, scan e a prova anterior `memory-views-local-validation-20261028.json`. O scan revê os achados esperados e consulta apenas metadata pública de configuração/restrições Firebase, sem payloads de secrets. **49 gates fechados, fases 0–6 ainda incompletas, zero deploy e zero chamadas a fornecedores de geração.**
