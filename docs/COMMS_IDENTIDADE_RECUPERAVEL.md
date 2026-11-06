# Troca recuperável da identidade Comms — 11 de outubro de 2026

**Atualização de 13/10:** a resolução explícita de candidatas substituídas, a publicação sem reposição de chaves antigas, o envelope de UID e o diário local v2 estão em [COMMS_IDENTIDADE_CONFLITOS.md](COMMS_IDENTIDADE_CONFLITOS.md). As contagens e limitações abaixo conservam a prova histórica de 11/10.

Backup, restauro entre instalações e retenção/purga confirmada foram implementados no incremento [COMMS_BACKUP_IDENTIDADES.md](COMMS_BACKUP_IDENTIDADES.md), que conserva os diários históricos v1/v2 e adiciona cópias locais v3 sem recibos remotos fictícios.

## Pedido local e conservação das chaves

O reset confirmado no painel passa por `regenerateCommsIdentity`. A cifra primária antiga permanece intacta durante a geração. O cliente abre a chave antiga no cofre da conta, captura a base dos dois perfis, gera uma candidata RSA e guarda um diário cifrado por UID com UUID, pedido e ambas as cifras antes de enviar a troca. A chave privada, a frase e as cifras locais não entram nas callables.

O mesmo Web Lock por UID protege a publicação habitual e a troca. A existência de um pedido pendente impede outra geração e a publicação habitual da identidade. Conta, cofre, contexto do caller, eventos de armazenamento e os bytes primários/pendentes são verificados durante a operação. As helpers de preparação/abertura não substituem o primário nem preenchem a cache.

O diário usa AES-GCM do cofre pessoal; cada identidade mantém também a sua cifra e derivação própria por UID. As cópias não constituem um backup remoto. Perder o armazenamento local ou a frase pode impedir abrir mensagens e envelopes antigos.

## Transação e confirmação remota

`prepareCommsIdentityRollover` captura hashes dos documentos integrais, incluindo as versões Firestore, e a impressão da chave pública anterior. `applyCommsIdentityRollover` compara essa base e atualiza os dois perfis, recibo privado e orçamento diário numa transação. Uma mudança concorrente de perfil, mesmo seguida por reposição dos valores anteriores, impede aplicação sem nova decisão. Os campos de perfil não envolvidos são conservados.

O contrato recusa campos adicionais, autoridade fornecida pelo cliente, IDs inválidos e material privado. O servidor admite apenas chaves públicas RSA canónicas de 2048–4096 bits com expoente 65537. O limite diário é cinco trocas confirmadas por conta, além do limite de frequência da callable. O recibo vincula UID, UUID e digest do pedido. Os clientes não podem ler, consultar ou escrever diretamente `commsIdentityRollovers` e `commsIdentityBudgets`.

Status e cancelamento podem confirmar pedidos com o gate de aplicação fechado. Um recibo histórico confirmado só autoriza promoção local quando os dois perfis ainda correspondem à candidata e à conta. Não recria um perfil removido nem repõe uma identidade substituída. Uma conta em eliminação ou já eliminada não pode preparar, aplicar, consultar ou cancelar. A eliminação da conta abrange os dois novos roots privados e as cifras locais do próprio UID.

## Recuperação e cancelamento

Após perda de ACK, retomar consulta o mesmo UUID, pedido e cifras. Não gera outra identidade. Antes de promover a candidata, arquiva o diário cifrado e confirma novamente que o recibo é atual. Só remove o pedido pendente depois de confirmar o primário e o arquivo. Uma falha de leitura após gravação conserva a recuperação, incluindo quando o novo primário já foi gravado.

O painel global e o Comms mostram recuperação/cancelamento por conta. O cofre fechado desativa as operações. Cancelamento requer confirmação humana: se a troca ainda não foi aplicada, o recibo terminal conserva o primário antigo; se já foi aplicada, recupera a troca confirmada. Não promete desfazer uma chave pública já publicada. Feedback e promoção tardios são recusados depois de mudar de conta/cofre/vista.

As identidades antiga e candidata ficam cifradas no histórico local, inclusive após cancelamento. A leitura verifica UID, UUID e a correspondência de ambas as chaves com o pedido. Existe um limite explícito de 20 diários históricos por UID; atingir esse limite recusa uma nova troca. Não há purga automática de chaves que ainda possam abrir dados históricos.

## Mensagens e equipas anteriores

O destinatário tenta a chave privada atual e, se necessário, as identidades retidas no cofre. O painel retira a cache de handles históricos ao fechar, mudar de conta/cofre/identidade ou desmontar. Os callbacks continuam sujeitos à guarda do destinatário e da vista. A recuperação de uma chave antiga não publica essa chave como identidade ativa.

O acesso à chave de equipa tenta também as identidades anteriores. Mantém as verificações de associação, envelope, época/keyId e geração da cache, com guardas de conta/cofre/caller durante os awaits. O carregamento em background propaga o cancelamento da vista. Isto conserva a abertura dos wraps existentes; não cria autorização para uma associação revogada nem reembrulha automaticamente os documentos da equipa.

## Validação e alcance da prova

Passaram **942 testes gerais frontend/143 ficheiros**, antes do último ajuste de retirada da cache ao fechar e do teste adicional. A passagem focada final cobre esses ajustes: **89 testes/sete ficheiros**, TypeScript, lint do escopo sem avisos e build web. O lint completo tem zero erros e 23 avisos anteriores. Functions: **246 testes unitários**, com um teste de emulador separado ignorado, e quatro testes do preflight/pipeline, incluindo os pontos de falha do deploy. Os audits das dependências de produção dos dois packages reportam zero vulnerabilidades.

No emulador `demo-mnemosyne-rules`, passaram **161 testes Functions e 23 testes frontend**, incluindo concorrência de UUIDs, cancelamento/aplicação, quota atómica, recibos privados e eliminação. A suite geral começou antes do último reforço da confirmação de UID do perfil; o teste unitário final e a passagem focada do emulador cobrem o código posterior. Backend e rules foram alterados neste incremento.

Chromium usa o controlador, painel de recuperação, executor do backend, RSA/AES, localStorage e Web Locks reais. Auth, transporte RPC e base do executor são fronteiras sintéticas localhost. Verifica perda de ACK, primário antigo conservado, recuperação noutra aba sem nova geração/aplicação com gate fechado, cofre incorreto, confirmação de cancelamento, mensagem RSA antiga e mudança de conta durante status. Não comprova entrega real entre dispositivos ou operação em produção. Uma primeira passagem falhou porque o harness não usava a transformação JSX automática; a configuração do harness foi corrigida e ambos os logs são conservados. A falha inicial de compilação do backend por literal BigInt foi corrigida para o target existente.

Prova privada: `W:\real\mnemosyne-launch-evidence\comms-identity-rollover-local-validation-20261011.json`. Logs em `comms-rollover-validation-20261011`. **31 gates/15 ficheiros fechados**, zero pedidos externos no browser, fornecedor, mutações de produção ou deploy. Não existe binário nativo validado para este código.

## Trabalho restante

- A candidata confirmada mas substituída tem agora resolução explícita documentada em [COMMS_IDENTIDADE_CONFLITOS.md](COMMS_IDENTIDADE_CONFLITOS.md). Recuperação de chaves entre instalações continua pendente.
- Definir export/backup, retenção e purga confirmada do histórico, incluindo recuperação entre instalações e o limite de 20 diários.
- Concluir contactos/resolução/envio/rooms/limites e confirmação recuperável de entrega Comms; completar o isolamento de estado e todos os callers/transportes.
- Concluir revisão de equipa com base capturada, writers diretos, migração/cutover de rules e pilotos entre contas/dispositivos.
- Concluir os critérios restantes das fases 0–6. O email operacional é wgftechnologies@gmail.com; o plano de alertas ainda não foi ativado nem teve entrega verificada.

O deploy completo autorizado continua condicionado à conclusão e validação de todas as áreas.
