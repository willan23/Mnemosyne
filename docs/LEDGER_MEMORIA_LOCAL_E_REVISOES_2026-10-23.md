# Ledger de pesquisa local e substituição de revisões

## Decisão e âmbito

O ledger de alterações persistidas e das consultas da API já existia. Este incremento acrescenta `retrieve` e `index` locais ao percurso de pesquisa concluída, e `supersede` às transações que substituem uma revisão por outra. Não atribui verdade a um facto, não infere contradições e não estabelece automaticamente uma relação entre duas memórias distintas.

### Pesquisa neste dispositivo

`useSessions` regista o resultado final da mesma operação que acabou de apresentar, depois de ACL, filtros e ranking. Inclui resultados vazios válidos e o resultado lexical quando apenas a inferência semântica falha. Não grava pesquisas canceladas antes da conclusão, falhas do Worker nem a lista geral sem consulta/filtros. Consultas vazias com filtros ativos contam como recuperação local. Um evento `index` acompanha os deltas alterados/removidos confirmados nesse percurso concluído; não é produzido para a simples reutilização de texto preparado.

Campos permitidos:

| Evento local | Campos dentro da cifra |
| --- | --- |
| `retrieve` | nonce aleatório, tipo, operação fixa `search`, data local e quantidade devolvida |
| `index` | nonce aleatório, tipo, data local e quantidades alterada, removida e indexada |

Não são aceites consultas, títulos, texto, IDs de documentos/equipas, rótulos, filtros, scores, vetores ou mensagens de erro. O evento não identifica qual memória foi encontrada. Uma nova pesquisa concluída produz um novo nonce; repetir a persistência do mesmo evento conserva o nonce e não duplica o registo. Não há envio desses eventos ao servidor ou a fornecedores, mesmo em `allow-cloud`.

`localMemoryActivityStore` usa a base IndexedDB `mnemosyne-memory-activity-v1`. O registo exterior contém apenas versão, UID, revisão/reset aleatórios e envelope AES-GCM. O corpo cifrado repete UID, revisão e reset; transplantar ciphertext entre contas é recusado mesmo com a mesma chave de teste. A chave é a do cofre pessoal já desbloqueado; não é gravada no ledger. A proteção não cobre um processo/origem já comprometido nem constitui garantia de apagamento físico da heap.

As atualizações usam compare-and-exchange numa transação IndexedDB, com até oito tentativas após concorrência. Duas pesquisas concorrentes fundem os eventos; um ACK perdido pode ser confirmado repetindo o mesmo nonce. Limpar os registos altera o reset e impede que uma gravação pendente anterior reponha o histórico. Conta/cofre são observados ao longo da preparação; uma mudança observada permanece invalidante mesmo depois de A→B→A. A transação verifica o guard antes de escrever e a confirmação é revalidada depois. Uma falha depois do commit pode significar uma gravação concluída sem ACK.

Há um limite de **200 eventos** e uma janela de **30 dias pelo relógio local**, com purga ao ler ou gravar o ledger. Não existe scheduler enquanto o cofre/dispositivo está fechado. Uma regressão do relógio conserva eventos futuros já guardados; timestamps e ordenação não são um relógio de auditoria certificado. Registos corrompidos ou de outro UID são preservados e a operação apresenta erro; não são substituídos silenciosamente.

Os registos disponíveis podem ser consultados, exportados ou limpos em **Definições → Privacidade**. Só são carregados após uma ação explícita. A exportação JSON contém datas/quantidades, que continuam a ser metadata sensível; o ficheiro exportado está em claro por decisão explícita do utilizador. A interface retira os dados após mudar conta/cofre e verifica o âmbito antes de iniciar um download. A purga local da conta também remove esta base apenas para o UID confirmado, incluindo quando o cofre já está bloqueado.

Este é um journal local limitado e best effort. A pesquisa continua a funcionar quando o browser não permite guardar metadata; a falha gera apenas um aviso fixo sem conteúdo. Não se afirma que o journal contém todas as ações anteriores, que sincroniza entre dispositivos ou que faz parte do backup Firestore. Não existe backfill. Os ensaios de disponibilidade/retention dos dispositivos continuam necessários.

### Substituição de revisão no servidor

`recordMemorySupersession` cria um evento `schemaVersion:2`, `kind:supersede` na mesma transação que grava o novo estado, arquivo cifrado, recibo e quotas. Abrange:

- edição pessoal/equipa pelo editor comum, incluindo a aplicação de uma proposta de agente aprovada;
- revisão de aprendizagem pessoal e de equipa;
- aplicação de um conflito sobre a memória original;
- reversão confirmada de uma alteração do agente.

Apagar uma memória, cancelar um pedido, conservar ambos ou descartar um conflito não significam substituir uma revisão viva. Esses percursos conservam os eventos anteriores próprios e não recebem um `supersede` artificial. Uma reversão cria uma revisão nova que substitui a revisão aplicada ou tombstone; não apaga o histórico anterior.

O evento contém só ID da memória, revisão anterior/nova, ID do arquivo, origem fixa e datas de ocorrência/gravação. Os IDs e datas continuam sensíveis. Não inclui payload, envelope, título, texto, prompts, vetores, tags, diffs ou conteúdo do arquivo. As datas v2 são strings ISO preparadas no servidor; a revisão conserva o valor monotónico usado pelo domínio. O evento não certifica a hora exata de commit ou entrega.

O stream pertence ao **ator autenticado** da operação. Para uma memória de equipa, a autoria original da memória é preservada e o evento não atribui essa autoria ao editor. Os checks atuais de conta viva, membership, owner/author, época e baseline são conservados. O ledger de triggers anterior continua a classificar alterações por autor da memória; não é substituído por este stream do ator. O acesso a uma referência histórica não concede autorização atual para ler a memória.

O ID do evento deriva da origem, nonce da operação e ID da memória. A repetição confirmada encontra o recibo antes de escrever novamente. Se já existir um evento incompatível no destino sem recibo, o create transacional faz falhar toda a operação, sem arquivo, alterações ou consumo parcial. O evento acrescenta uma escrita à transação; os limites de operações existentes continuam a aplicar-se. A eliminação da conta já purga `users/{uid}/memoryEvents`; streams de outros atores são conservados como histórico próprio. A retention operacional do ledger servidor e a entrega real dos triggers continuam pendentes.

## Migração e publicação

Não há novos endpoints, scopes, secrets, permissões, Rules ou índices Firestore. As sessões conservam o schema e os protocolos cifrados existentes. O ledger passa a misturar eventos v1 anteriores e este novo tipo v2; consumidores futuros devem distinguir os schemas. O novo ledger IndexedDB é local e começa vazio. Não se transforma automaticamente o ledger v1 nem se reconstituem eventos de revisões antigas.

Publicar requer um build coerente do cliente e Functions, seguindo os gates de lançamento. Um rollback anterior deixa de produzir estes novos eventos, mas não deve apagar o histórico nem reabrir escritas diretas por SDK. O diário local continua cifrado e limitado; usar o mesmo cofre é necessário para o ler.

## Validação

Os logs e hashes estão em `W:/real/mnemosyne-launch-evidence/memory-ledger-validation-20261023/`.

- Primeira suite focada frontend: **42 testes em quatro ficheiros passaram**, cobrindo schema sem conteúdo, cache cifrada simulada, retenção, concorrência, ACK perdido, clear, conta/cofre A→B→A, hook e controlos da UI.
- Suite geral Functions em Node **22.23.3**: **567 aprovações, zero falhas e uma omissão prevista** da suite de regras fora do emulador. Inclui os emissores/contratos alterados e cenários negativos; a gravação em fixtures unitárias não substitui transações Firestore. O percurso completo da reversão é exercitado no emulador.
- Emuladores Firestore/Storage com JDK 21, projeto demo e portas isoladas: **37 cenários focados passaram**, zero omissões. Confirmaram recibo/arquivo/evento atómicos, reentrega concorrente, colisão sem writes parciais, leitura privada/imutável e encerramento por eliminação da conta. Incluem os percursos de edição/revisão/reversão já existentes. Os processos encerraram normalmente. Não se iniciou o emulador Functions nem se ensaiou entrega automática dos triggers.
- Chromium: AES-GCM e IndexedDB reais, reload, dois separadores com CAS, ACK perdido, clear contra append pendente, conta/cofre A→B→A, recusa de ciphertext de outro UID, retenção/purga, painel e download reais, cancelamento de export tardio e purga própria com cofre bloqueado. Auth, chave e dados são fixtures sintéticas; zero rede externa. Não substitui um piloto Firebase Auth ou nativo.
- O novo ensaio Chromium foi integrado no job frontend obrigatório do CI. A suite de regras existente inclui automaticamente os novos casos. A execução remota continua pendente.
- Suite geral frontend anterior à correção Vite: **1.695 testes em 203 ficheiros**, com um worker e zero omissões. Build/TypeScript passou. Lint geral: **541 ficheiros, zero erros e 23 avisos**. O escopo novo/alterado tem dez ficheiros TS/TSX, zero erros e o mesmo aviso anterior das Settings. A fronteira de writes por SDK verificou 313 fontes sem achados; a ligação do painel, purga e emissores também foi conferida por AST em sete fontes, separadamente dos testes dinâmicos.

### Correção do Vite encontrada na auditoria final

`npm audit --omit=dev` reportou Vite 7.3.5 com cinco avisos, um deles alto. O [aviso oficial de launch-editor](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm) e o [aviso de acesso a ficheiros](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22) identificam **7.3.7** como versão corrigida desta linha. São condições de servidor de desenvolvimento/editor; o achado não demonstra exploração deste projeto.

Vite passou a `^7.3.7`, com 7.3.7 e a integridade do tarball no lock. A instalação não executou scripts e só mudou a versão deste pacote. O npm também normalizou flags `peer` de 30 entradas; foram conservadas as flags anteriores para manter o delta do lock limitado à declaração raiz e ao nó Vite. As versões/resoluções dos outros pacotes são iguais. Não se usou atualização forçada de major nem se retirou a dependência para ocultar o achado.

A nova auditoria de produção do frontend ficou com **zero vulnerabilidades**; Functions também tem zero. Passaram novamente o build, os **quatro smokes públicos** e os dois ensaios Chromium de ledger e Worker híbrido. A repetição completa com **Vite 7.3.7 aprovou os 1.695 testes em 203 ficheiros**, sem omissões, em 306,76 segundos, com o mesmo código/asserts/timeouts dos testes e um worker. A passagem anterior de 293,86 segundos foi conservada. Auditorias refletem a base de avisos consultada nesta data; não certificam todos os riscos do produto.

As primeiras falhas de build foram corrigidas sem mudar targets ou desativar regras: `Object.hasOwn` não era suportado pelo target Functions, e um helper de schema precisava de uma condição explícita de não-null para TypeScript. O aviso novo de cleanup de ref foi resolvido mantendo um callback que invalida a época pendente. A primeira fixture Chromium não usou o transform JSX automático e não montou o painel; o executor foi alinhado com o build da aplicação, mantendo os asserts/timeouts. A primeira suite geral Functions herdou Node 24 no PowerShell; o erro foi reproduzido contra a passagem Node 22 com o mesmo wrapper, sem editar o teste ou publicar configurações.

O scan de segredos do escopo teve um achado bruto: o UUID sintético preexistente de um campo `idempotencyKey` em `rules.test.js`. A linha exata foi conferida contra a before-image selada e o valor validado como nonce conhecido da fixture. Foi classificado separadamente, sem alterar a configuração ou suprimir regras do scanner. Os relatórios redigidos conservam o achado bruto e a classificação; não ficaram achados não resolvidos. Este scan não certifica todo o checkout ou os históricos.

Zero mutações de produção, acessos a payload de secrets, pedidos generativos ou deploys neste incremento. As fases 0–6 e os 49 gates continuam exigidos para o lançamento completo. Estes resultados completam os percursos aqui descritos; não aprovam qualidade semântica, retention servidor, todas as plataformas ou todo o produto.
