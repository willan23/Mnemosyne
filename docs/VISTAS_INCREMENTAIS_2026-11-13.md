# Vistas incrementais e transporte para o Worker — 13 de novembro de 2026

A lista e a cena 3D deixaram de reconstruir um Map e um array de ordem completos em cada nova publicação persistente. O cliente usa o histórico de deltas das raízes para enviar só documentos alterados, remoções e movimentos de ordem. O lookup de resultados usa acesso por ID à raiz, sem copiar o cofre. Se o histórico tiver sido descartado ou a origem não partilhar a mesma raiz/versão, uma transferência inicial controlada repõe o estado atual. Arrays imutáveis externos conservam a comparação por referência, com preparação em tarefas; essa alternativa ainda percorre o array quando a sua identidade muda.

O protocolo v2 confirma cada cabeçalho e cada lote antes de avançar. Dados, IDs de ordem, movimentos, remoções e IDs de filtro usam frames de até 128 entradas. Contagens, posições, fases, capacidade de 100.000 documentos, mensagens repetidas e transferências incompletas são validadas. Uma réplica parcial não responde a pesquisas e é descartada em caso de erro. O Worker de produção recusa o formato v1; o adaptador v1 interno do índice serve a cobertura unitária do núcleo.

A ordem no Worker usa uma árvore implícita, permitindo movimentos por ID/posição sem deslocar o array inteiro. A seleção mantém a ordenação estável da lista e as prioridades, filtros e orçamento da cena. O top-K recebe um iterador, sem arrays intermédios do tamanho do cofre. Os filtros são transmitidos em lotes e a mesma referência imutável reutiliza o conjunto já preparado, inclusive após uma edição de memória. A pesquisa exata ainda percorre candidatos no Worker.

Os documentos de pesquisa contêm apenas os campos necessários à vista. Texto e título bloqueados não são lidos; a cena não recebe texto de pesquisa das memórias. UID, embedding, posições, cifra e chaves não fazem parte da projeção. O Worker não persiste dados nem contacta fornecedores. O texto desbloqueado usado pela pesquisa local continua a ser dado sensível no dispositivo. O lookup público é apenas de leitura: uma nova seleção retira imediatamente a referência anterior, e a geração, o âmbito e os iteradores suspensos são verificados em cada acesso.

O tamanho de lote de texto tem um alvo suave de 65.536 unidades UTF-16. Um documento individual maior segue sozinho e conserva todo o conteúdo; o teste encontra um termo colocado após 80.000 caracteres. Esse alvo não é um limite rígido de bytes por mensagem. As páginas de resultados ainda respeitam o limite solicitado pela interface; a virtualização completa e outros consumidores lineares continuam por avaliar.

O ensaio com o cliente, publisher e Worker compilado reais passou com 100.000 memórias sintéticas sob a CSP do desktop. A carga inicial fez duas iterações da origem; a edição seguinte fez zero, transmitiu um documento e dois movimentos, sem array completo de IDs. Os lotes máximos foram 128 documentos, 128 IDs de ordem e 128 IDs de filtro. A cena coincidiu com o ranking de referência, um filtro com 50.000 IDs foi reutilizado, a recuperação após expirar o histórico passou e um ACK real retido foi ignorado depois do cancelamento e da criação de um novo transporte. Quatro Workers foram criados e terminados, sem pedidos externos ou erros de página.

| Percurso medido | Tempo local | Maior intervalo do heartbeat |
| --- | ---: | ---: |
| Carga e consulta da lista, 100.000 registos | 1475.2 ms | 13.5 ms |
| Edição e consulta seguinte da lista | 86.5 ms | 10.6 ms |
| Carga e consulta inicial da cena | 1582.9 ms | 11 ms |
| Edição e consulta seguinte da cena | 161 ms | 10.8 ms |

Os intervalos medidos cobrem o cliente/Worker; a construção sintética inicial do publisher e a preparação do oracle estão fora desses intervalos. O corpo de texto sintético é curto. Não se mediu aqui o uso de memória de um cofre representativo, a inferência multilíngue, a aplicação completa, Auth real ou clientes nativos instalados. Estes números não são um SLO.

O ensaio da interface usa agora o Worker compilado servido como ES module, em vez de um harness sem a rota do Worker. Passaram a paginação da lista e tabela, foco na primeira linha nova e na última página, pesquisa e seleção por Enter, modal nativo, retenção de foco, fundo inerte, Escape, viewport de 375 px e texto a 200%. CSS e fonte Inter do produto foram usados, com AES/IndexedDB/WebLocks reais e Auth sintética. A aceitação com leitor de ecrã e Tauri/Capacitor reais permanece pendente.

Passaram **2306 testes frontend em 240 ficheiros**, **63 focados em 5 ficheiros**, TypeScript/build/identidade, lint sem erros e com 21 avisos anteriores, 23 contratos de publicação e auditorias de produção sem vulnerabilidades nos dois packages. As 240 fontes e 314 artefactos inalterados do backend/regras foram conferidos por hashes; os testes Functions/Rules da prova anterior são reutilizados, sem nova execução.

As tentativas anteriores ficaram preservadas: um fixture do hook ainda respondia em v1, e a primeira validação geral foi interrompida para corrigir o gerador determinístico, que passou a usar bits superiores e a comprovar que visita as quatro operações. A passagem final conservou as fontes sem alterações durante a execução.

Continuam por tratar seleção/relacionadas do detalhe e sidebar, conversões para insights, contadores do cabeçalho, preparação de grafos, carga/churn e avaliação semântica representativa, além de rollout, CI e instaladores finais. A fase 5 e a conclusão global das fases 0–6 permanecem abertas. Os 49 switches de publicação continuam fechados; não houve deploy nem chamadas pagas. Evidência: `W:/real/mnemosyne-launch-evidence/memory-view-deltas-20261112/`, ligada à prova `memory-view-deltas-local-validation-20261113.json`.
