# Revisão de memórias pessoais aprendidas — 9 de outubro de 2026

## Continuação: protocolo recuperável

O percurso local sem recibo descrito abaixo é histórico. A continuação usa baseline capturada ao apresentar o resultado pessoal, versão Firestore, diário cifrado e transação no servidor com arquivo/recibo/orçamento. O contrato atual, cronologia da validação e limites estão em [REVISAO_PESSOAL_RECUPERAVEL.md](REVISAO_PESSOAL_RECUPERAVEL.md). O estado geral conserva as fases pendentes; esta substituição não prova equipas, recuperação entre instalações ou lançamento.

## Incremento anterior

O percurso de revisão em `learningService` usava `updateDoc` depois de calcular embeddings e cifrar. Uma alteração durante esses awaits podia ser substituída; a versão anterior não era arquivada. Sem contexto de geração, esse percurso também não verificava o dono, a partilha ou o âmbito antes de escolher a cifra pessoal.

`personalLearnedRevision` lê o documento do servidor e exige dono atual, `teamId:null` explícito, ausência de partilha/tombstone e revisão numérica válida. Verifica a leitura com o cofre atual antes da inferência. A conta e o cofre são observados durante toda a operação; uma mudança e regresso permanece recusada. O contexto de geração acrescenta a sua guarda de âmbito/política.

Preparação semântica e cifra ocorrem antes da transação. A transação compara novamente o documento completo capturado, incluindo cifra, anexos e metadados quando o timestamp não muda. Guarda uma versão com conteúdo anterior cifrado e atualiza o conteúdo/semântica/revisão atomicamente. Conserva dono, âmbito, timestamp inicial, anexos, tags, categoria, ligações e origem de aprendizagem no pai; apenas acrescenta `learning.revisedAt`. Limpa projeções derivadas antigas e prompts legados no pai. O arquivo segue os campos permitidos pelas regras existentes; não é uma cópia integral de todos os campos históricos.

A revisão de equipa continua a usar a chave/época e transação de equipa. Uma memória partilhada ou de equipa nunca passa por esta cifra pessoal. Sessões antigas sem `teamId:null` explícito exigem a migração já definida. Histórico em texto claro, quando permitido pelo âmbito e legível, é cifrado localmente antes de arquivar.

Passaram 36 testes focados de revisão/geração/anexos e o build TypeScript. Foi acrescentado um teste com o serviço real no emulador: duas preparações concorrentes, um único commit/arquivo, preservação de ligações e origem, alteração concorrente sem timestamp e eliminação da conta. Passaram 758 testes frontend/128 ficheiros, build web e lint zero erros/23 avisos anteriores. O emulador passou os 147 testes Functions; o cliente passou os 23 depois de corrigir a fixture Node que precisava de window e btoa/atob. As duas falhas de fixture foram conservadas. Resultados e hashes estão no estado do lançamento e na prova privada de 9 de outubro.

Limites: a comparação cobre o período entre a leitura inicial e o commit. A UI ainda não envia uma revisão capturada quando abriu o rascunho. Uma falha de ACK depois do commit é propagada; este incremento não acrescenta diário/recibo persistente para essa revisão nem afirma recuperação após reinstalação. Esses requisitos, outros escritores e todas as fases 0–6 permanecem em execução. Não houve deploy ou mutação de produção.
