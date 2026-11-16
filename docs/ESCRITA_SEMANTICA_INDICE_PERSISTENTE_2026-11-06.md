# Índice persistente para escrita semântica — 6 de novembro de 2026

## Problema e decisão

A captura manual enviava de novo todos os vetores elegíveis para um Worker criado por escrita. O cosseno já corria fora da UI, mas a projeção, cópia e transporte de todo o corpus repetiam-se no thread principal. A nova candidata conserva um índice semântico durante o mesmo âmbito de `useSessions` e alimenta-o com os patches autorizados que já são produzidos pelas subscrições.

O fluxo liga `useSessions` → `IndexedSemanticWriteCorpus` → `indexedSemanticWriteWorker`. A captura manual de `CognitiveInput` usa a fábrica comum `semanticCandidateEligibility`; o seletor reconhece a associação da coleção publicada e escolhe o índice. Uma consulta seguinte envia apenas o vetor da pergunta. Uma alteração envia apenas os registos desse patch. O carregamento inicial envia no máximo 128 registos por mensagem, aguarda confirmação e cede entre lotes.

O índice aplica no Worker o mesmo resolvedor de fontes e ordenação descendente da publicação de sessões. Conserva prioridade, ordem estável nos empates, movimentos sem mudança de objeto e a precedência de duplicados. Um duplicado vencedor que não seja elegível não faz regressar uma versão anterior. O cosseno continua exato, com o mesmo limiar e sete vizinhos; não se introduziu pesquisa aproximada ou alteração do modelo.

## Âmbito, privacidade e falhas

A associação é local, num WeakMap, entre a coleção publicada, o seu proprietário, revisão e tamanho. Uma coleção antiga não é adotada depois de outro patch. O UID do pedido deve coincidir com o proprietário e a equipa tem de pertencer ao âmbito capturado. A fábrica de elegibilidade é identificada pela própria função; um predicado arbitrário não é presumido equivalente a uma partição do índice.

A elegibilidade é verificada antes de ler/copiar o vetor. O Worker recebe IDs, timestamps, vetores do espaço atual e partições opacas; não recebe texto, título, anexos, cifra, posições, UID, IDs de equipa, mnemónica ou credenciais. Os embeddings continuam a ser dados sensíveis. Registos legados ainda contam como memórias, mas os vetores de outro espaço não entram no cosseno atual.

Alterar a chave pessoal ou uma teamKey termina o Worker sincronamente no callback existente de invalidação. Cleanup da subscrição termina a réplica ao mudar de conta/âmbito. As operações em curso conservam também as guardas de contexto já existentes. Remover uma fonte avança a revisão, retira resultados antigos e publica a remoção para o Worker. A leitura da referência final revalida a elegibilidade dos até sete candidatos.

Pedidos concorrentes são serializados. Um cancelamento local recusa a resposta e permite outra consulta sem reconstruir o índice; não cancela retroativamente trabalho local que o Worker já admitiu. Timeout, erro de protocolo ou resultado incompatível retiram a réplica. A admissão tem limites de 100.000 documentos resolvidos, 256 patches e 200.000 alterações pendentes; exceder um limite retira o enriquecimento em vez de conservar um índice incompleto. Não há fallback de fornecedor cloud neste módulo.

O Worker pode percorrer os vetores para calcular o cosseno; esse percurso está fora da UI. Permanece residente até à retirada do âmbito. O transporte em lotes não elimina o consumo de memória de uma réplica; esta passagem não mede dispositivos móveis ou uma memória física máxima de produção.

## Validação

- **105 testes focados**, seis ficheiros: paridade com ordenação integral de 10.000 vetores, reuso sem enumeração da origem, um delta por edição, precedência/empates, isolamento, alteração de chave através do hook, cancelamento/ACK tardio, timeout e recusa de resultados/protocolos inválidos.
- Suite geral frontend: **2183 testes/233 ficheiros**. TypeScript/build e identidade de versão aprovados; lint **0 erros/21 avisos**.
- Chromium com o Worker final compilado, cliente real e CSP nativa: **10.000 registos, projeção inicial de 10.000 vetores, zero numa consulta repetida e um após editar um registo; zero enumerações da origem no seletor, lotes máximos de 128 e paridade com a ordenação integral. Nesta máquina: índice inicial 250.2 ms, consulta repetida 26.7 ms e edição incluindo publicação 173.9 ms; 79 ticks, intervalo máximo 14.1 ms e 0 tarefas longas reportadas na janela medida**. Usou identidades e vetores sintéticos de 384 dimensões, sem inferência, Auth/cofre completo ou dispositivo nativo. Os tempos são específicos desta máquina.
- Contratos CI/publicação: **23 aprovados**. Auditorias de produção: zero nos dois packages.

Functions/Rules da prova anterior foram conservadas por hashes de fontes/artefactos; não houve alteração de contrato servidor, esquema, Rules ou índices. Não foram novamente executadas neste incremento. A execução remota da CI continua dependente da regularização da conta GitHub; o novo ensaio Chromium foi acrescentado ao job frontend sem condição ou tolerância a erro.

## Trabalho ainda necessário e rollback

Esta alteração está ligada à captura manual alimentada por `useSessions`. Importações, aprendizagem, edição no Universo e outros chamadores que capturam coleções próprias ainda usam o percurso em lotes anterior. A materialização/publicação dos arrays, filtros derivados e restantes consumidores da UI também continuam a exigir migração para deltas. **Não se declara encerrada a fase 5.**

Não há migração persistente. A réplica é volátil e recriada pelo âmbito. O rollback do cliente retira a associação e volta ao seletor anterior, com o custo linear que esta alteração reduz. Novos leitores de `IncrementalMemoryPublication` obtêm referências atuais por ID; a sua iteração ordenada é usada sincronamente pelo Worker, não como snapshot assíncrono independente.

Os switches de release permanecem fechados. O build web novo torna os instaladores anteriores ainda desatualizados face às fontes; não se alteram fingerprints para aprovar esses binários. Prova consolidada: `W:/real/mnemosyne-launch-evidence/semantic-write-index-local-validation-20261106.json`. Logs e inputs: `W:/real/mnemosyne-launch-evidence/semantic-write-index-20261106/`. Nenhum deploy, escrita de produção ou chamada de inferência cloud pertence a este incremento.
