# Autorizações de agente por cofre — 21 de outubro de 2026

## Continuação local — propostas cifradas revistas, 21 de outubro

O protocolo descrito em [AGENT_MUTATION_APPROVAL.md](AGENT_MUTATION_APPROVAL.md) acrescenta propostas edit/delete para uma memória existente, consentimento memories:write com prefixos mne_review_code_/mne_review_, revisão decifrada no cliente e aprovação transacional vinculada ao digest. API/MCP/SDK não aprovam; criação direta foi retirada. Recibos, quotas, auditoria e recuperação de ACK perdido são locais e ainda não publicados. A reversão continua pendente; não se declara a fase 6 concluída. Os parágrafos de incrementos anteriores conservam o seu estado histórico.


Implementação local, ainda não publicada. Acrescenta leitura/pesquisa de um cofre de equipa ao gateway OAuth/PKCE pessoal. A escrita aprovada, preview/diff e reversão de mutações continuam requisitos da fase 6.

## Problema, ameaça e decisão

Uma autorização apenas com `memories:read`/`memories:search` não identifica a equipa autorizada. O Admin SDK ignora as regras do cliente, por isso o gateway precisa de selecionar e validar o cofre antes de consultar documentos. Um argumento fornecido pelo agente não pode mudar esse âmbito, e uma resposta em curso não deve ser entregue depois de uma revogação observada.

Foi escolhido um cofre exato por consentimento: `personal` ou `team:<ID>`. O parâmetro opcional `vault` pertence ao URL de autorização; omiti-lo conserva o âmbito pessoal. Arrays, valores vazios, paths com `/` e seletores desconhecidos são recusados. O ID de equipa é literal, sem interpretação de padrões. O cliente registado precisa permitir explicitamente o tipo `team`; um registo antigo permite apenas `personal`.

As chaves permanentes e as sessões derivadas de uma chave permanente conservam o âmbito pessoal. O acesso de equipa usa o consentimento OAuth curto, UID esperado e PKCE existentes. Não são entregues wrapped keys, mnemónicas, chaves de cofre ou conteúdo decifrado ao gateway.

Códigos de equipa usam `mne_vault_code_` e tokens usam `mne_vault_`. Os prefixos pessoais existentes são `mne_code_`/`mne_agent_`. Isto faz os parsers antigos recusarem as novas credenciais de equipa durante rollout/rollback, em vez de lhes atribuir o âmbito pessoal. O novo servidor também compara prefixo/âmbito e o cliente só aceita o tipo de código do cofre confirmado. A evidência local de compatibilidade executa os parsers anteriores com inputs sintéticos e comprova recusa antes de acesso a dados; não é um teste do serviço antigo publicado.

## Contrato e estado da autorização

Exemplo sintético de registo administrativo, **não aplicado em produção**:

```json
{
  "name": "Aplicação de exemplo",
  "enabled": true,
  "redirectUris": ["https://client.example/callback"],
  "scopes": ["memories:read", "memories:search"],
  "vaultTypes": ["personal", "team"]
}
```

O pedido de autorização acrescenta `vault=team%3A<ID>` aos parâmetros PKCE. O preview mostra conta, aplicação, nome e ID do cofre, permissões, destino e duração. O digest inclui o pedido normalizado, a configuração do cliente e a admissão do cofre. Na confirmação, a transação revalida membership, owner disponível, rotação concluída, época ativa e presença do wrap do titular na equipa/época; não devolve esses wraps.

Cada grant é identificado por UID/aplicação/cofre. Autorizar novamente substitui apenas esse grant. O limite transacional de vinte autorizações ativas continua agregado por UID, incluindo todos os cofres. Revogar uma autorização de equipa não revoga as restantes autorizações da mesma aplicação.

Grant, código e sessão de equipa guardam `vault` com ID, época, key ID e hashes dos snapshots de equipa/época, incluindo as suas versões. Uma mudança desses snapshots invalida o preview/código/token anterior, mesmo que os valores regressem ao estado anterior. Isto inclui mudanças de membership, roles, wraps, nome ou rotação; exigir consentimento novo após alterações de metadata é uma escolha conservadora de disponibilidade. Campos `vault` ausentes em registos antigos significam apenas pessoal; campos presentes mas inválidos são recusados.

## REST/MCP e fronteiras de leitura

O token seleciona o backend do cofre. Não existe fallback de uma autorização de equipa para a leitura pessoal. Argumentos `teamId`/`vault` de ferramentas não escolhem outro backend. Listagem, leitura por ID, cursor e pesquisa ficam limitados à mesma equipa. O gateway revalida a credencial antes de devolver os resultados; a leitura de equipa verifica também o acesso antes/depois e exclui autores com marcador de eliminação ou perfil em eliminação. Uma alteração de acesso durante a preparação do resultado impede a sua entrega.

São devolvidos envelopes v1 legados ou v2 de equipa e metadata permitida, com `teamId`, `keyEpoch` e `keyId`. Não se devolvem campos `text`, `title` ou material de chave. Os vetores continuam sensíveis e em claro no servidor; ranking só compara o mesmo espaço `embeddingModel`. A pesquisa por tags/IDs/category continua disponível sem vetor.

A consulta usa o índice já definido `sessions(teamId ASC, timestamp DESC)`. Lê páginas de dez, até 2.000 documentos examinados, e conserva no máximo 8 MiB de documentos elegíveis. A pesquisa considera até 500 elegíveis dentro desse orçamento; não é exaustiva. Os objetos de memória de list/get/search ficam limitados a 3 MiB. A listagem conserva um cursor após o último resultado incluído, mesmo quando o limite de bytes reduz a página. Os wrappers JSON acrescentam alguns bytes; não se alega um limite de 3 MiB para todo o transporte. O `tradeoff` da pesquisa declara os limites. Queries GET/embeddings ainda podem aparecer em logs de infraestrutura; isso não foi certificado.

## Schema, migração, publicação e rollback

Não há coleção, regra ou índice novo. `agentClients` ganha `vaultTypes`; grants/códigos/sessões ganham a admissão `vault`, grants guardam o nome apresentado e os eventos de consentimento/sessão passam a schema 2 com o seletor do cofre. A listagem/revogação mostra o cofre e associa o botão à sua descrição acessível. O ID pessoal antigo é preservado, e registos antigos não recebem autoridade de equipa por omissão.

Antes de habilitar integrações de equipa: cumprir os gates das fases 0–6, confirmar índice READY, terminar a migração/pilotos de equipas e publicar Functions antes de Hosting. Rever cada registo administrativo e os destinos/CORS antes de permitir `team`. Nenhuma configuração de produção foi alterada por este incremento. Desabilitar a aplicação ou retirar `team` do registo bloqueia os pedidos; não usar um rollback que ignore `vault` e faça leituras pessoais com um token de equipa. As chaves antigas continuam revogadas segundo o procedimento operacional; esta alteração não prova a revogação histórica dos fornecedores.

## Validação e risco residual

Os testes novos exercitam isolamento entre pessoal/duas equipas, default pessoal legado, opt-in do registo, tampering de sessão, preview/código/token após ABA/rotação/membership, marcadores de eliminação, revogação em curso, envelopes v2, espaço vetorial e paginação por bytes. A primeira execução do emulador encontrou o default REST incorreto quando `limit` era omitido: uma string vazia era convertida para zero e limitada a um. O parser foi corrigido e foi acrescentado um caso HTTP para os defaults 50/20. O log inicial com 12 casos aprovados/uma falha foi preservado.

A primeira suite geral cliente teve um timeout no teste de foco da lista, mantendo 1.571 casos aprovados. A consulta do teste foi ajustada para verificar o elemento efetivamente focado, com role, nome acessível e visibilidade, em vez de calcular nomes acessíveis para todos os resultados de cada página. Mantêm-se as duas vistas, 205 resultados, mudança para os resultados 100/200, remoção do botão na última página e timeout de cinco segundos. O componente de produto não foi alterado. Os 34 focados passaram, incluindo os quatro de paginação; typecheck e lint do teste também passaram. A execução geral posterior fica vinculada na prova.

Resultados finais e hashes estão no estado de lançamento e na prova do incremento. Os handlers foram exercitados diretamente, com Firestore/Storage em projeto demo; isto não é um ensaio de rede do serviço publicado. Índices/IAM/App Check, clientes antigos, dispositivos, leitores de ecrã reais, grandes cofres e latência de produção continuam por validar. Uma resposta já enviada não pode ser recolhida; permanecem possíveis mudanças após a última verificação. A comparação de snapshots aumenta leituras e renovações de consentimento. Não se anuncia escrita de agente nem conclusão da fase 6 com esta alteração.
