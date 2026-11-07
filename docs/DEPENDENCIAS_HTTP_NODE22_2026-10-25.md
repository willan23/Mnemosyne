# Dependências HTTP das Functions — 25 de outubro de 2026

Uma nova execução de `npm audit --omit=dev` encontrou dois pacotes de produção com severidade alta nas Functions. A auditoria do frontend continuou com zero vulnerabilidades reportadas. Não se reutilizou o resultado npm anterior como prova atual.

## Correção

| Pacote | Antes | Depois | Utilização |
|---|---|---|---|
| body-parser | 2.3.0 | 2.4.0 | Express usado por firebase-functions |
| undici | 7.29.1 | 7.30.1 | Cheerio e adaptador OpenAI conservado |
| qs | 6.16.0 | 6.16.1 | Resolução transitiva do parser na instalação |

Foram acrescentados overrides exatos para body-parser e undici no package das Functions. A instalação com `--ignore-scripts --no-audit --no-fund` alterou estes três pacotes; a entrada raiz do lockfile passou também a declarar undici como dependência direta. Não houve atualização geral ou `audit fix --force`. A consulta npm após a instalação terminou com **zero vulnerabilidades de produção reportadas**. O package/lockfile do frontend não mudou.

O [aviso oficial body-parser](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828) identifica a correção 2.4.0 para falha de processo por bytes extra depois de um corpo comprimido. Os [mantenedores do undici](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) identificam 7.30.1 para falha por excesso de Content-Encoding e fecho prematuro. A versão também retira os outros dois avisos undici presentes no audit: parser EventSource sem limite e comparação de algoritmo SRI.

## Evidência e limites

Os três novos testes executam processos Node independentes, com servidores exclusivamente em loopback e dados sintéticos. Não instalam handlers de uncaughtException que possam ocultar uma falha. Um processo testa corpos gzip/deflate/Brotli com bytes posteriores enviados separadamente e confirma um novo pedido válido. Os outros dois testam seis codificações e fecho prematuro, exigem recusa e confirmam um novo pedido válido: um pela biblioteca undici e outro pelo transporte limitado efetivamente usado pelos fornecedores.

Com undici 7.29.1, o processo isolado terminou com erro não tratado; com 7.30.1, sobreviveu e respondeu ao pedido seguinte. O teste de body-parser sobreviveu também com 2.3.0: esse ensaio não reproduziu a falha do aviso e não é apresentado como prova de exploração anterior. A versão vulnerável foi corrigida com base no intervalo/patch dos mantenedores.

O Node local 22.23.3 inclui undici 6.28.1 no fetch embutido. O mesmo controlo isolado também terminou com erro não tratado por esse caminho. Por isso `providerTransport.ts` passou a importar explicitamente fetch da dependência corrigida 7.30.1. A origem dos pedidos fica no objeto interno providerHttp, usado pelos testes para interceção; não há substituição global do fetch ou fallback para o embutido. As mesmas restrições de redirect, deadline, bytes e projeção de erros continuam aplicadas. O teste de processo confirma a identidade da implementação e executa o transporte real contra HTTP malformado.

Passaram os **26 testes focados** de transporte/adaptadores, incluindo os três de sobrevivência de processo. Depois desta alteração, a suite geral Functions passou **580 testes**, com uma omissão prevista de Rules fora do emulador, e o audit de produção continuou sem vulnerabilidades reportadas. A passagem integral de emuladores é vinculada separadamente à fonte final.

O runner integral posterior ao transporte corrigido passou **316 Functions/Rules e 23 frontend**, sem falhas/omissões, recompilando Functions antes das suites e encerrando os emuladores normalmente. A prova privada do incremento OpenRouter vincula fontes, versões, logs anteriores/finais e artefactos. A primeira passagem de Rules tinha uma fixture que pressupunha NVIDIA ativa; a falha e a correção explícita de configuração ficam conservadas, sem alterar Rules/gates para obter o resultado.

As suites frontend/build/lint antecedem a alteração exclusiva do transporte, dependências e fixtures do backend; os fontes consumidos pelo frontend e os seus packages permanecem iguais. O build/suite geral Functions e a suite integral de emuladores são repetidos depois da instalação, com os resultados vinculados na prova do incremento OpenRouter. Os emuladores usam apenas demo-mnemosyne-rules; nenhum dos ensaios HTTP malformado contacta Firebase ou um fornecedor.

Não há mudança de schema, Rules, índices, gates ou dados. Não houve deploy; as versões instaladas em produção não foram alteradas. A correção cobre a árvore npm reportada e o transporte explícito dos fornecedores. Não atualiza o executável Node local nem comprova a versão interna do runtime gerido em produção ou de todos os SDKs; a consulta de metadata indica apenas nodejs22. Rollback exige conservar versões corrigidas e o transporte explícito. A execução remota do CI e as restantes fases continuam exigidas.
