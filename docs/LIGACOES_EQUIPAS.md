# Ligações manuais entre memórias de equipa

Implementação local de 1 de outubro de 2026. A escrita continua fechada por `TEAM_WRITES_ENABLED=false` e pelo gate administrativo de equipa. Não houve deploy, migração nem alteração de dados reais nesta etapa.

## Operação e ameaças

`changeTeamMemoryConnection` liga ou remove a ligação entre duas sessões vivas da mesma equipa. A interface do detalhe e da sidebar exige confirmação explícita, cofre desbloqueado e revisões confirmadas de ambas as sessões. Conserva a autoria e o timestamp originais. Não faz alterações locais otimistas: a vista partilhada recebe o resultado pelo listener depois do commit.

Cada alteração faz quatro escritas numa transação: duas versões com a cifra/contexto/metadados anteriores exatos e duas sessões com ligações recíprocas, cifra v2 na época ativa e revisão crescente. A preparação decifra localmente o payload estrito e cifra-o novamente com a chave ativa. A transação relê pertença, estado de rotação, época, wrap e ambas as revisões/cifras/ligações. Uma alteração concorrente recusa a preparação antiga; não a reaplica sobre conteúdo mais recente.

Contas diferentes, memórias pessoais, outras equipas, tombstones, rotação pendente, wraps ausentes e contexto de conta/cofre/cache alterado são recusados. O serviço exige IDs distintos, listas únicas sem auto-ligações e no máximo 100 vizinhos. Nunca trunca listas legadas incompatíveis. Uma ligação antiga de um só lado pode ser reparada por esta ação confirmada. Uma operação já satisfeita não escreve, mas ainda confirma acesso e revisões na transação.

## Schema e regras

Cada pai recebe `connectionChange: {id, peerId, operation, actorUid}`: UUID v4 partilhado, ID da outra sessão, `link` ou `unlink` e UID autenticado do ator. A versão copia o marcador anterior, quando existe. O marcador descreve a última alteração manual e não atribui origem retroativa a ligações legadas.

As regras exigem a mudança correspondente do outro pai na mesma transação, mesmo UUID/operação/ator, âmbito igual, sessões vivas, revisão nova e reciprocidade final. Só o vizinho identificado pode ser adicionado/removido; os restantes são conservados. Cada pai passa independentemente pela regra normal de época ativa, autoria imutável e par com histórico exato. Alterar apenas um lado, forjar ator, trocar âmbito ou criar uma sessão com ligações iniciais não vazias é recusado. Edições sem mudança de ligações preservam o marcador; ausência/null e lista vazia são compatíveis para memórias legadas.

Para ficar dentro do limite de avaliação do Firestore, a regra da versão não repete toda a política do pai: exige incremento de revisão e ponteiro novo para essa versão, pelo que o pai tem obrigatoriamente de ser atualizado e autorizado pela sua própria regra. A manutenção histórica não pode mudar revisão ou ponteiro e não contorna esse requisito. Conservam-se as verificações exatas da cifra, contexto e metadados arquivados. Variáveis locais evitam repetir expressões na regra do pai.

## Recuperação e limites

Não há journal persistente desta operação. Um ACK perdido pode deixar a alteração já confirmada no servidor; a revisão antiga é recusada na repetição. A interface deve receber as sessões atuais e o utilizador rever o resultado antes de outra ação. Uma repetição já satisfeita com as revisões atuais não cria mais versões. Mudança de contexto impede sucesso tardio, mas não retrai uma transação já enviada.

O apagamento lógico de uma sessão não remove todas as ligações históricas dos vizinhos. A visualização exclui nós apagados; este serviço só modifica o par explicitamente escolhido. A recifragem histórica conserva ligações e marcadores. O servidor não prova igualdade do conteúdo decifrado; membros atuais já possuem autorização de edição da equipa.

## Compatibilidade, publicação e rollback

As operações leem documentos por ID e não precisam de novos índices. Continuam necessários backfill/índices de âmbito, migração de épocas, restauração isolada, piloto e restantes gates. Clientes antigos que tentem escrever backlinks isolados ou criar sessões já ligadas deixam de conseguir fazê-lo; publicar frontend e regras compatíveis antes de abrir escrita. Ligações legadas não são corrigidas automaticamente.

Rollback: fechar primeiro `config/teamSecurity.writesEnabled`, conservar pares, histórico e épocas; retirar a interface se necessário sem enfraquecer reciprocidade/CAS/histórico. Não reabrir atualizações diretas para acomodar um cliente antigo.

## Validação

Cinco testes do serviço usam AES real e verificam quatro escritas, autoria, contexto de cifra/histórico, reparação legada, no-op, remoção, CAS, limites, isolamento e mudança de conta/cofre/cache. Quatro testes da interface verificam confirmação, seleção pelo âmbito, ACK, recusa e supressão de confirmação tardia. Suite completa frontend: **383 testes em 86 ficheiros**; TypeScript/build passou com **3222 módulos** e os avisos conhecidos de chunks/imports; ESLint do escopo passou.

O emulador usa o serviço/transações reais, Timestamp legado, nova chave legível/antiga recusada, recusa de alteração unilateral mesmo com histórico, âmbito pessoal recusado e duas remoções concorrentes com um único vencedor e sem versões órfãs. Todos os dados/chaves são sintéticos e os wraps do fixture são placeholders. A validação integrada final e os seus limites estão registados em `DECISOES_FASE3.md`; não comprova piloto ou dispositivos reais.
