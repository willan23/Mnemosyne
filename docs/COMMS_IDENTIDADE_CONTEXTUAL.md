# Identidade Comms com contexto capturado — 11 de outubro de 2026

Este documento conserva a prova do incremento de publicação contextual. O incremento seguinte substitui a pendência de eliminação antecipada/regeneração descrita abaixo: [troca recuperável da identidade Comms](COMMS_IDENTIDADE_RECUPERAVEL.md). Backend/rules e fontes atuais divergem da prova anterior; os limites e testes de cada incremento mantêm a sua cronologia.

Em 13/10, a publicação habitual passou a ler o par numa transação e recusar uma chave remota diferente. As rules passaram a impedir substituição/eliminação pelo cliente; a resolução de trocas substituídas exige prévia e confirmação: [COMMS_IDENTIDADE_CONFLITOS.md](COMMS_IDENTIDADE_CONFLITOS.md).

## Publicação e preparação local

`publishCommsIdentity` captura UID, nome público, email e uma cópia da frase antes dos awaits. O contexto comum de mutação pessoal observa mudanças de conta/cofre e mantém a invalidação depois de regressar. A guarda do caller atravessa a preparação local, hash, aquisição do Web Lock por UID e publicação. App e painel fornecem uma guarda da sua própria vida/contexto. Criação, aceitação de convites e recuperação de rotação de equipa fornecem as suas guardas até à preparação de identidade.

Os documentos `users/<uid>` e `publicProfiles/<uid>` recebem a mesma chave pública e timestamp num único `writeBatch` do SDK Firestore. O email em claro e a chave privada não entram no batch. Não existe uma publicação do primeiro perfil seguida por uma segunda escrita que possa falhar isoladamente. As rules atuais continuam a autorizar os campos e UID; não foram alteradas neste incremento.

`getOrCreateIdentity` copia a frase e verifica a guarda antes de publicar a identidade em armazenamento/cache. Se a cifra primária mudar enquanto prepara ou decifra uma chave, recusa a substituição/publicação local. A cache inclui os bytes cifrados que originaram a chave: uma substituição feita por outra aba não é ocultada por um handle antigo. O envelope local carregado é limitado a 16.384 caracteres. O observer de cofre retira os handles privados da cache volátil quando o cofre muda. A cifra primária permanece guardada, com derivação própria por UID, conforme o contrato anterior.

## Limites que permanecem

- Invalidação antes da submissão impede a escrita. Depois de submeter um batch, o cliente pode deixar de receber o ACK ou perder o contexto enquanto o servidor confirma. A guarda posterior impede devolver o handle privado/feedback à vista antiga; não desfaz um commit já submetido.
- O batch torna a atualização dos dois perfis atómica. Não cria recibo/diário, CAS de identidade entre instalações, retenção histórica ou prova de entrega real. A reabertura pode voltar a publicar a chave local, com os mesmos limites do comportamento anterior.
- A regeneração existente continua a exigir confirmação no produto e guarda antes da eliminação local. **O rollover recuperável ainda está por implementar:** uma falha depois de eliminar a identidade antiga ou um ACK perdido na publicação exige um protocolo que conserve ambas as cifras, permita status/retoma e resolva a identidade remota. Não se declara este fluxo completo ou apropriado para lançamento final.
- Retirar uma cache não revoga handles já entregues a outros callers, bytes já lidos, cópias exportadas ou chaves conhecidas por destinatários. As operações afetadas precisam de guardas próprias durante todo o trabalho.
- Contactos, resolução de destinatário, envio, SDP/ICE/DataChannel, paginação/limites de transporte, confirmação recuperável de envio e clientes históricos continuam no inventário global Comms. A pesquisa por email usa uma query que as rules de descoberta atualmente recusam; não foi reaberta a listagem pública para contornar essa decisão.
- Binários nativos, transmissão real entre contas/dispositivos e fornecedores de produção não foram exercitados por este incremento. Não altera gates, configuração externa ou o âmbito das fases 0–6.

## Validação

A suite geral passou **913 testes frontend/141 ficheiros** antes da alteração final de correlação da cache e do teste adicional de cifra primária substituída. A compilação subsequente encontrou um tipo de dependency de rotação que ainda aceitava dois argumentos; o tipo foi atualizado para receber a guarda opcional. A passagem focada final valida o código final: **59 testes/seis ficheiros**, TypeScript, lint do escopo sem avisos e build web. O lint completo da passagem intermédia reportou zero erros/23 avisos anteriores. Os logs da falha de tipos são conservados. Sem novas dependências de produto.

Chromium usa o serviço de publicação, RSA/AES reais, localStorage cifrado e Web Locks. Auth e o transporte de batch/perfis são fronteiras sintéticas localhost. Verifica ambos os perfis com a mesma chave, batch recusado sem atualização parcial da fronteira, frase incorreta conservada, reset recusado antes de eliminar, retirada da cache, cifra primária substituída, concorrência entre abas, mudanças de conta/cofre durante RSA e ACK confirmado depois de perder contexto. O ensaio não comprova transações/regras reais do Firestore ou revogação remota. Zero pedidos externos, fornecedor ou produção.

Preflight: **29 gates/14 ficheiros fechados**. Backend/rules não alterados, com hashes comparados ao incremento anterior; as suites backend conservam a sua data/prova e não foram repetidas para esta alteração do cliente. Prova privada: `W:\real\mnemosyne-launch-evidence\comms-identity-local-validation-20261011.json`. O lançamento completo continua condicionado à conclusão e validação de todas as fases, incluindo o rollover e restantes handlers acima.
