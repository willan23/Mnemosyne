# @mnemosyne/sdk

Cliente TypeScript mínimo da [API pública v1](../../functions/openapi-v1.yaml). Pacote **privado** — não está no npm.

O SDK **não decifra** `enc`. Devolve metadados e ciphertext do servidor. Embeddings, tags e IDs são dados sensíveis para autorização e telemetria. As escritas v1 continuam suspensas no servidor enquanto o protocolo de aprovação de mutações não estiver concluído.

## Uso

```ts
import { MnemosyneClient } from '@mnemosyne/sdk';

const client = new MnemosyneClient({
  apiKey: 'mne_live_…',
  // baseUrl default: https://mnemosyne-one.web.app
});

await client.listMemories();
await client.getMemory('session-id');
await client.search({ q: '', tags: ['ideia'] });
// Para um vector calculado no cliente, indica o espaço real do modelo:
// await client.search({ embedding, embeddingModel, ids: ['session-id'] });
```

`createMemory` está retirado e falha localmente sem rede. Para uma memória existente, `prepareMemoryChange({sessionId,teamId})` prepara o baseline; `proposeMemoryChange(request)` submete um único pedido cifrado edit/delete com UUID v4 estável; `getMemoryChange({proposalId,digest})` consulta o recibo. Exigem consentimento OAuth de proposta e token `mne_review_` do cofre exato. O SDK não aprova nem decifra: o titular revê e confirma no cliente Mnemosyne. Os gates continuam fechados e a reversão permanece pendente. Ver [contrato e limites](../../docs/AGENT_MUTATION_APPROVAL.md).

## Transporte e erros

O endpoint por omissão é `https://mnemosyne-one.web.app`. Um `baseUrl` explícito deve indicar a raiz de uma origem HTTPS, sem utilizador/password, query, fragmento ou prefixo de caminho. HTTP é admitido apenas para `localhost`, `127.0.0.1` e `::1` no desenvolvimento local.

Todos os pedidos recusam redirects, omitem cookies/referrer e usam `cache: no-store`. O deadline inclui a leitura do corpo. `timeoutMs` é 30 000 por omissão e admite 1–120 000 ms. `maxResponseBytes` é 4 MiB por omissão e admite até 16 MiB, contados sobre os bytes descodificados de transporte; para páginas cifradas grandes, reduz `limit` ou aumenta o orçamento dentro desse máximo. Um override `fetch` deve respeitar a semântica de Fetch e o `AbortSignal` recebido.

`MnemosyneApiError` conserva o status HTTP e tem mensagem fixa e `body: null`. Corpos de erro, mensagens remotas e exceções de rede integrais são descartados. `MnemosyneTransportError.code` identifica configuração inválida, falha de pedido, deadline, tamanho excessivo ou JSON/UTF-8 inválido. A credencial usa um campo privado JavaScript e não aparece na enumeração/serialização do cliente.

As pesquisas GET continuam a transportar os filtros e o vector na query da API v1. O SDK conserva `embeddingModel` e `ids`; omitir o espaço do modelo significa pesquisa vetorial legada no servidor. Não se afirma que o transporte GET retire metadata sensível dos logs de infraestrutura. Preview/autorizações de agentes e testes de clientes reais ficam fora deste incremento.

## Validação no repositório

Os testes em `functions/test/publicSdk.test.js` executam o SDK real, verificam a sua configuração TypeScript estrita e usam HTTP em loopback para redirects, corpo interrompido e gzip descodificado. Integram `npm --prefix functions test`, executado pela CI e pelo procedimento completo de deploy. O pacote continua privado.

## Smoke sem key (401)

```powershell
cd W:\real\Mnemosyne\packages\sdk
npm install
npm run build
npm run example:unauth
```

O exemplo chama `GET /api/v1/memories` sem Bearer e espera HTTP 401.
