# Prévia de memórias relacionadas na captura — 29 de outubro de 2026

A prévia do editor deixava `searchMemories` e o fallback lexical percorrer e ordenar a coleção dentro de `useMemo`, a cada alteração do rascunho. Passa a usar um índice local em Worker, com preparação textual reutilizável por documento. A seleção dos quatro resultados e os scores continuam a usar o motor textual existente; não há inferência ou fornecedor externo neste percurso.

## Decisão e privacidade

O cliente verifica o proprietário pessoal ou a equipa selecionada antes de ler texto, título ou outros campos projetados. Exclui conteúdo bloqueado, apagado, de âmbito ambíguo e, no âmbito pessoal, partilhado. A interface só admite equipa de que o titular é membro e cuja rotação está ativa; conta, cofre, equipa, época e ID da chave vinculam a instância do índice.

O cliente prepara referências em tarefas de 256 registos quando a origem muda. Só envia projeções dos objetos alterados e a ordem atual de IDs. Uma consulta nova com o mesmo array imutável não percorre os documentos no cliente, nem reenvia projeções/ordem. O Worker conserva texto preparado e normalizado para os documentos atuais; uma edição unitária normaliza apenas esse documento. O payload não inclui embeddings, UID, envelopes ou anexos. As respostas incluem somente até quatro IDs/scores, ligados de novo às referências atuais e com elegibilidade revalidada no cliente.

O índice contém plaintext autorizado e termina ao mudar conta/cofre/equipa/época, retirar uma chave, abortar, ocorrer timeout/erro ou desmontar o editor. Fonte ou consulta nova retira imediatamente os resultados antigos do render. Um evento de chave impede reutilizar o array retirado até chegar uma origem nova. Não há persistência, rede ou telemetria com o rascunho/conteúdo neste serviço.

O fallback lexical foi conservado, incluindo a sua escala por ocorrências. Corrigiu-se uma divergência: agora respeita os operadores de tag, categoria, entidade e datas da pesquisa primária. Antes, uma consulta sem hits podia voltar a sugerir uma memória excluída por um operador. Um filtro inválido continua sem resultados.

Não criar um índice novo a cada tecla permite reutilizar a preparação textual. Pedidos ainda pendentes são cancelados por terminação do Worker; uma consulta cancelada pode exigir reconstrução no pedido seguinte. A prévia é opcional: uma falha retira sugestões e não fabrica resultados nem impede guardar a memória.

## Validação

- **2.121 testes frontend em 228 ficheiros**, sem falhas/omissões, incluindo 28 testes novos. **46 focados em quatro ficheiros**.
- TypeScript/build Vite e lint dos dez ficheiros do âmbito passaram sem erros/avisos de lint. O aviso de chunks grandes do build permanece.
- Índice: paridade com o ranking textual anterior em 10.000 documentos, desempates, normalização só dos documentos alterados, remoção, fallback lexical, operadores explícitos e limpeza após protocolo inválido.
- Cliente: ACL antes de getters de plaintext, ausência de vetores no payload, isolamento pessoal/equipa, zero projeções na consulta seguinte, uma na edição, cedência mesmo com candidatos excluídos, IDs/scores/respostas inválidas, abort e timeout.
- Hook: retirada imediata por consulta/origem/conta, terminação por eventos pessoais e de equipa, recusa da origem retirada, resposta antiga após cancelamento e cleanup de observadores. O teste de `CognitiveInput` verifica o vínculo à época ativa e a retirada na rotação, mudança de conta ou bloqueio do cofre.
- Chromium executou o hook e cliente reais, Worker compilado sem alterações e CSP nativa. Com 10.000 registos sintéticos/8.240 elegíveis, a primeira seleção demorou **352 ms**, com **60 ticks** de um temporizador de 5 ms. Confirmou paridade e referências originais, reutilização na consulta seguinte, uma projeção por edição, filtros, retirada por chave/conta e terminação dos Workers. Zero pedidos externos encaminhados. A duração é uma observação local.

O browser monta uma interface mínima para o hook; não monta o editor completo. Identidade e eventos de chave são sintéticos. Não exercita Auth, cofre, SDK Firestore, CSS do produto ou aplicação instalada. O teste do componente liga a integração, mas não substitui esse piloto. Não é necessária inferência real para a prévia textual.

A primeira execução de TypeScript recusou o nome `keyEpoch` no registo de equipa (o campo real é `activeKeyEpoch`) e os parâmetros de construtor com propriedades numa configuração `erasableSyntaxOnly`. As correções e a passagem final ficaram preservadas. Os testes iniciais passaram antes desses acertos; só a execução final valida o código final.

## Limites e continuidade

A preparação inicial ou uma nova origem ainda percorre os registos em tarefas; as consultas do Worker continuam lineares, com texto preparado em cache. O payload inicial é agregado, limitado a 100.000 documentos, um milhão de caracteres por campo e 64 Mi de caracteres indexados pelo contrato reutilizado da pesquisa. Estes limites recusam a prévia em vez de truncar a coleção em silêncio. A identidade dos objetos tem de ser imutável, como nos hooks de sessões atuais.

Não foram alterados schema, Rules, Functions ou gates. Os resultados backend/Rules anteriores conservam o seu âmbito; os instaladores não foram recompilados. A inspeção dos métodos antigos de grafo/PageRank não encontrou chamadas de produção e não os alterou. Importações/aprendizagem ainda preparam arrays, outras facetas/vistas, qualidade ampla, migração operacional e pilotos permanecem exigidos.

Prova privada: `W:/real/mnemosyne-launch-evidence/capture-preview-local-validation-20261029.json`, descendente de `semantic-write-local-validation-20261028.json`. O scan do âmbito revê achados esperados e apenas consulta metadata pública de configuração/restrições Firebase, sem payloads de secrets. **Fases 0–6 incompletas, 49 gates fechados, zero deploy e zero chamadas a fornecedores de geração.**
