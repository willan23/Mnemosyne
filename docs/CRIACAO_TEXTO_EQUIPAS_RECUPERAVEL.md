# Criação textual de equipa com pedido cifrado recuperável

Implementação local de 13 de outubro de 2026. O gate de equipa continua falso. A conclusão das fases 0–6 precede o deploy completo autorizado; [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md) regista os critérios ainda pendentes.

## Percurso integrado

`CognitiveInput` e `learningService` deixam de criar memórias textuais de equipa por `persistTeamSession`. Passam a chamar `createTeamMemory` e só usam o ID devolvido depois de confirmar o recibo. Não geram um ID de apresentação ou tentam uma escrita pessoal como fallback. O helper SDK anterior não tem mais callers de produção, mas a manutenção histórica e as ligações ainda têm contratos próprios.

A geração e a captura manual verificam o gate antes de gastar inferência. O destino é o âmbito capturado: UID, equipa, época e ID da chave. O cliente relê a equipa, recusa rotação/pedido pendente/pertença ausente ou época diferente antes de cifrar e usa AES-GCM v2 com AAD de equipa/época/ID. A captura de edição do resultado aprendido ocorre sobre o ID realmente confirmado; falha na captura conserva esse ID e assinala a revisão como indisponível.

O texto e título são cifrados no cliente. Metadados permitidos continuam em claro e sensíveis, como no contrato de produto; não são tratados como anónimos. Sincronização do cofre textual transporta a cifra mesmo sob `never-cloud`. Essa política continua a bloquear envio de texto/prompts/chaves e inferência por fornecedores externos. Transferências de anexos conservam a autorização própria de cloud e o gate de anexos; criação textual não depende desse gate.

## Contrato e atomicidade

`createTeamMemory`, callable em `europe-west1`, recebe `{actorUid, request}` e liga ator capturado ao token antes de limites ou acesso à base. Usa o mesmo pedido de criação:

- UUID de sessão estável, equipa, época e ID da chave;
- envelope `enc:{v:2,iv,ct}`, `attachmentIds:[]` e metadados tipados;
- sem plaintext, mnemónica, chave, URLs de ficheiros, parent ou ligações iniciais não vazias.

O parser mantém a forma/canonicalização dos pedidos pessoais e com anexos; passa a aceitar equipa com zero anexos. O diário `mnemosyne:attached-memory-creation:v1:<uid>`, cifrado pelo cofre pessoal, conserva pedido/UUID/cifra antes da chamada. A nova rota é explícita: `createTeamMemory` para texto de equipa, `createPersonalMemory` para texto pessoal e `createAttachedMemory` quando existem anexos.

O servidor relê conta/marcadores, equipa, owner, pertença, gate operacional, estado de rotação, época ativa e wrap. Cria atomicamente a sessão, recibo imutável de criação, recibo de uso e atualização do consumo do ator. Texto/título remotos permanecem vazios/`null`; timestamp/autoria são do servidor/token. Não é necessária configuração de anexos nem entitlement de upload para texto sem anexos. Mantém o limite mensal vigente da conta e 20 admissões por minuto/UID nesta rota. Limites/custo globais do projeto continuam a exigir a fase 2.

Tentativas concorrentes do mesmo pedido devolvem um único recibo e debitam uma vez. Outro pedido sob o mesmo UUID, outro ator ou digest diferente é recusado. `createPersonalMemory` não aceita a nova forma de equipa; não há downgrade de âmbito.

## Recuperação e contexto tardio

Criação confirma o mesmo recibo duas vezes antes de remover o diário próprio. Os callers de equipa fornecem também uma verificação assíncrona de acesso antes dessa limpeza: perda de pertença/época depois de um ACK conserva o pedido, sem afirmar sucesso na vista antiga. Recuperar o pedido mais tarde não depende dessa vista ou de uma nova geração.

`getAttachedMemoryCreationStatus` e `cancelAttachedMemoryCreation` continuam disponíveis com admissão fechada. Recibo próprio terminal é recuperável após rotação/remoção. Pedido ainda desconhecido pode ser cancelado permanentemente; retry tardio não cria conteúdo. Revogação definitiva sem recibo pode devolver `revoked` sem criar referências. O painel encerra apenas o pedido próprio confirmado e conserva os ficheiros e rascunhos. Conta do próprio ator eliminada continua recusada.

Web Locks, readback dos bytes, UID/cofre/geração/política e guards da edição impedem troca de pedido, limpeza de outra conta e respostas tardias. Não há novo UUID, nova cifra ou inferência na recuperação.

## Validação e rollout

Evidências locais: `W:/real/mnemosyne-launch-evidence/team-text-creation-validation-20261013/`. Testes dos callers verificam âmbito/época, ID confirmado, ausência de SDK writes/fallback pessoal e bloqueio antes de inferência. A factory real do cliente produz pacotes ligados ao ator e cifra v2 decifrável somente com o contexto AAD correto.

O ensaio Chromium usa factory/pacotes reais, AES do cofre/equipa, localStorage, Web Locks e executor de servidor real, com Auth/acesso às chaves/base sintéticos. Confirma ACK perdido/reload, recuperação com gate fechado após remoção, ausência de segundo uso/memória, token trocado sem memória/diário de outro UID, cancelamento e revogação sem referências. Emulador demo verifica transações reais, quota, concorrência, época/rotação/gates/contas e recuperação. O ensaio não equivale a um piloto com membros e dispositivos reais.

Servidor/parser e comandos de recuperação devem existir antes do cliente. Um rollback deve conservar a aceitação da forma equipa/zero anexos e os leitores do diário v1/status/cancelamento. Não há novos conjuntos privados ou índices; aproveita os recibos/purgas da criação existente. As regras globais de criação SDK não foram fechadas neste incremento. Ligações recíprocas, manutenção/migrações/cutover e pilotos continuam a impedir concluir a fase 3.
