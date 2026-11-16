# Cápsulas públicas: leitura, contagem e retirada

## Estado

Atualização da publicação/gestão: [contrato, retirada ligada à origem e recuperação](PUBLICACAO_E_GESTAO_CAPSULAS.md). O novo cutover fecha também get/list próprios e create SDK; a gestão usa uma projeção autenticada do servidor. As contagens abaixo e a prova original conservam o âmbito da primeira validação de leitura; o estado de lançamento distingue as validações posteriores.

Implementação local de 18 de outubro de 2026. `CAPSULE_PUBLIC_ACCESS_ENABLED=false` mantém a nova leitura e contagem fechadas até ao rollout validado. A retirada autenticada continua disponível com esse gate fechado. Nenhuma destas Functions ou regras foi publicada neste incremento.

Esta alteração fecha a leitura pública do documento Firestore bruto, que podia conter UID, ID privado da memória, título e campos históricos em claro. O cliente público passa a receber apenas versão, ID público, geração opaca, envelope cifrado, datas opcionais, contagem opcional, prazo da abertura e digest de origem. Campos desconhecidos são recusados pelo cliente. Documentos legados sem cifra válida deixam de ter leitura pública; continuam preservados para classificação pelo proprietário.

## Contrato e privacidade

- `getPublicCapsule`: `{v:1,shareId}`. Consulta fonte, perfil/marcador e estado Auth do proprietário, e volta a verificar a fonte antes de responder. Auth e Firestore continuam a ser serviços distintos, sem uma transação comum.
- `recordCapsuleOpening`: `{v:1,shareId,openingId,sourceDigest,viewDeadline}`. Incrementa apenas no servidor, juntamente com um recibo privado. A mesma operação repetida não reescreve a data nem volta a incrementar. Uma resposta perdida permite uma tentativa adicional com o mesmo comando.
- `revokePublicCapsule`: `{v:1,actorUid,shareId}`. Exige conta autenticada correspondente, consulta Auth, aplica rate limit por UID e confirma propriedade/perfil/marcador na transação. Acrescenta `revokedAt`, preservando cifra e recibos. Repetir é inofensivo. Não exige a chave do cofre pessoal.

A leitura pública usa diretamente o [protocolo de callables](https://firebase.google.com/docs/functions/callable-reference), com JSON limitado, timeout, credenciais omitidas e referrer suprimido. Não envia Auth, cookies, passphrase, fragmento do link ou texto decifrado. A chave e a decifragem continuam no cliente. Não é uma prova de anonimato perante o fornecedor de rede, nem uma mitigação de dispositivos comprometidos.

O digest cobre cifra, origem e datas, excluindo contagens. A geração inclui a criação física do documento, impedindo que a remoção e recriação do mesmo ID aceitem um comando antigo. Não certifica autoria histórica ou leitura humana. A contagem representa aberturas aceites pelo servidor; não mede visitantes únicos nem impede automação dentro do orçamento admitido. Estatísticas/datas históricas inválidas permanecem desconhecidas, sem inventar zeros. O servidor recusa incrementar contagens inválidas.

## Custos, recibos e retenção

O orçamento transacional admite no máximo 10.000 operações públicas por dia e 200 por grupo de rede/dia. Leitura e abertura partilham esse orçamento, incluindo tentativas repetidas. O agrupamento usa um hash diário de `rawRequest.ip`; é uma heurística sujeita ao ambiente de proxies, sem valor de autorização. Não se guarda o IP bruto. O hash é pseudónimo e não deve ser apresentado como anonimização.

O limite global restringe o trabalho admitido. Pedidos recusados, tráfego HTTP, consultas do próprio limitador e operações de infraestrutura também podem ter custos. Estes números precisam de calibração, observabilidade e ensaio no ambiente real antes da abertura do gate.

Os recibos estão em `shares/{id}/capsuleOpenings/{hashDoOpeningId}`, sem identidade do visitante. O comando tem validade máxima de dez minutos para criar o recibo; o Timestamp de retenção é o prazo original mais um dia. Depois de removido o recibo, o mesmo comando já expirado não pode voltar a contar. Um novo comando é uma nova abertura, sujeita ao orçamento.

Os documentos de orçamento recebem Timestamp de expiração no início do terceiro dia seguinte ao identificador diário. `firestore.indexes.json` prepara TTL em `expiresAt` para `publicCapsuleBudgets` e `capsuleOpenings`, sem indexação desse campo. **As políticas ainda não foram aplicadas ou verificadas em produção.** A [configuração TTL](https://firebase.google.com/docs/reference/firestore/indexes) requer publicação e readback próprios; a [eliminação TTL](https://firebase.google.com/docs/firestore/ttl) é assíncrona e não constitui uma garantia de eliminação imediata. A autorização e validade são verificadas pelo código mesmo que a limpeza atrase.

A eliminação de memórias ou conta usa remoção recursiva para as partilhas e seus recibos; apagar apenas um documento pai não apaga subcoleções. A retirada preserva as cópias já decifradas/importadas e não promete revogação retroativa. Uma importação ainda em curso é interrompida na próxima validação de lote; lotes já confirmados e a opção de cancelar continuam preservados.

## Regras e interface

O documento bruto de `shares` recusa todas as leituras e mutações SDK. A consulta autenticada do proprietário devolve metadata limitada pelo servidor; a retirada v2 verifica o token da criação física do documento. Orçamentos e recibos ficam privados. Os callbacks antigos `trackShareView`/`trackConversion` recusam mutações; o contador de importações é derivado da confirmação real da importação.

`ShareView` usa a nova leitura, conserva a passphrase local e retira resultados tardios quando muda a rota. IDs privados de memórias importadas ficam ligados à conta, rota, contexto e cofre ativo. Uma abertura repetida durante o mesmo ciclo de rota conserva o comando original.

A criação SDK foi retirada de `ShareModal`, que passa a estar ligada ao painel de memória e ao publicador do servidor. A gestão em `/capsules` permite consultar e retirar cópias sem abrir o cofre. A área continua dependente da validação global, dos gates fechados e do rollout operacional; não se declara o cutover SDK global do produto concluído.

## Validação e limites

As suites gerais, regras reais no emulador demo e smokes locais são registados no estado de lançamento e na prova privada deste incremento. `scripts/public-capsule-browser.cjs` ensaia o transporte cliente real com o wrapper callable real, CORS entre duas origens locais e WebCrypto real; Auth e armazenamento desse ensaio são sintéticos. As transações Firestore são verificadas separadamente no emulador. Nenhum destes ensaios substitui a aceitação em WebView/dispositivo, os testes de rede/proxies, App Check, calibração de custos ou CI remota protegida.

Reprodução local, após build de Functions:

```powershell
node scripts/public-capsule-browser.cjs
```

As restantes fases 0–6 continuam exigidas. O deploy completo continua autorizado apenas depois de satisfazer os critérios globais de lançamento.
