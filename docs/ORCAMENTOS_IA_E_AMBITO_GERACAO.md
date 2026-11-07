# Orçamentos de IA e âmbito da geração — 3 de outubro de 2026

## Estado

Incremento local da fase 2. Não houve deploy, mudança de preços, chamada a fornecedor real ou abertura de gates. A fase completa continua pendente dos critérios no [estado de lançamento](ESTADO_LANCAMENTO_COMPLETO.md).

## Autoridade e plano

O servidor resolve o modo em `config/monetization` e os planos em `entitlements`. Não usa a subscrição editável do perfil, nem aceita plano, limites ou débito enviados pelo cliente. Modo ausente/free-first mantém a política técnica preview; em modo paid, uma conta sem entitlement recebe free. Registos malformados e planos desconhecidos recusam a admissão. O estado premium segue a política Stripe existente: active, trialing e past_due.

Free pago admite apenas o modelo de texto básico definido pelo servidor. Pro, Sovereign e preview usam a allowlist existente dentro dos limites. Não se aumentou o teto técnico anterior de Pro/Sovereign. Valores herdados de `Object.prototype`, como `constructor` e `__proto__`, deixaram de passar pela resolução de modelos.

Para uma equipa, o servidor verifica membros, proprietário, marcadores permanentes de eliminação, época ativa, ausência de rotação e igualdade dos mapas de wraps da equipa/época. O plano do proprietário patrocina o orçamento partilhado: Sovereign no modo paid, ou preview em free-first. O membro continua sujeito ao teto técnico global da sua conta. A operação da equipa não gasta a sua franquia pessoal.

## Reservas técnicas

As janelas usam UTC. Uma transação reserva todos os contadores ou não altera nenhum deles. A reserva permanece consumida se o fornecedor falhar ou o resultado for suprimido após revogação: não se presume que a chamada externa deixou de ter custo.

| Janela/plano | Pedidos | Bytes de entrada | Unidades de entrada reservadas | Máximo de saída reservado | Imagens | Unidades relativas de custo |
|---|---:|---:|---:|---:|---:|---:|
| Mês — preview, Pro, Sovereign | 200 | 300 000 | 402 400 | 100 000 | 20 | 200 |
| Mês pessoal — free em paid | 50 | 75 000 | 100 600 | 25 000 | 0 | 50 |
| Hora — teto técnico | 60 | 100 000 | 130 720 | 60 000 | 20 | 100 |

Cada pedido reserva bytes UTF-8 do prompt + 512 unidades para entrada; texto reserva o máximo de saída solicitado dentro da allowlist, imagem reserva zero saída textual. Estes valores são aproximações técnicas, **não são tokens faturados nem preços em moeda**. As unidades relativas por modelo permanecem as existentes. Os limites acumulados aplicam-se em simultâneo; por exemplo, uma imagem com custo relativo 20 esgota a janela de custo antes do limite de imagens.

Ledgers privados: `aiBudgets` (global mensal), `aiPersonalBudgets` (pessoal mensal), `aiBudgetWindows` (global horário), `teamAiBudgets` e `teamAiBudgetWindows` (equipa). As regras recusam leitura, listagem e escrita do cliente, incluindo proprietário/membros. A eliminação de conta inclui os ledgers pessoais; a eliminação da equipa inclui os seus ledgers partilhados, conservando dados de outras equipas. `expiresAt` nos documentos horários é metadata numérica; não se configurou TTL automático nem se afirma que esses documentos desapareçam ao fim de 48 horas.

## Compatibilidade com consumo legado

Os IDs novos têm namespace user/team e hash SHA-256 do identificador completo, evitando colisões provocadas pela sanitização antiga. Não contêm prompts ou identificadores em claro no nome; o documento privado contém a ligação ao âmbito necessária para validação/eliminação.

A transação lê sempre o contador mensal legado. Para o mesmo UID, conserva o máximo por campo e integra apenas o consumo novo de instâncias antigas no ledger pessoal. Atualiza o espelho legado para que um rollout com instâncias de versões diferentes não reinicie a franquia mensal. Quando o contador antigo pertence a outro UID válido, conserva-o e usa o namespace novo para o utilizador atual. UID ausente, período errado, contador negativo, incompleto ou inválido recusam a reserva e exigem revisão; não se atribuem dados ambíguos ao requerente.

A compatibilidade conserva consumo mensal; não reconstrói a distribuição horária antiga nem impõe retroativamente planos/equipas a instâncias antigas. O piloto de rollout deve escoar essas instâncias e confirmar a revisão ativa antes de afirmar cobertura integral dos novos limites.

Não se devolvem contadores privados ao cliente. O HTTP usa 400 para contrato/modelo inválido, 403 para acesso/plano recusado, 429 para orçamento esgotado e 503 quando não pode verificar/reservar com segurança.

## Geração e persistência no cliente

`withAiGenerationContext` captura UID, política, cofre e destino pessoal/equipa. A subscrição mantém uma mudança de conta bloqueada mesmo que o utilizador volte à conta inicial. O contexto mantém-se ativo desde o pedido até à persistência e revalida a equipa no servidor. Mudança de UID/política, bloqueio do cofre, invalidação da cache ou rotação revogam o contexto e abortam o fetch quando possível. Um pedido que já chegou ao fornecedor não pode ser retraído por essa proteção.

Os endpoints recebem `expectedUid` e scope/época/chave, sem incluir memórias existentes no prompt. Revalidam a admissão antes do fornecedor, depois do fornecedor e antes da resposta. Mudanças de acesso ou plano suprimem o resultado; o servidor não o guarda como memória.

O cliente cifra e guarda texto na chave pessoal ou na época da equipa. Uma geração de equipa não faz fallback para escrita pessoal. A revisão mantém UID/equipa originais e, para equipas, usa a persistência transacional com CAS e arquivo. Enriquecimento local exclui memórias de outros âmbitos, bloqueadas e apagadas. O contexto impede escritas recíprocas implícitas nas gerações.

Imagens usam bytes e o upload cifrado no mesmo âmbito; URLs do fornecedor não são aceites como anexo. A interface só anuncia sucesso/apresenta a imagem guardada depois da confirmação da aprendizagem. Falha no upload é propagada. Enquanto os novos anexos estão fechados, esse fluxo não chama o fornecedor para depois falhar na gravação. Os testes habilitam gates apenas nos fixtures; a configuração do produto permanece fechada.

As verificações de contexto não equivalem a rollback de uma escrita já enviada. ACK perdido, recuperação durável de texto pessoal, limpeza de uploads pendentes e dispositivos continuam sujeitos aos protocolos/gates restantes.

## Validação e pendências

Testes focados do cliente: 25 casos de contexto, privacidade e aprendizagem, mais quatro casos do componente de captura passaram em Node 22.23.3. A suite geral frontend passou **527 testes em 106 ficheiros**, o build TypeScript/Vite passou e o lint terminou com **zero erros e 23 avisos**, sem desligar regras. O build conservou o aviso de chunks grandes; os testes do componente emitiram o aviso de `scrollTo` não implementado no DOM simulado. Esses resultados não comprovam os pilotos de dispositivos.

Functions passou **153 testes unitários**, com o teste de rules corretamente omitido fora do emulador. A suite completa final de rules passou **112 Functions +22 frontend**, em `demo-mnemosyne-rules`, Node 22.23.3 e JBR 21, com saída zero e emuladores terminados. Inclui os cinco casos novos de ai-cost, a revogação HTTP antiga e a limpeza/preservação dos ledgers durante eliminação.

Cinco casos focados de ai-cost passaram antes da verificação completa. O primeiro run completo terminou com 111/112: encontrou um mock antigo aplicado ao getter de re-exportação. Corrigiu-se para interceptar o módulo que define a reserva, mantendo as mesmas asserções de revogação; a repetição completa ficou verde. O primeiro run focado do cliente usou um keyId sintético que não cumpria o contrato UUID v4; corrigiu-se o fixture e os casos afetados passaram nas verificações posteriores. Os logs iniciais são conservados como diagnóstico, sem os apresentar como validação final.

A prova local `W:\real\mnemosyne-launch-evidence\ai-cost-local-validation-20261003.json` contém resultados, runtime, hashes dos ficheiros/artefacto web e logs. Assinala `releaseReady=false`, `allPhasesComplete=false`, gates fechados e ausência de mutações de produção. A prova anterior de reconciliação conserva a sua cronologia; não é reutilizada como prova desta revisão.

Para fechar a fase 2 ainda faltam a avaliação do custo efetivo/tokenização por fornecedor, logs/alertas operacionais de abuso e custo, verificação de secrets/revogação histórica, cobertura de quotas das restantes operações, retenção dos ledgers e piloto dos planos/equipas. Os limites aqui não são uma garantia de teto monetário nem a confirmação da configuração publicada.
