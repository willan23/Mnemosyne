# Dependências e runtime compatível — 1 de outubro de 2026

## Atualização frontend — 9 de outubro de 2026

A repetição de 8 de outubro passou a suite funcional, mas a auditoria de produção terminou com saída 1: sete pacotes afetados, dois críticos, dois altos e três moderados. O relatório original permanece na evidência privada. O resultado anterior de zero vulnerabilidades conserva a data da consulta.

O [advisory do mantenedor do Capacitor](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv) descreve conteúdo remoto servido no origin da aplicação pelo proxy interno. Android/iOS 8.3.3 instalados estavam no intervalo afetado. Atualizaram-se Android/core/CLI e o peer iOS para 8.5.3, dentro da major 8, elevando os mínimos declarados. A correção exige recompilar e redistribuir a aplicação nativa; a atualização da árvore npm não corrige um APK já instalado.

O [advisory de sharp](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w) e a [release de source-map-js](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) fundamentam as correções transitivas de 0.35.4 para 0.35.5 e 1.2.1 para 1.2.2. Não se inferiu exploração no produto a partir da auditoria. Mammoth não tinha chamadores no código/scripts: o extractor Office usa JSZip/XML. Retirar a dependência removeu a cadeia argparse/sprintf-js; a [divulgação no repositório sprintf-js](https://github.com/alexei/sprintf.js/issues/237) não apresentava uma versão publicada corrigida. Não foi feito downgrade para a versão antiga sugerida pela auditoria.

A auditoria de desenvolvimento encontrou ainda a cadeia CLI/xcode/uuid. Aplicou-se override limitado a `xcode -> uuid:11.1.1`, conservando uuid 13 do produto. Passaram verificações sintéticas da API de UUID do xcode, descodificação SVG de um pixel em sharp e versões/ausência de Mammoth, com Node 22. O primeiro helper tinha duas hipóteses inválidas (package.json de sharp não exportado e projeto xcode não inicializado); a fixture foi corrigida, conservando o log inicial.

As auditorias finais de produção e de todas as dependências frontend reportaram zero vulnerabilidades. Com a árvore corrigida passaram 758 testes frontend/128 ficheiros, build web/TypeScript, lint zero erros/23 avisos anteriores e Chromium. Android debug compilou; a inspeção do APK revelou instaladores Windows e um APK anterior na pasta pública downloads. Excluiu-se essa pasta por AAPT, conservando-a no build Hosting. Uma compilação limpa do app passou e confirmou oito assets web idênticos, ausência de downloads e APK de 39.501.956 bytes. Os ensaios iniciais e finais de compilação/empacotamento são conservados. Assinatura, dispositivos, release e distribuição continuam pendentes; a correção não foi publicada.
## Atualização da árvore Functions — 5 de outubro de 2026

Uma nova consulta `npm audit --omit=dev` reportou três pacotes de produção afetados, todos de severidade alta, na árvore instalada: `@fastify/busboy@3.2.0`, `node-forge@1.4.0` e `firebase-admin@13.9.0` pela dependência forge. A contagem refere-se a pacotes/transitivos, não a três explorações confirmadas no produto. A passagem de 1 de outubro abaixo fica como evidência histórica.

Os advisories do mantenedor de busboy descrevem negação de serviço por [boundary multipart excessiva](https://github.com/fastify/busboy/security/advisories/GHSA-xjh9-v7x6-24jw) e [headers com nomes de propriedades do prototype](https://github.com/fastify/busboy/security/advisories/GHSA-x8mw-p69m-v3mx). A correção desses casos começa em 3.2.1. A [release oficial Firebase Admin 13.10.0](https://github.com/firebase/firebase-admin-node/releases/tag/v13.10.0) substitui forge por validação nativa de chave privada com `node:crypto`.

Atualizou-se o mínimo Admin para `^13.10.0` e o lockfile/árvore para Admin **13.10.0** e busboy **3.2.2**, com `--include=optional`. Forge deixou de existir na árvore instalada. Mantêm-se as versões principais e os overrides anteriores; não foi usado `audit fix --force`. `npm ls` confirmou Firestore Admin 7.11.6 e direto 9.2.0 separados, Storage 7.22.0 e ausência de `invalid`. Depois da atualização, a auditoria Functions voltou a **zero vulnerabilidades**, assim como a do frontend.

Foi acrescentado teste da admissão local de credenciais sintéticas PKCS#8/PKCS#1 e recusa de PEM inválido, sem pedir tokens nem ler/guardar/imprimir credenciais reais. A validação final do incremento Obsidian repete build/unitários/rules com a árvore corrigida; resultados finais ficam no [estado completo](ESTADO_LANCAMENTO_COMPLETO.md) e na prova privada. Esses testes não validam IAM, assinatura GCS ou tokens de produção. A revisão inteira/CI/secret scanning e todas as fases continuam obrigatórios antes do deploy.

As secções seguintes conservam a descoberta e os ensaios de 1 de outubro.

## Descoberta e decisão

A auditoria atual, depois do bloco de anexos, detetou quatro ocorrências de severidade alta na árvore frontend e oito moderadas na árvore Functions. São contagens de pacotes afetados/transitivos, não quatro/oito falhas independentes do produto. Não se declara exploração do serviço ou exposição real a partir dessas contagens.

O frontend tinha `@grpc/grpc-js@1.9.16` via Firestore. Os advisories do mantenedor sobre [autorização de certificados](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j) e [mensagens de erro do servidor](https://github.com/grpc/grpc-node/security/advisories/GHSA-f596-whhp-79r4), publicados/revistos recentemente, indicam correção em 1.13.6/1.14.5. O SDK de browser e o transporte Node não têm a mesma superfície; a árvore instalada continuava vulnerável e o gate de audit falhava.

Nas Functions, bibliotecas Google transitivas dependiam de versões `uuid` anteriores à correção. O [advisory do mantenedor](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) descreve limites de buffer em v3/v5/v6 e correção em 11.1.1. Não se encontrou prova de uso desses métodos com buffers de atacante neste produto, mas a dependência precisava de correção.

Aplicaram-se overrides exatos `@grpc/grpc-js:1.14.5` nos dois packages e `uuid:11.1.1` nas Functions, mantendo Firebase/frontend/Admin nas versões existentes. Não foi usado `npm audit fix --force`, que sugeria trocar versões principais do Firebase. A versão uuid 11 mantém entrada CommonJS necessária às bibliotecas atuais; a compatibilidade precisa de build/testes reais do SDK e emulador, além do audit. Overrides podem ser retirados quando a atualização dos parents oferecer a mesma correção sem eles, após nova validação.

## Instalação completa e SDK de Storage

Encontrou-se configuração local `npm omit=optional`. A árvore instalada usava Firestore 9.2.0 como substituto incompatível da dependência opcional Firestore 7 do Admin e omitia Storage. Uma compilação com `skipLibCheck` e SDK omitido não bastava para validar o contrato real do adaptador de Storage.

Instalação com `--include=optional` trouxe Admin/Firestore 7.11.6, Google Storage 7.22.0 e a árvore transitiva correspondente, conservando Firestore 9.2.0 como dependência direta separada. `npm ls` passou a resolver as duas versões nas posições corretas, sem `invalid`. Storage passa também a dependência direta explícita, pois é usado pelo produto. README e jobs de CI/deploy pedem `npm ci --include=optional`; não se alterou configuração npm global do utilizador.

Com os tipos reais presentes, build encontrou metadata aninhada incorretamente em `File.copy`. Corrigiu-se para os campos de objeto no nível de `CopyOptions` e apenas metadata custom em `metadata`. Acrescentou-se teste do adaptador que verifica geração de origem/destino, opções da SDK, headers/cache/digest, retry com destino existente, recusa de tokens Firebase, leitura limitada de prefixo e remoção condicional. Signing/cópia continuam simulados no teste; isto não substitui um piloto GCS real.

## Node 22 e concorrência de testes

O Node normal da máquina é 24.11.1 e o runtime do Codex é 24.19.0; Functions e CI declaram 22. Preparou-se Node **22.23.3** portátil numa pasta temporária de tarefa, usando ZIP e SHA-256 do diretório oficial `nodejs.org/dist/v22.23.3`. Hash verificado antes de extrair. Não se instalou Node global nem se alterou o PATH persistente da máquina. Os comandos de teste usam o PATH temporário do processo para que npm, workers e CLI também usem Node 22.

O primeiro run frontend sem limite de workers teve 409 passes e um timeout de cinco segundos num teste de reindexação. Config Vitest limita agora quatro workers; timeout/assertions continuam iguais. Uma execução durante edição da compressão não era snapshot estável e falhou no teste novo; após estabilizar, **412 testes em 92 ficheiros** passaram no Node 24. Build produziu 3226 módulos, incluindo leitura cifrada. Lint completo: zero erros e 23 avisos. Esse resultado precedeu os overrides; a validação da árvore corrigida em Node 22 é registada abaixo.

## Evidência e gate de lançamento

- Ambos `npm audit --omit=dev --audit-level=high`: **zero vulnerabilidades**, saída zero, depois dos overrides/reinstalação.
- `npm ls @google-cloud/firestore @google-cloud/storage uuid @grpc/grpc-js --all` Functions: sem `invalid`, Storage 7.22.0, Firestore Admin 7.11.6 separado do direto 9.2.0, grpc 1.14.5 e uuid 11.1.1.
- Functions em Node 22: `npm test`, build e **105 testes passaram**, uma suite de regras ignorada fora do emulador; zero falhas. Inclui o novo teste do contrato Storage.
- Frontend em Node 22 com árvore corrigida: **412 testes em 92 ficheiros**, saída zero, 77,89 segundos. Mesmo conjunto/assertions/timeouts; quatro workers.
- Emulador em Node 22/JDK 21, CLI 15.32.0 e credenciais de produção removidas: **39 testes Functions + 22 frontend**, saída zero e emuladores encerrados. Exercita as bibliotecas Firestore/gRPC efetivamente instaladas, além dos mocks unitários.
- Build final frontend em Node 22: TypeScript/Vite passaram, **3226 módulos**, saída zero; permanecem avisos de imports mistos/chunks grandes. Lint completo: **zero erros, 23 avisos**, saída zero.
- Jobs remotos/required checks/secret scan, smoke de plataformas e produção: não confirmados por estes comandos locais.

Nenhum deploy de produção ocorreu. Os gates de anexos/equipas permanecem fechados, e a fase 0/fase 4 não ficam concluídas só por o audit local passar. A aprovação humana existente para deploy completo permanece condicionada à conclusão de todas as áreas.

## Rollback

Preservar lockfiles e overrides corrigidos. Se aparecer incompatibilidade, corrigir a integração ou escolher uma versão corrigida compatível e repetir os gates; não recuperar uma árvore vulnerável nem omitir SDKs para esconder erros. Manter os gates de escrita fechados até validar a árvore e o pipeline completo. O runtime portátil permanece disponível para os próximos ensaios locais de Node 22.
