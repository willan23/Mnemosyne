# Sinalização P2P recuperável — 12 de outubro de 2026

## Contrato e dados

Proposta, resposta, ICE e fecho passam a `mutateCommsP2P`, com consulta/cancelamento do mesmo pedido e `readCommsP2PSession`, em `europe-west1`. O UID capturado tem de corresponder ao token antes de rate limits. Participantes, fingerprints das duas identidades e digest da oferta vinculam cada operação à sala; o parser copia os sinais antes de awaits. Criar/responder/adicionar ICE e ler uma sala aberta verificam contas e chaves atuais. Fechar pode retirar uma sala histórica depois da revogação da outra conta.

SDP/ICE são metadados de rede e podem conter IPs, identificadores e fingerprints DTLS. São guardados no Firestore para coordenação; não são conteúdo de memória cifrado nem dados anónimos. O diário e a referência local à sala são cifrados com o cofre pessoal. Mensagens/anexos continuam RSA/AES no DataChannel. O servidor não recebe mnemónica, chave privada ou texto de mensagem.

Uma transação admite sala v2, recibo privado por UUID e budgets. Create usa UUID da sala; resposta/candidato/fecho têm UUID próprio. Repetir a operação confirmada não repete admissão. Só o callee fixa a resposta e apenas o lado autenticado adiciona os seus candidatos. A resposta fixada não pode ser substituída por outro SDP. Leitura retorna apenas candidatos do peer, com vínculo e digest conferidos.

## Recuperação, fecho e limites

O diário cifrado existe antes da RPC e conserva pedido/UUID/sinal. Consulta confirma perda de ACK sem republicar. Gate fechado permite confirmar recibos e cancelar; unknown que exige nova aplicação conserva o diário. Cancelar fecha a sala conhecida e cria checkpoint terminal, sem devolver quotas. Proposta cancelada não pode voltar a criar o mesmo UUID.

Uma referência cifrada à sala confirmada bloqueia negociação de outra sala enquanto a primeira não for fechada. Se o processo WebRTC desaparecer, **Fechar sala P2P guardada** usa a referência, sem alegar que o PeerConnection sobreviveu. Perda de ACK/armazenamento conserva a pendência. Conta/cofre/vista/bytes alterados invalidam feedback e mutação local. Candidatos locais aguardam admissão e são serializados; uma falha conserva a operação e retira o peer local para evitar duplicação do sinal após recuperação.

Fecho atómico retira oferta, resposta e ambos os conjuntos de ICE. Conserva metadata mínima da sala fechada e recibos de idempotência. Não retira sinais ou conteúdo que outro peer já recebeu. Expiração de dez minutos impede novos sinais e exposição de SDP/ICE pela leitura de sessão; a limpeza automática dos sinais expirados ainda está pendente.

| Limite | Valor inicial |
|---|---|
| SDP | 32 KiB UTF-8 |
| Candidato ICE | 4 KiB UTF-8, campos definidos |
| Candidatos | 64 por lado |
| Pedido / resposta de sessão | 48 KiB /600 KiB |
| Salas por dia UTC | 20 como caller e 20 como callee |
| Operações por dia | 1.000 por ator /10.000 por projeto |
| Bytes de sinalização por dia | 8 MiB por ator /64 MiB por projeto |
| Rate limit por operação | 120 UID/minuto /1.200 projeto/minuto |

Leitura de sessão é consultada a cada 2,5 segundos e serializada. Limites são conservadores e requerem calibração operacional antes do rollout. Budgets não são devolvidos ao fechar. Rules recusam leitura/escrita SDK de rooms/candidatos e acesso aos roots privados; o cliente usa os callables. Não há novos índices ou dependências.

Eliminação de conta apaga rooms recursivamente, recibos nas duas direções, budgets e ambos os slots locais do próprio UID; mantém outras contas e o budget global com `uid:null`. Consulta/cancelamento após purga do peer não recriam referências a ele.

## Painel e correções encontradas

O painel usa o serviço novo para todo o SDP/ICE/fecho e mantém o botão de fecho após limpar a composição. Propostas legadas não são aceites pelo protocolo v2; precisam de reconciliação/purga. O botão de aceitação aguarda a identidade local. O aviso de envio permanece **colocado no canal, sem receção confirmada**; não é um ACK durável de conteúdo.

O ensaio com dois separadores encontrou o observador de identidade a reagir a qualquer StorageEvent. Sinalização do outro UID retirava o primeiro peer. O observador passou a filtrar a identidade/pedido/histórico da conta atual; alteração genuína da identidade e limpeza de storage continuam a invalidar o contexto. A projeção paginada de rooms v2 também passou a conservar `createdAt` para validar o próprio retorno.

## Evidência e alcance

1.014 frontend gerais /150 ficheiros antes das correções finais e testes adicionais; 99 focados finais /oito ficheiros, TypeScript/build web e lint escopo sem erros/avisos. Lint geral zero erros/23 avisos anteriores. 288 unitários Functions +um teste separado ignorado antes da regressão adicional da projeção; 20 focados finais (12 sinalização +oito listas). Quatro testes finais pipeline. Emuladores: 175 backend +23 frontend rules, incluindo SDK-deny, retries/corridas, expiração/revogação e cleanup.

Chromium usa painel/controladores/executores/RSA/AES/storage/locks reais e dois peers WebRTC nativos em loopback. Auth/RPC/DB são fronteiras sintéticas localhost. Confirma perda de ACK com mesma sala, fecho após perda local, admissão de oferta/resposta/ICE, decifragem da mensagem pelo peer e remoção de sinais ao fechar; inclui regressão relay/paginação. Zero pedidos externos, candidatos ICE externos, fornecedor ou produção. Diagnósticos conservados não contêm SDP, IPs ou conteúdo de cofre. Não substitui Auth Firebase real, STUN/TURN externo ou pilotos Android/Tauri.

Falhas iniciais/fixtures e correções ficam nos logs, incluindo mocks incompletos, tipos/lint, espera prematura do ACK, projeção de sala, observador de identidade, referência de mnemónica instável no fixture e botão de fecho oculto. Prova privada `W:\real\mnemosyne-launch-evidence\comms-p2p-signaling-local-validation-20261012.json`; logs `comms-p2p-signaling-validation-20261012`. 37 gates /18 fontes permanecem fechados. Audits anteriores não foram repetidos; manifests de dependências inalterados.

## Antes de abrir P2P

Faltam entrega de conteúdo com diário/UUID/ACK durável, fragmentação, limites/retoma/reconciliação, limpeza automática por expiração e reconciliação de rooms legadas. A referência local de sala não é backup nem retoma entre instalações. O ensaio positivo de DataChannel não prova esses critérios. Gate de sinalização do servidor e gate P2P do cliente continuam fechados até à conclusão e aos pilotos.

Rollout exige callables/cliente/rules coordenados: o cliente anterior deixa de escrever SDP/ICE diretamente. Rollback deve conservar as rules restritas e reverter apenas este incremento, com árvore misturada preservada. Retenção/identidades/equipas/writers legados, cloud/segredos/alertas/restauração/pilotos, qualidade, agentes/acessibilidade e validação final continuam nas fases 0–6. Deploy completo depois de todas as áreas concluídas, conforme autorização humana.
