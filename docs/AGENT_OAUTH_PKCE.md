# Autorização de aplicações com PKCE

## Continuação local — propostas cifradas revistas, 21 de outubro

O protocolo descrito em [AGENT_MUTATION_APPROVAL.md](AGENT_MUTATION_APPROVAL.md) acrescenta propostas edit/delete para uma memória existente, consentimento memories:write com prefixos mne_review_code_/mne_review_, revisão decifrada no cliente e aprovação transacional vinculada ao digest. API/MCP/SDK não aprovam; criação direta foi retirada. Recibos, quotas, auditoria e recuperação de ACK perdido são locais e ainda não publicados. A reversão continua pendente; não se declara a fase 6 concluída. Os parágrafos de incrementos anteriores conservam o seu estado histórico.


## Atualização local — cofre pessoal ou equipa, 21 de outubro de 2026

O [contrato por cofre](AGENT_VAULT_SCOPES.md) acrescenta `vault=personal` (omissão) ou `vault=team:<ID>` ao pedido de autorização. O registo administrativo precisa permitir o tipo `team` explicitamente. O preview mostra a conta e o cofre exato; digest, código, grant e sessão ficam vinculados a esse âmbito e ao estado da equipa/época. Alterações desse estado, incluindo ABA, exigem consentimento novo.

Equipa usa códigos `mne_vault_code_` e tokens `mne_vault_`, distintos dos prefixos pessoais `mne_code_`/`mne_agent_`. Os parsers antigos recusam estes formatos; o cliente verifica o prefixo de código correspondente ao cofre pedido. O gateway novo também recusa promover registos pessoais para os prefixos de equipa ou apresentar autoridade de equipa com um prefixo pessoal. Não há delegação de tokens de equipa.

REST/MCP seleciona o backend pela credencial. A leitura revalida o acesso e a credencial antes de entregar envelopes/metadata; não há seleção de outro cofre por argumentos nem fallback pessoal de um token de equipa. Chaves permanentes e sessões derivadas delas permanecem pessoais. Grant/código/sessão antigos sem `vault` também permanecem pessoais. Um grant é agora UID/aplicação/cofre; o limite agregado de vinte continua por UID. A revogação identifica o cofre, incluindo o seu ID e descrição acessível.

Ainda não publicado. O índice de equipa já definido precisa estar READY; migração, validação de equipas, todos os gates e rollout Functions antes de Hosting continuam obrigatórios antes do opt-in de clientes reais. Escrita aprovada, preview/diff e reversão continuam pendentes. O documento ligado detalha limites de bytes/corpus, schema, compatibilidade, rollback e testes.

## Atualização local — controlos vinculados à conta, 21 de outubro de 2026

Preview, autorização, listagem, revogação e alteração do acesso exigem agora `expectedUid` igual ao UID do contexto Firebase Auth. A validação ocorre antes de rate limit/dados. O frontend conserva esse UID e retira respostas/vistas anteriores após uma troca de conta, incluindo logout e regresso ou A→B→A sem renderização intermédia. Os pedidos não podem selecionar outra conta. Esta alteração ainda não foi publicada.

O controlo de acesso exige também o baseline `{disabled,epoch}` recebido numa snapshot confirmada pelo servidor. A transação só altera o estado se o baseline ainda corresponder ao perfil. Parar incrementa a época; retomar nunca ressuscita códigos/tokens anteriores. Comandos antigos ou concorrentes incompatíveis são recusados, com um único evento por transição. Valores corrompidos/overflow são recusados. Os eventos de transição passam a `schemaVersion:2` com `accessEpoch`; não há coleção/regra/índice novo.

Publicar Functions antes de Hosting, na sequência já prevista pelo procedimento completo. Clientes antigos sem UID/baseline deixam de operar estes controlos até atualizar. Não fazer rollback para validação que omita o UID ou a época. Uma operação já admitida pode concluir depois da troca de conta; descartar a resposta no cliente não cancela o servidor. Quando o ACK se perde, consultar o estado: a comparação de baseline não fornece um recibo idempotente de resultado. Os testes, decisões e limites constam de [DECISOES_FASE6.md](DECISOES_FASE6.md).

Implementação local inicial em 30 de setembro de 2026, ampliada por cofre em 21 de outubro. Ainda não publicada. Permite consentimento explícito para leitura/pesquisa de envelopes cifrados, sem entregar uma chave permanente ao agente. Não abre mutações.

## Registo administrativo

O servidor aceita apenas documentos `agentClients/{client_id}` criados por um operador com Admin SDK. Não há registo dinâmico nem escrita pelo cliente Firestore. IDs têm 3–64 caracteres `A–Z`, `a–z`, dígitos, `_` ou `-`.

Schema de exemplo sintético, **não criado em produção**:

```json
{
  "name": "Aplicação de exemplo",
  "enabled": true,
  "redirectUris": ["https://client.example/callback"],
  "scopes": ["memories:read", "memories:search"],
  "vaultTypes": ["personal", "team"]
}
```

O retorno deve corresponder exatamente a um dos endereços registados. Só HTTPS, sem credenciais ou fragmento, e sem parâmetros reservados `code`, `state`, `error`, `iss`. Não existem wildcards, loopback ou esquemas nativos nesta implementação. Máximo de dez retornos por aplicação. O nome é exibido ao titular antes de autorizar. Alterar nome, retornos ou scopes entre preview e confirmação invalida aquele preview.

Aplicações que trocam o código no browser precisam também de origem aprovada em `PUBLIC_API_CORS_EXTRA_ORIGINS`; o registo do retorno não abre CORS. Integrações que trocam o código num processo sem header Origin não precisam deste passo. Nunca usar uma chave permanente num browser para contornar este fluxo.

## Pedido e consentimento

1. Gerar um verifier aleatório de 43–128 caracteres não reservados, guardar somente na memória do cliente e calcular `BASE64URL(SHA256(verifier))`, sem padding. Gerar state imprevisível de 16–512 caracteres não reservados e conservar o valor para comparar no retorno.
2. Abrir `https://mnemosyne-one.web.app/agent/authorize` com todos os parâmetros abaixo, uma ocorrência de cada um. A página recusa parâmetros ausentes, duplicados ou desconhecidos.
3. O titular inicia sessão Firebase Auth, vê aplicação, conta, permissões, destino e duração, e escolhe Autorizar ou Recusar. Iniciar sessão não emite código nem faz o retorno automaticamente.

```text
response_type=code
client_id=<id registado>
redirect_uri=<retorno HTTPS exato>
scope=memories:read memories:search
state=<valor aleatório conservado no cliente>
code_challenge=<hash S256 do verifier>
code_challenge_method=S256
vault=personal ou team:<ID exato> (opcional; omissão pessoal)
```

A confirmação passa por `authorizeAgentClient`, com UID esperado, `confirmed:true` e digest do preview autenticado. O UID vem do contexto Firebase Auth; o payload não escolhe outra conta. O servidor revalida conta, suspensão, aplicação, scopes e admissão do cofre na transação. O código aleatório de 256 bits usa `mne_code_` para pessoal ou `mne_vault_code_` para equipa e dura dois minutos. Só o hash é persistido. Recusar devolve `error=access_denied`, sem emissão.

O retorno inclui `state` e `iss=https://mnemosyne-one.web.app`. A integração deve validar ambos antes de trocar o código. A página usa `location.replace`, política de referrer ausente e headers de Hosting que proíbem enquadramento; estes headers só entram em vigor quando o Hosting for publicado. A correspondência exata do retorno e S256 seguem os mecanismos das [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html) e [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html). Não é uma declaração de conformidade com todos os perfis OAuth.

## Troca e utilização

Enviar POST a `/api/v1/oauth/token`, com JSON ou formulário `application/x-www-form-urlencoded`. Estes dois tipos são convertidos para `request.body` pelo runtime HTTP Firebase, conforme a [documentação de Functions de primeira geração](https://firebase.google.com/docs/functions/1st-gen/http-events-1st#read_values_from_the_request). Os testes locais do handler usam o objeto já convertido; não ensaiaram um request HTTP no serviço publicado.

```text
grant_type=authorization_code
client_id=<mesmo id>
redirect_uri=<mesmo retorno>
code=<código recebido>
code_verifier=<verifier original>
```

Não exige uma chave de API. A transação verifica código, expiração, aplicação, retorno, prova PKCE, consentimento vigente, época do kill switch e conta disponível; consome o código e cria sessão/evento na mesma transação. Duas trocas concorrentes não emitem dois tokens. Uma prova incorreta não consome o código legítimo.

Resposta: `access_token`, `token_type:Bearer`, `expires_in:900`, `scope`. Headers `Cache-Control:no-store` e `Pragma:no-cache`. O token usa `mne_agent_` para pessoal ou `mne_vault_` para equipa e autentica REST/MCP; a API devolve envelopes cifrados e metadados apenas no cofre autorizado. Não permite delegação, refresh ou escrita. Trocas têm limite independente de 30/minuto por IP da plataforma, ignorando X-Forwarded-For fornecido pelo cliente. Preview, confirmação, listagem e revogação partilham limite de 20/minuto por UID.

## Revogação e retenção

Cada conta tem no máximo vinte autorizações ativas, verificadas em transação e agregadas por todos os cofres. A listagem filtra revogadas no servidor para que histórico não esconda aplicações ativas. Nova confirmação substitui a versão da autorização para essa conta/aplicação/cofre: invalida códigos e tokens anteriores e mantém o mesmo ID para rate limiting. Isto impede multiplicar o limite emitindo novas sessões dessa autorização.

O painel Aplicações autorizadas lista metadados do titular via callable e revoga por ID. `revokeAgentGrant` confirma propriedade em transação, invalida códigos/tokens e regista evento sem segredos. Parar acesso invalida tokens e códigos por época; retomar não os ressuscita. Desabilitar uma aplicação ou reduzir os seus scopes é revalidado em cada pedido. Nenhuma revogação cancela um pedido que já passou a autenticação ou apaga dados que o agente recebeu.

Coleções novas: `agentClients`, `agentGrants`, `agentAuthorizationCodes`; sessões OAuth usam `grantId`, `clientId`, `grantVersion` em vez de `parentKeyId`. Regras recusam todo o acesso direto às quatro coleções de agente. Account deletion limpa autorizações, códigos, sessões e eventos. O índice `agentGrants(uid ASC, revoked ASC)` deve estar READY antes de habilitar aplicações. O emulador não prova disponibilidade de índices em produção.

TTL: `deleteAfter` é preenchido em códigos/sessões. A limpeza TTL ainda precisa ser configurada; expiração é aplicada na autenticação mesmo sem limpeza. Grants/eventos não têm TTL nesta etapa. Não há armazenamento de tokens ou verifier em claro no Firestore nem logs de erro com estes valores.

## Publicação e rollback

Antes de publicar: cumprir os gates gerais das fases 0–6, publicar/verificar índice, publicar Functions `publicApi`, `previewAgentAuthorization`, `authorizeAgentClient`, `listAgentGrants`, `revokeAgentGrant`, `deleteUserAccount`; incluir regras, headers e frontend. Só então registar/habilitar integrações reais com destinos aprovados e configurar CORS quando aplicável. Não foi executado este registo, TTL, índice ou deploy.

Rollback seguro: desabilitar aplicações no registo, parar acesso e conservar validação de grants/épocas no gateway. Retirar a página não revoga tokens já emitidos. Repor um gateway antigo sem kill switch pode reabrir credenciais suspensas. O desktop login bridge anterior é um protocolo distinto e não foi transformado em OAuth por esta alteração.

## Limites para a fase 6

Esta etapa implementa consentimento/PKCE por cofre pessoal/equipa em código local. Ainda faltam aprovação de mutações, preview/diff, payload/idempotência/reversão para escrita, histórico visual e auditoria completa de pedidos. Não há descoberta OAuth, refresh tokens, registo dinâmico, client credentials, device grant ou confirmação em dispositivos reais.
