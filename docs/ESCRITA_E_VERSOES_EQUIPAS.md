# Escrita e versões de memórias de equipa

Atualização local de 13/10/2026: resultados aprendidos no compositor usam agora [revisão com base capturada e diário cifrado recuperável](REVISAO_EQUIPAS_RECUPERAVEL.md). O helper SDK conserva também aprendizagem, entidades, parent/taxonomia/projeto e fornecedores/modelos na projeção histórica explícita; as regras comparam esses campos com o pai anterior. A descrição abaixo conserva o contrato histórico da transação SDK; outros callers ainda precisam de intenções recuperáveis e validação de plataforma.

Estado: implementado e ensaiado localmente em 30 de setembro de 2026. Não publicado. A fase 3 continua aberta.

## Ameaças e decisão

Uma sessão cifrada pode continuar exposta a perda de atualizações, atribuição falsa de autoria, alteração de âmbito ou utilização de uma chave de um membro removido. Aceitar um envelope por si só não comprova a sua época nem a pertença atual. Guardar uma versão e o pai em pedidos separados também permite perder o histórico numa falha parcial.

O novo serviço `frontend/src/services/teamSessionPersistence.ts` prepara o conteúdo a partir da equipa lida do servidor e confirma a mesma época numa transação que lê equipa, sessão e documento de época. A revisão carregada pelo cliente é obrigatória para editar. Uma revisão diferente provoca conflito, sem sobrescrever a alteração concorrente. Uma criação sem sessão existente atribui a autoria ao utilizador autenticado.

Não se aceita voltar a cifrar um placeholder bloqueado nem mover uma memória pessoal para uma equipa por atualização de `teamId`. Também não se resolve um conflito repetindo automaticamente com a revisão mais recente: é necessário voltar a carregar e rever o conteúdo.

## Invariantes e schema

| Elemento | Contrato |
| --- | --- |
| Sessão de equipa | `teamId`, `keyEpoch`, `keyId`, envelope `enc.v=2`; texto vazio e título nulo na nuvem |
| Contexto criptográfico | AES-GCM autentica equipa/época/ID como AAD; selecionar a chave da época ativa |
| Autoria | `uid` e `timestamp` originais conservados ao editar/apagar, inclusive por outro membro |
| Revisão | `updatedAt` numérico, estritamente crescente; Timestamp legado convertido apenas para comparação |
| Revisão na interface | `persistedUpdatedAt`, apenas local, conserva a revisão lida antes da edição |
| Versão anterior | Subdocumento `versions/{id}` com ciphertext e contexto anteriores exatos, `previousUpdatedAt` original, `editorUid` e `createdAt` iguais à nova revisão |
| Ponteiro | `lastVersionId` no pai referencia a versão criada no mesmo commit |
| Apagamento | Só owner, `deletedAt = updatedAt`, com a mesma transação e versão anterior |
| Bloqueio administrativo | `config/teamSecurity.writesEnabled`; ausente/falso recusa criação, edição e tombstone de equipa |

As regras exigem pertença atual, estado ativo sem pedido pendente, época/ID coincidentes e wrap do utilizador na época ativa. Recusam contas em apagamento; `deletionState` é propriedade do servidor. A versão não pode ser criada isoladamente, alterada depois nem declarar ciphertext/contexto diferentes do pai anterior. As regras comparam também os metadados históricos permitidos. Só se copiam tags, categoria, anexos existentes, embedding/modelo, ligações, cluster, posição, importância, tipo celestial e método; não se copiam prompts ou campos arbitrários.

Sessões legadas com `enc.v=1` podem ser editadas quando o cliente possui a chave necessária: a versão arquiva v1 na época 1 com `keyId:null`, e o novo pai usa v2/época ativa. Um Timestamp legado no pai é conservado como timestamp de criação e como revisão bruta na versão. A compatibilidade não autoriza criação nova com v1, plaintext ou sem âmbito explícito.

O apagamento físico de sessões de equipa pelo cliente foi fechado: a operação de interface passa pelo tombstone do owner. A purga administrativa permanece responsabilidade do servidor. Este fluxo não fornece restauro/undelete; uma sessão já apagada não pode ser editada por ele. O apagamento lógico conserva ciphertext e versões, e não apaga cópias externas ou anexos.

## Cliente, confirmação e falhas

O coordenador vigia UID, estado do cofre, eventos de mudança e geração da cache antes/depois de preparar, dentro da transação e depois do ACK. Trocar conta, bloquear cofre ou substituir a cache recusa a confirmação tardia. Uma operação já enviada pode terminar no servidor: estes controlos impedem confirmar/publicar o resultado no contexto novo, não retiram um pedido já comprometido.

`useUniverseMemories` passa edições/apagamentos de equipa pelo coordenador. Detalhe, sidebar cognitiva e modo de estudo só alteram a representação local depois de `onSave` resolver. Os dois painéis de apagamento esperam pelo callback antes da animação/remoção; uma recusa conserva a memória. O temporizador não fecha uma seleção posterior. Logout, erros pessoais de persistência e recusas de equipa são propagados como erros fixos; os objetos de erro recebidos não são registados neste fluxo.

As ligações diretas da memória editada são conservadas na transação. Em 1 de outubro foi implementada a operação manual confirmada de ligação/remoção recíproca com duas sessões e dois históricos na mesma transação: [LIGACOES_EQUIPAS.md](LIGACOES_EQUIPAS.md). A edição simples não faz backlinks não versionados; mudanças de ligações exigem o par.

## Ensaio e limitações da evidência

- Suite completa frontend: **360 testes, 82 ficheiros**, saída zero, 41,40 s.
- Build TypeScript/Vite: passou, **3218 módulos**, 30,60 s de Vite; mantém avisos de imports mistos e chunks grandes.
- ESLint do escopo alterado, incluindo os dois testes de interface: saída zero, sem avisos nesse escopo.
- Emulador: projeto `demo-mnemosyne-rules`, credenciais removidas, Firebase CLI 15.32.0/JDK 21.0.12.1. O ensaio real verifica payload completo do Universo, Timestamp legado, transações concorrentes, versão anterior v1, autoria conservada, rotação durante preparação, tombstone e recusa de restauro. A matriz Functions verifica épocas/ACL, plaintext/campos forjados e versão não emparelhada. O resultado da execução final está registado em `DECISOES_FASE3.md`.
- A prova AES-GCM usa conteúdo/chaves sintéticos: a chave antiga não abre o ciphertext novo armazenado no emulador e a nova abre. Wraps do fixture de regras são placeholders; esse teste não comprova RSA de produção. A recuperação de rotação tem testes RSA próprios.

O primeiro ensaio encontrou o limite de 1000 expressões ao repetir o mesmo helper nas regras de atualização. Separaram-se as regras pessoal/equipa e reduziram-se leituras/helper duplicados; as transações válidas passaram. Alguns pedidos negativos ainda produzem mensagens de limite de expressões no emulador e são recusados. Não se apresenta esta suite como profiling geral de todas as combinações possíveis nem como teste de dispositivos reais.

## Migração, publicação e rollback

Não são necessários novos índices para estas transações por ID. Permanecem necessários os índices e o backfill de âmbito já descritos em `MIGRACAO_ESCOPO_SESSOES.md`, a migração de épocas e os gates gerais. Não houve backfill nem operação de escrita sobre dados reais nesta etapa.

Manter `TEAM_WRITES_ENABLED=false` em frontend/Functions e a configuração administrativa ausente/falsa até recifragem histórica opcional, piloto, restauração isolada e restantes fases estarem verificadas. Antes do futuro deploy completo, verificar o bloqueio administrativo real, publicar regras compatíveis e os componentes coordenados e executar o piloto autorizado. Clientes antigos sem CAS/versão/AAD não podem voltar a escrever.

Rollback: fechar primeiro `config/teamSecurity.writesEnabled` com Admin SDK; conservar épocas, histórico e tombstones; reverter apenas componentes compatíveis com as regras fechadas. Não restaurar chave antiga como ativa nem reabrir apagamento físico de equipa para permitir um cliente antigo. Confirmar recusa de escrita no servidor e disponibilidade de leitura com pertença atual.

A recifragem histórica opcional foi implementada e ensaiada localmente em 1 de outubro: [RECIFRAGEM_HISTORICO_EQUIPAS.md](RECIFRAGEM_HISTORICO_EQUIPAS.md). Introduz uma exceção administrativa separada: altera cifra/contexto de sessões e versões sem mudar metadados semânticos ou criar versões duplicadas. A proibição de reescrever versões descrita acima refere-se ao fluxo de edição normal.

Pendências da fase 3: migração administrativa, piloto owner/admin/membro/removido/offline e suporte real das plataformas, incluindo a ativação da recifragem e das ligações no piloto. As fases de anexos, pesquisa, integrações e preparação operacional também continuam a exigir conclusão antes do deploy completo já autorizado.
