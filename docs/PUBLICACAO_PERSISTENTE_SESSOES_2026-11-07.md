# Publicação persistente de sessões e prévia por deltas — 7 de novembro de 2026

O percurso principal de `useSessions` publica uma coleção imutável com partilha estrutural. Depois de atualizar os IDs afetados nas árvores ordenada e por ID, publicar a nova versão não enumera nem copia os restantes objetos. A prévia de captura consome o mesmo registo de deltas. O Universo e outros consumidores ainda não foram todos migrados; a fase 5 e o lançamento completo permanecem abertos.

## Coleção e autorização

Os nós persistentes não têm referências a pais mutáveis. Cada versão conserva os seus objetos/ordem, com acesso por ID e posição em tempo esperado logarítmico. O facade é explicitamente uma coleção readonly, não um Array nativo: `Array.isArray` devolve falso. Oferece leitura indexada, métodos readonly, janelas e serialização explícita, e recusa mutações. Atribuí-lo ao estado não induz o Immer a enumerar os documentos.

Contagens de linhas ativas e de memórias pessoais legadas ficam nas árvores derivadas. Etiquetas/categorias são contadas pelos IDs canónicos alterados; uma alteração só de texto conserva os mesmos catálogos. A pesquisa resolve por ID apenas os candidatos/hits devolvidos pelo Worker, evitando construir mapas completos em cada consulta. As assinaturas de leitura dos consumidores aceitam readonly; esta adaptação de tipos não elimina por si só os seus percursos lineares.

O journal guarda IDs e movimentos, sem versões antigas de plaintext, até 64 revisões e 200.000 unidades de IDs/movimentos. Uma lacuna obriga a uma preparação inicial guardada. Limpar o âmbito retira todas as versões antigas e os iteradores, inclusive numa troca de objeto Auth com o mesmo UID. Na troca de memberships, a passagem excecional pela lista anterior aplica ACL e só conserva os registos ainda autorizados enquanto chegam os novos listeners. Não é o percurso de cada escrita.

Uma publicação recusada retira também os catálogos e os índices do âmbito anterior. Metadata de recursos que não pode ser indexada retira a publicação, em vez de conservar etiquetas antigas. O teste reproduz timestamp não finito, retirada da vista/catálogos e retry do bucket. Um índice retirado não é reativado implicitamente; a recuperação global dos índices exige a substituição do âmbito.

## Prévia de captura

O cliente usa os IDs alterados e os movimentos do snapshot; só projeta plaintext depois de confirmar ACL. Um registo excluído ocupa uma posição null no Worker, sem transmitir o seu ID ou campos. Remoções de documentos antes autorizados purgam o índice. A ordenação relativa e os operadores da pesquisa mantêm a paridade com o cálculo completo autorizado, inclusive em revisões agregadas, tombstones e expiração do journal.

O índice textual pertence à duração da chave/âmbito e permanece em memória entre rascunhos, incluindo consultas curtas. A atualização da origem é aplicada mesmo com consulta curta quando já existe Worker. Um rascunho cancelado pode terminar a transferência em curso, limitada pelo timeout de 30 segundos, para deixar o índice coerente; o hook oculta imediatamente os resultados desse rascunho e os pedidos cancelados em fila são omitidos. Perda de âmbito/chave, unmount, timeout ou protocolo inválido terminam o Worker. Uma resposta inválida é recusada mesmo depois de cancelar o rascunho. Não há armazenamento persistente deste plaintext.

A primeira origem, Arrays nativos e a recuperação depois de uma lacuna ainda exigem uma passagem em lotes no cliente. O envio inicial de documentos para este Worker continua numa mensagem; o ranking e as operações lineares de ordem permanecem no Worker. Não se declara removido todo o trabalho O(N) do produto.

## Validação e limites

Passaram **2246 testes frontend em 237 ficheiros**, **123 focados em 8**, TypeScript/build, identidade, lint com zero erros/21 avisos preexistentes, 23 contratos de CI/publicação e auditorias apenas de dependências de produção sem vulnerabilidades nos dois packages.

O Chromium executou o publisher/cliente reais e o Worker compilado sob a CSP nativa com 10.000 registos sintéticos, 5.000 autorizados. A publicação leu zero timestamps; a edição fez 114 leituras para reordenar, três verificações de UID, uma projeção e dois movimentos, sem reenviar a ordem completa nem ler plaintext de registos inalterados. Confirmou versões anteriores, contagens derivadas, identidade do catálogo, paridade, reutilização em rascunhos curtos, tombstones, posições anónimas e retirada. Criou/terminou um Worker e encaminhou zero pedidos externos. Os tempos (231.6 ms iniciais; 19.6 ms na edição, gap de heartbeat 27.6 ms) são observações locais, sem SLO. Auth, modelo, cofre e aplicação nativa completos não foram exercitados por este ensaio.

Os três ensaios anteriores de escrita indexada/coortes/Universo também passaram com o build atual. Functions/Rules mantêm as fontes e artefactos anteriores por hashes: 607 unitários (uma omissão prevista fora do emulador), 328 Functions/Rules +25 frontend/Rules. Não foram novamente executados para este incremento frontend.

As tentativas falhadas foram conservadas: o primeiro harness acrescentava um ID sem o movimento de inserção; a suite geral seguinte teve 2.245 aprovações e uma falha na espera de foco da lista. Esse caso passou isoladamente. A espera do teste passou a verificar o botão/título antes de calcular o nome acessível; mantém as mesmas asserções para as duas páginas/modos. A suite geral foi repetida integralmente e passou. Um runner intermédio recusou a execução de lint por o diretório de configuração estar errado; foi corrigido no runner seguinte. As falhas não contam como aprovações. Build e browsers aprovados foram reutilizados apenas após comparar todas as fontes runtime por hash; só o teste de foco mudou.

## Trabalho ainda necessário

- Migrar a publicação do Universo e as alterações otimistas, conservando os bindings e a proteção contra ressurreição por snapshots atrasados.
- Levar deltas aos restantes consumidores da UI/jobs e rever o envio inicial; os métodos readonly legados continuam a poder enumerar a coleção.
- Implementar compactação/recuperação da fila dos índices de longa duração; o limite atual ainda pode retirar o índice antes da primeira consulta.
- Concluir os critérios de qualidade, migrações/compatibilidade, índices/TTL/secrets/alertas e pilotos/rollout das fases 0–6.
- Reconstruir, assinar e ensaiar os clientes Windows/Android da revisão final, e obter a CI remota sobre essa revisão quando o operador resolver a limitação externa.

Os 49 switches ficam fechados; não houve deploy, chamadas generativas pagas ou mutações Firebase/GCP. A autorização de deploy completo fica conservada para depois de cumprir o escopo. Prova privada: `W:/real/mnemosyne-launch-evidence/memory-snapshots-local-validation-20261107.json`. Logs, fontes anteriores e snapshots de verificação ficam em `memory-snapshots-20261106/`. O rollback pode repor os ficheiros anteriores preservados, com novo build/validação; os binários antigos não devem ser rotulados como esta revisão.
