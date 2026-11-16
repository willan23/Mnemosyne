# Conflitos de identidade Comms — 13 de outubro de 2026

**Incremento seguinte, 13/10:** [COMMS_BACKUP_IDENTIDADES.md](COMMS_BACKUP_IDENTIDADES.md) implementa backup cifrado, restauro entre instalações e retenção/purga confirmada. As duas pendências de backup e retenção abaixo descrevem o estado histórico deste incremento; os pilotos reais e as restantes fases continuam pendentes.

## Publicação habitual

`publishCommsIdentity` lê os documentos privados e públicos numa transação do cliente. A primeira publicação e a atualização da mesma chave são permitidas; uma chave diferente em qualquer dos perfis recusa a publicação e conserva a cifra local. A atualização não repõe automaticamente uma chave antiga de outro dispositivo.

As rules permitem inicializar uma chave apenas com o par correspondente em `getAfter`. Uma chave existente é imutável ao cliente, incluindo quando tenta alterar os dois documentos num batch. Os clientes não podem apagar os perfis para contornar essa verificação. A recriação de um perfil público em falta exige a mesma chave do documento privado. Alterações de identidade usam a transação Admin de rollover, com a base remota capturada.

## Troca confirmada que foi substituída

Quando o recibo da candidata está confirmado mas `current` é falso, a recuperação conserva o pedido cifrado e a identidade primária, e o painel apresenta o conflito. A inspeção é só de leitura: abre e verifica ambas as identidades locais, confirma o recibo e captura os hashes/versões dos dois perfis atuais. Mostra as impressões SHA-256 da candidata conservada e da chave atualmente publicada; não envia chaves privadas, mnemónica ou cifras locais.

Publicar novamente a candidata exige confirmação explícita. O cliente captura uma cópia da prévia, verifica o digest da cifra pendente, o UUID, a impressão da candidata e a base remota completa. Uma alteração de perfil ou de versão exige nova inspeção e confirmação. O servidor volta a comparar a base na transação de aplicação. Não existe rebase automático.

O cliente reserva capacidade para os dois diários antes de começar. Arquiva a cifra original com leitura de confirmação e guarda um novo diário cifrado antes de enviar um pedido com outro UUID. Reutiliza a candidata conservada; não gera outra chave RSA. O recibo original permanece e cada nova aplicação usa o orçamento diário existente de cinco trocas.

## Recuperação e compatibilidade

O novo diário local v2 mantém as cifras antiga e candidata, a impressão da identidade local antiga e a cifra primária que o cancelamento deve conservar. Essa impressão é distinta da impressão remota da base: não se afirma ter a chave privada publicada pelo outro dispositivo. Os diários v1 continuam legíveis sem migração dos bytes, pedidos ou digests anteriores. O namespace local existente permanece para recuperação e eliminação por UID.

Depois de perda da confirmação, recuperar consulta o mesmo UUID/cifra v2 e pode confirmar a aplicação com a admissão fechada. Cancelar uma republicação ainda não admitida conserva a cifra primária capturada, inclusive se a candidata já era a chave local. Os arquivos permitem ler mensagens antigas. Não se apagam automaticamente chaves históricas.

Os quatro RPCs `prepare/apply/status/cancel` recebem um envelope exato `{actorUid,request}`. O UID capturado é comparado ao token antes de rate limit ou base de dados. O envelope não altera os bytes canónicos dos pedidos e recibos existentes. O RPC antigo sem envelope é recusado.

Functions, clientes e rules exigem rollout coordenado. Clientes antigos deixam de poder substituir/apagar os perfis, e não podem ler o diário v2. Um rollback precisa de manter o suporte ao envelope, a recuperação v2 e as restrições de substituição. A publicação de novas trocas permanece fechada nas fontes até ao rollout autorizado do produto completo.

## Limites restantes

- Mensagens cifradas para a chave remota substituída podem exigir o outro dispositivo ou um backup dessa chave. A prévia e a confirmação explicam este limite.
- Uma identidade local diferente, sem diário de troca pendente, é conservada e a publicação é recusada. Recuperação entre instalações e importação/exportação de backups ainda fazem parte do trabalho restante.
- O histórico continua limitado a 20 diários. A republicação precisa de uma ou duas posições livres, conforme o diário original já esteja arquivado. Exportação, retenção e purga confirmada ainda não estão concluídas.
- Auth/transporte/base sintéticos nos testes Chromium não demonstram um piloto real entre dispositivos. Os testes do emulador usam Firestore/Storage locais.
- Nenhum deploy, alteração de produção ou ativação dos alertas resulta deste incremento. `wgftechnologies@gmail.com` está confirmado; entrega e ativação continuam pendentes.

A prova e as contagens finais estão em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md). O objetivo mantém todas as fases 0–6 antes do deploy completo autorizado.
