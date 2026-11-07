# Emparelhamento de dispositivos com autoridade no servidor

## Continuação local — 18 de outubro de 2026

A [integração recuperável dos clientes](EMPARELHAMENTO_RECUPERAVEL.md) substitui agora os cinco escritores SDK, conserva chaves/pedidos cifrados e aplica as negações nas duas raízes. A seção de 17 de outubro abaixo conserva o estado anterior desta etapa de servidor. Gates, classificação operacional dos legados, recuperação/exportação e pilotos continuam pendentes antes do lançamento.

## Etapa de servidor — 17 de outubro de 2026

Foram implementadas as callables `mutateMobilePairing` e `getMobilePairingMutationStatus`, em `europe-west1`. O contrato v1 transporta o ator capturado e uma de cinco ações. O documento de convite produzido pelo servidor tem `version: 2`; os registos legados v1 não são promovidos automaticamente.

**Esta é uma etapa preparatória.** O cliente atual ainda usa os cinco escritores SDK de `mobilePairing.ts`. As regras legadas ainda permitem essas escritas. A recuperação cifrada das chaves privadas, a integração das duas interfaces e a negação coordenada das escritas SDK têm de ser concluídas antes de abrir o novo gate `MOBILE_PAIRING_ENABLED`, que permanece `false`. Este documento não declara que o percurso antigo está corrigido ou que o emparelhamento já está pronto para produção.

## Autoridade e ameaça

Os dois dispositivos pertencem à mesma conta autenticada. Cada comando liga o UID capturado ao UID do token antes de consultar Auth/Firestore. O servidor revalida a conta Auth ativa e verifica, na transação, o perfil e o marcador permanente de eliminação. Estas verificações não constituem uma transação atómica entre Auth e Firestore nem recolhem pedidos que já passaram a admissão.

A posse do QR por si só não autoriza operações de outra conta. O QR não deve conter chave privada ou mnemónica. O handshake cifrado é opaco para o servidor: a prova de que o conteúdo corresponde às chaves públicas tem de ser feita pelo cliente antes de confiar. Uma sessão Auth comprometida não equivale a posse física verificada de um dispositivo; este protocolo não promete essa garantia.

As chaves recebidas são exclusivamente públicas, EC/P-256. O servidor valida forma, coordenadas canónicas e o ponto real com Node crypto. Material privado e campos inesperados são recusados. Nomes têm no máximo 120 caracteres, IDs de convite/dispositivo novo são limitados e o handshake cifrado tem no máximo 4096 caracteres.

## Estados, repetição e tempo

| Ação | Admissão e resultado |
| --- | --- |
| `create` | Reserva um ID, fixa prazo de dez minutos pelo relógio do servidor e grava chave pública/nome/digest. Uma repetição exata não prolonga o prazo. |
| `accept` | Exige o digest/prazo do convite, estado pendente e prazo válido. Fixa um único dispositivo, chave e ciphertext; outra aceitação não os substitui. |
| `trust` | Exige o digest exato da aceitação e uma chave pública de sync do desktop. Cria o dispositivo e fixa o recibo no convite na mesma transação. |
| `cancel` | Cancela um convite pendente/aceite. Antes de uma criação atrasada, reserva o ID como cancelado; essa criação nunca passa a ativa. Depois de confiar, é necessário revogar o dispositivo. |
| `revoke` | Revoga apenas um dispositivo existente da conta e conserva o ID. Repetir `trust` não o reativa. Aceita também registos legados próprios com identidade/estado válidos. |

O servidor permite no máximo vinte reservas novas de ID por conta/dia, incluindo cancelamentos que antecedem a criação. Reserva, contador diário e convite são atómicos. Repetir o mesmo pedido não cobra outra reserva. As callables aplicam também o limite comum de trinta pedidos por UID/minuto, incluindo consultas de estado; uma consulta não é globalmente isenta de escritas operacionais desse limite.

O relógio é obtido novamente em cada callback de transação. Uma aceitação/confiança nova tem de passar a admissão dentro do prazo. A confirmação de uma execução anterior continua disponível depois do prazo ou com o gate fechado, mas não volta a criar artefactos apagados. A consulta do convite descreve o seu estado; a consulta de confiança verifica também o dispositivo atual, incluindo revogação ou indisponibilidade. Não é uma ordem para restaurar uma chave antiga.

Convites cancelados e IDs de dispositivos revogados não são eliminados pelo cliente. O cleanup administrativo de conta continua protegido pelo marcador permanente. Os contadores ficam numa subcoleção própria do utilizador, inacessível por SDK e abrangida pela eliminação recursiva já existente. Retenção operacional de convites/chaves locais ainda requer conclusão com os clientes.

## Validação desta etapa

Os testes focados verificam actor/token antes de serviços, pontos EC inválidos, campos privados/extra, quota, expiração, concorrência, resposta repetida, falha atómica, estado contraditório, confirmação de outra conta, revogação definitiva e cancelamento antes de criação. O ensaio do Firestore usa o projeto demo, Auth sintético e transações Admin reais; não comprova Auth de produção, transporte mobile, armazenamento seguro nativo ou UX de recuperação.

Os resultados finais e os limites de reutilização das provas anteriores são registados em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md). Não houve deploy, alteração de regras de produção ou chamada generativa. O programa completo continua aberto.

