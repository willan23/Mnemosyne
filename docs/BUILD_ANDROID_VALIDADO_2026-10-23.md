# Build Android: comandos, versões e falhas — 23 de outubro de 2026

Continuação do mesmo dia: [armazenamento nativo, logs e assinatura](ANDROID_ARMAZENAMENTO_NATIVO_2026-10-23.md). O terceiro wrapper AAB foi integrado no pipeline; novos keystores usam referências de ambiente temporárias para passwords, e o logger Capacitor foi desativado. O APK subsequente passou o piloto de storage em Android emulado, com Auth sintético. Os resultados do primeiro build abaixo conservam o seu âmbito histórico.

## Problema e decisão

O `build-android.ps1` anterior dependia do diretório de arranque, não verificava os códigos de saída de npm/Capacitor/Gradle e permitia omitir o build web. O segundo percurso tinha versões antigas por omissão, modificava `keystore.properties` para gravar versões e removia diretórios de downloads e o APK anterior. A revisão substitui ambos por um pipeline comum, com raiz derivada do script público e recusa de falhas em cada etapa.

Ambos os wrappers são comandos PowerShell avançados: parâmetros desconhecidos são recusados, incluindo `-SkipWebBuild`, `-SkipTests` e a tentativa de injetar um executor. O executor sintético existe somente no módulo interno de testes. Os wrappers públicos usam sempre o executor real.

São obrigatórios Node 22, JDK 21+, suite frontend, build web, `cap sync android` da CLI instalada e Gradle Wrapper. A suite corre com um worker, sem retirar testes ou aumentar timeouts. A sequência restaura cwd, PATH e JAVA_HOME após sucesso ou falha. Cada execução exige diretório novo de relatório e não sobrescreve evidência anterior. Não altera o projeto cloud configurado nem publica ficheiros.

Release APK/Bundle exige `VersionCode` explícito, entre 1 e 2.100.000.000, e `VersionName` com o valor atual de `frontend/package.json`. Os valores são passados a Gradle por propriedades do projeto; não são escritos no ficheiro privado de assinatura. O operador tem de obter o próximo código válido na Play Console; o script não presume que um código é maior do que todos os já enviados.

O grafo Gradle que produz APK/Bundle release recusa configuração de assinatura incompleta, propriedades de versão ausentes ou nome diferente do package web. Um build Debug continua disponível sem credenciais de distribuição, com código local 1 e nome do package atual. A assinatura de Debug não valida a identidade de distribuição. O mecanismo segue os contratos de [assinatura Android](https://developer.android.com/studio/publish/app-signing), [build por linha de comando](https://developer.android.com/build/building-cmdline) e [grafo de tarefas Gradle](https://docs.gradle.org/current/javadoc/org/gradle/api/execution/TaskExecutionGraph.html).

## Comandos atuais

Usar Node 22 no PATH e JDK 21+ em JAVA_HOME. O script encontra o JBR do Android Studio se JAVA_HOME não estiver definido. Um JAVA_HOME existente com versão inadequada é recusado no preflight.

```powershell
# Pode ser invocado a partir de outro diretório:
& W:\real\Mnemosyne\build-android.ps1 -Target Debug

# Definir nextVersionCode a partir do estado real da Play Console.
# versionName deve coincidir com o package atual; não copiar códigos históricos.
& W:\real\Mnemosyne\build-android.ps1 -Target ReleaseBundle -VersionCode $nextVersionCode -VersionName $versionName
& W:\real\Mnemosyne\scripts\android\build-android-apk.ps1 -VersionCode $nextVersionCode -VersionName $versionName
```

`-ReportDirectory` aceita um caminho absoluto novo. O JSON conserva etapas concluídas e a primeira falha. `nativeBuildCompleted` significa somente conclusão dos comandos: `signingVerified`, `devicePilotVerified` e `published` continuam falsos no relatório. O pipeline não envia ficheiros à Play Store nem atualiza os downloads públicos.

## Validação

Os 11 testes locais dos pontos de entrada Android e runtime passaram em Node 22/Windows, sem omissões. O teste PowerShell simula os três targets, injeta falha em cada uma das seis etapas, confirma ausência de passos posteriores e preserva contexto, evidência existente e ficheiro de assinatura. Os testes públicos reais recusam versões em falta/antigas e parâmetros retirados antes de arrancar as etapas. Um processo nativo de teste que termina com 47 no primeiro preflight confirma que o executor real propaga esse código, não corre passos posteriores e conserva a recusa no relatório. O job Windows de CI inclui estes testes; a execução remota continua pendente.

A primeira passagem teve dois erros: um helper de teste dependia de `Get-FileHash`, indisponível naquele processo, e os wrappers não avançados aceitavam flags desconhecidos. Foram corrigidos com hash de stream apenas em memória e `[CmdletBinding()]`, conservando asserts e timeouts. Um preflight Node iniciou antes da correção e recusou Node 24; nenhum build foi alcançado nessa tentativa. O diagnóstico privado distingue esta falha da passagem final verde.

O entrypoint real foi invocado a partir de `W:/real`, fora da raiz do repositório, com Node 22.23.3 e JBR 21. Passaram **1.695 testes frontend em 203 ficheiros**, sem omissões, build web, sincronização Capacitor e `assembleDebug`. Os avisos de `scrollTo` do ambiente jsdom e os avisos de bundle foram conservados. Não se retiraram testes nem alteraram timeouts. O percurso completo terminou com exit 0; a primeira execução real do pipeline terminou verde.

O APK tem **39.945.654 bytes**, package `com.mnemosyne.mobile`, nome **1.0.8** e código **1**, exclusivamente para Debug. A inspeção comparou **43 ficheiros web** com o dist, incluindo os **28 assets compilados obrigatórios**, e encontrou zero ficheiros em `assets/public/downloads/`. `aapt2` e o manifest de outputs confirmaram package/versões. O `apksigner` verificou a assinatura criptográfica Debug; não foi comparado um certificado de distribuição. Não houve instalação em dispositivo ou envio à Play Store.

Uma chamada Gradle real `--offline assembleRelease --dry-run`, sem propriedades explícitas de versão, terminou com a recusa esperada antes da execução das tarefas. A configuração local de signing estava disponível nessa passagem; a recusa específica por ausência de signing foi inspecionada no código, mas não ensaiada removendo credenciais privadas. Não se gerou release APK/Bundle neste incremento.

## Rollout e limites

A configuração de signing continua privada. Não foram criadas/copíadas credenciais ou alterados passwords/aliases. A configuração atual pode assinar um candidato local; é obrigatório comparar o certificado com o esperado e o código com a Play Console antes de distribuir. APK/Bundle antigos, assinaturas e downloads públicos não são escolhidos automaticamente para publicação.

Os pilotos de Auth, cofre, storage seguro, cloud policy, recuperação, emparelhamento e atualização em Android real permanecem exigidos. Um build e inspeção de ZIP não comprovam esses comportamentos. As suites backend/rules não são repetidas para estas alterações de empacotamento, e não se declara conclusão das fases 0–6. Os 49 gates permanecem fechados.

Evidência privada: `W:/real/mnemosyne-launch-evidence/android-build-validation-20261023/` e prova encadeada `W:/real/mnemosyne-launch-evidence/android-build-local-validation-20261023.json`. A predecessora é `runtime-entrypoints-local-validation-20261023.json`, SHA-256 `637d49f780f39763eb94f22532e22cefc83ead54e5d627ea3def494871ad5bda`. `allPhasesComplete`, `releaseReady` e `wholeCheckoutVerified` continuam falsos. O [estado do lançamento](ESTADO_LANCAMENTO_COMPLETO.md) mantém o objetivo de concluir todas as áreas antes do deploy completo autorizado.
