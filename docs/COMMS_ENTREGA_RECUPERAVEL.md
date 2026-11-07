# Entrega Comms recuperável — 11 de outubro de 2026

## Contrato

O relay conserva primeiro um diário AES-GCM por UID, usando o cofre pessoal e um Web Lock exclusivo. Contém UUID, UIDs/fingerprints e cápsula já cifrada. Recuperação usa os mesmos bytes e UUID, sem gerar outra chave/cifra. Um pedido pendente bloqueia o envio seguinte. Mudanças de conta/cofre/vista/diário invalidam a operação e o feedback tardio.

O UID capturado segue no pedido e é comparado com `context.auth.uid` antes dos limites; o executor repete a comparação e copia os campos antes dos awaits. O ACK inclui o UID capturado do destinatário. Assim uma troca de token do SDK não atribui a operação à conta seguinte.

`createCommsDelivery`, `getCommsDeliveryStatus`, `cancelCommsDelivery` e `acknowledgeCommsDelivery` ficam em `europe-west1`. Criação verifica Auth, marcadores permanentes de eliminação, perfis públicos/privados, ambas as chaves atuais, schema/base64 canónico, fingerprints e comprimento RSA. O servidor recebe a cápsula cifrada, sem texto, mnemónica ou chave privada.

Uma transação cria `transmissions/<UUID>`, recibo privado `commsDeliveryRequests/<UUID>` e três budgets diários. Repetições confirmadas não duplicam a cápsula nem a quota. O digest vincula participantes, fingerprints e cifra.

| Estado | Significado e recuperação |
|---|---|
| `unknown` | Conservar diário; criar o mesmo pedido se o gate permitir ou cancelar |
| `sent` | Admissão pelo relay; cancelamento pode retirar a cápsula sem ACK |
| `received` | Destinatário autenticado confirmou aquele digest; preservar timestamps/cápsula |
| `cancelled` | Terminal; não recriar o UUID |
| `revoked` | Sem recibo e com marcador de eliminação do destinatário; retirar diário sem recriar referências no servidor |

Cancelamento desconhecido grava checkpoint privado terminal, cobrando um pedido remetente/projeto e zero bytes. Cancelar uma cápsula admitida não devolve quota. Corridas ACK/cancelamento conservam um único terminal consistente. Cancelar não revoga conteúdo já copiado/aberto. O ACK não é assinatura criptográfica de leitura humana.

O cliente confirma depois da abertura local; perda de ACK permite **Confirmar leitura**, sem marcar a decifragem como falhada. O servidor aceita o formato legado não versionado dentro dos limites sem criar um novo recibo de admissão; repetição conserva timestamp.

## Limites, regras e eliminação

- Texto UTF-8 32 KiB; anexo original 256 KiB; cifra 384 KiB; pedido 600 KiB. Contrato partilhado com o transporte.
- Remetente/destinatário: cada um 100 pedidos / 20 MiB por dia UTC. Projeto: 1.000 pedidos / 200 MiB por dia. Limites iniciais conservadores; calibração operacional pendente.
- Rate limits por UID/projeto protegem também consulta, ACK e cancelamento. Falha transacional não admite estado parcial.
- Rules recusam escritas SDK em transmissões e qualquer acesso SDK aos recibos/budgets. Leitura direta exige ambos os participantes ativos.
- Eliminação de conta abrange recibos nas duas direções, budgets próprios e diário do UID; conserva outras contas e budget global com `uid:null`. Recuperação após purga não recria metadata do destinatário eliminado.

Cutover exige cliente/callables/rules coordenados; clientes antigos deixam de escrever transmissões diretamente. Gates de relay e novo gate P2P permanecem fechados, aguardando a conclusão e validação do programa.

## Evidência local

1.000 testes gerais frontend /148 ficheiros antes do último teste de revogação; 85 focados finais /sete ficheiros, TypeScript/build web e lint escopo sem erros/avisos. Lint geral zero erros/23 avisos anteriores. Functions: 268 unitários e um teste de emulador separado ignorado; 23 focados finais (13 entrega +10 contactos). Quatro testes pipeline. Emuladores: 169 backend +23 frontend rules, depois cinco backend focados finais de entrega/cleanup.

Chromium exercita painel/controlador/recuperação/ACK/executores/RSA/AES/localStorage/Web Locks reais. Auth/RPC/DB/streams são fronteiras sintéticas localhost. Zero pedidos externos, fornecedor ou produção. Não substitui Auth Firebase real, rede externa, Android/Tauri.

Falhas iniciais conservadas: fixture de concorrência pressupunha ordem após await; a criação devolvia terminal `revoked` em vez de recusar um novo pedido. Corrigidas. Status/cancelamento continuam a devolver esse terminal sem escrita. Dependências/índices inalterados face à prova de transporte; audits anteriores não repetidos.

Prova privada `W:\real\mnemosyne-launch-evidence\comms-delivery-local-validation-20261011.json`; logs `comms-delivery-validation-20261011`. 36 gates /17 fontes fechados. Alertas preparados para wgftechnologies@gmail.com, sem ativação/entrega.

## Pendente no objetivo completo

P2P requer admissão/sinalização no servidor, confirmação durável, fragmentação/retoma/reconciliação de rooms. Listas paginadas e inbox revogado continuam pendentes: a revogação de outro participante pode falhar uma query SDK inteira. Nome de ficheiro e metadata externa continuam visíveis; recibos não têm assinatura E2E. Diário local não é backup nem recuperação entre instalações.

Restam retenção/backup/conflitos de identidades, revisão de equipa/writers/rules legados, configurações/segredos/revogação cloud, entrega de alertas, restauração isolada, pilotos, qualidade multilingue, agentes seguros e acessibilidade. Este incremento não conclui Comms/fase 4/fases 0–6. Deploy completo depois de concluídas todas as áreas, conforme autorização humana.
