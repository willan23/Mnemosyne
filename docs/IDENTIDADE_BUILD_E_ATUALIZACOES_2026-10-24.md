# Identidade do build e deteção de atualizações

## Problema e decisão

O identificador anterior era calculado a partir da versão do package e de GIT_COMMIT_SHA, com o valor fixo `rel` quando a variável não existia. Os comandos e workflows atuais não a injetavam. Dois builds com código diferente e a mesma versão recebiam assim o mesmo identificador; a aplicação podia ignorar a nova publicação. Um teste de regressão reproduziu a falha antes da correção, com o log conservado.

Cada build de produção passa a gerar um UUID aleatório. Não depende de uma variável Git, do relógio ou de um checkout sem alterações. Este identificador distingue invocações; **não é um hash do conteúdo, uma assinatura ou uma atestação da revisão**. Dois builds idênticos também recebem IDs diferentes. Quem configurar VITE_APP_BUILD_ID assume a responsabilidade de usar um valor distinto quando muda o código. O identificador explícito é preservado, após validação de formato; `dev` é recusado para builds.

O plugin cria um único payload ao resolver o build e usa os mesmos valores nas constantes JavaScript e nos dois manifestos. O escritor atómico anterior mantém-se, incluindo propagação de falhas. Desenvolvimento, testes e preview não escrevem public/version.json ou dist/version.json. O alias `npm run version:write` executa agora o build completo, com TypeScript, em vez de reescrever só os manifestos por um tsx não instalado. A execução direta do módulo escritor recusa a operação e indica o comando completo.

A versão canónica vem de frontend/package.json, tem de ser SemVer válido e tem de coincidir com a configuração Tauri, quando presente. VITE_APP_VERSION não pode publicar outra versão. O payload copia apenas as quatro variáveis públicas de versão; não copia o ambiente inteiro. Os cinco campos públicos anteriores permanecem: version, buildId, builtAt, channel e notes.

A comparação cliente passa a respeitar a ordem de pré-lançamentos, identificadores numéricos sem perda de precisão e a precedência igual de build metadata. Um prefixo `v` antigo continua aceite pelo comparador. Uma versão remota inferior ou malformada não provoca um aviso novo por ter outro ID. Na mesma precedência, IDs distintos continuam a identificar uma atualização. O cliente conserva a data do build nos seus metadados.

## Verificação e publicação

`node scripts/check-build-version-identity.cjs` exige os manifestos byte a byte iguais, versão igual ao package, ID de produção, timestamp ISO e os três valores embutidos no módulo JavaScript realmente referenciado por dist/index.html. Um asset antigo sem referência não satisfaz a verificação. Campos públicos adicionais, caminhos de módulo externos/traversal e symlinks nos caminhos examinados são recusados. A verificação prova coerência desses valores, não a integridade criptográfica do conteúdo inteiro.

O CI exige os testes do verificador e executa o verificador **depois dos unitários**, mantendo o build antes desses testes. O pipeline PowerShell acrescenta a mesma verificação depois dos testes frontend e antes de qualquer comando de publicação. Passa a ter 19 etapas de preflight e cinco de publicação. Uma falha nesta etapa impede iniciar as seguintes; os gates de entrada continuam a ser verificados primeiro.

## Validação local em Node 22.23.3 / Windows

- **40 testes frontend em quatro ficheiros**, sem falhas ou omissões; TypeScript e lint dos dez ficheiros TypeScript passaram, com zero erros/avisos no âmbito.
- **14 testes Node**, sem omissões: nove casos de coerência do bundle/manifesto e cinco casos do escritor atómico anterior. Recusadas divergências entre manifestos, reescrita de ambos com bundle antigo, timestamp não embutido, asset obsoleto sem referência, ID dev, versão incoerente, campo extra, data inválida e destinos de módulo inválidos.
- **Oito testes de gates/publicação**, sem omissões. A sequência PowerShell com executor simulado confirma agora os 24 pontos de falha e a posição do verificador depois dos testes e antes de toda a publicação. Não executa Firebase ou APIs de produção.
- Build real por `npm run version:write` concluído, incluindo o build completo; verificador passou contra esse dist. Não foram instaladas dependências nem alterado o lockfile. O aviso anterior de chunks grandes foi conservado.
- Servidor Vite real em loopback serviu o módulo de versão e foi encerrado sem alterar os manifestos. Preview real serviu exatamente o manifesto deste dist, foi encerrado e conservou ambos os hashes.
- Repetidos os mesmos **40 testes frontend depois do build**, para reproduzir a ordem do CI: ambos os manifestos conservaram os hashes e o verificador voltou a passar. Não se repetiu a suite geral.
- A recusa direta do escritor foi exercida num bundle Node do módulo real, sem instalar tsx, com a mensagem esperada e zero alteração dos manifestos. Não se tratou uma falha de importação como prova do guard.

As primeiras passagens dos testes novos foram conservadas: JSDOM não suporta importar o runtime Node de esbuild, e a transformação de `new URL(..., import.meta.url)` produziu uma URL HTTP num módulo de configuração testado. O unitário isola apenas loadEnv; a resolução de diretório usa agora as operações Node de path. A asserção que exigia defines de produção dentro de Vitest foi substituída pela verificação do build real. Não se alargaram timeouts, não se retiraram casos e não se ignoraram falhas.

## Limites e continuidade

Não houve alteração de schema, Rules, índices, modelo de IA, secrets, preços ou dependências. O package mudou apenas no script version:write. Backend, SDK, downloads e APK anteriores são conservados; o APK não foi recompilado com este novo bundle web. A comparação Tauri existente e a assinatura dos instaladores/updater continuam percursos próprios e exigem os respetivos pilotos.

Não foram repetidas Rules, suites gerais, audits, inferência real ou CI remota. Não houve deploy, pedidos generativos, leitura de payloads de secrets ou mutações de produção. Para rollback, conservar o bundle e o manifesto da mesma publicação; não regenerar apenas version.json nem reutilizar um ID explícito para conteúdo diferente.

Evidência privada em `W:/real/mnemosyne-launch-evidence/build-identity-validation-20261024/`, prova `build-identity-local-validation-20261024.json`, encadeada à prova generation-http-local-validation-20261024.json. **49 gates continuam fechados; todas as áreas das fases 0–6 continuam exigidas antes do deploy completo autorizado.**
