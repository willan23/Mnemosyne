# Decisões da fase 2 — fornecedores, modelos e custo

Estado: **em execução**. Os documentos abaixo registam decisões e incrementos; a fase ainda não cumpre todos os critérios externos e de rollout.

Em 9 de outubro, os pedidos HTTP de geração/pesquisa passaram a exigir o token da conta capturada e a revalidar o UID após obtê-lo. A pesquisa aplica consentimento/contexto/limites de transporte e gravação recuperável descritos em [PESQUISA_WEB_RECUPERAVEL.md](PESQUISA_WEB_RECUPERAVEL.md). O email operacional confirmado é wgftechnologies@gmail.com; aplicação/receção de alertas permanece no rollout. Não se enviaram notificações nem se ativaram recursos de produção neste incremento.

| Área | Decisão/evidência | Limite atual |
|---|---|---|
| Planos, modelos, orçamento e âmbito | [Orçamentos e âmbito](ORCAMENTOS_IA_E_AMBITO_GERACAO.md) | Reservas técnicas, sem teto monetário/piloto publicado |
| Eventos e alertas | [Observabilidade de IA](OBSERVABILIDADE_IA_E_ALERTAS.md) | Configuração preparada; aplicação, receção e calibração pendentes |
| Credenciais e isolamento Functions | [Migração de secrets](MIGRACAO_SECRETS_FUNCTIONS.md) | Ligação local testada; recursos, revogação e piloto reais pendentes |

O [estado de lançamento completo](ESTADO_LANCAMENTO_COMPLETO.md) mantém os critérios das fases 0–6 e a autorização de publicar apenas após concluir todas as áreas. Imagens persistem como bytes cifrados no âmbito da memória, dentro dos protocolos de anexos; os gates de migração/recuperação continuam fechados. Não houve alteração de preços, ativação de Stripe, fallback silencioso ou deploy destes incrementos.
