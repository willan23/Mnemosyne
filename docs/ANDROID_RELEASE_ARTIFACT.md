O deploy exige que o APK de Android em public/downloads e dist/downloads corresponda ao ficheiro aprovado em scripts/android/release-download.json. O contrato fixa o pacote, a versão, o código de versão, o tamanho, o SHA-256 do APK e a identidade das fontes usadas na aplicação. A assinatura dos bytes aprovados é verificada na preparação do candidato.

O cálculo das fontes inclui React/TypeScript, dependências bloqueadas, recursos públicos e configuração nativa Android. Normaliza os finais de linha dos ficheiros de texto para permitir a comparação entre checkouts. Exclui os downloads, os feeds desktop e o manifesto de versão gerado pelo build. Uma alteração às fontes com a mesma versão também exige preparar e validar um candidato novo antes de atualizar o contrato.

Para verificar os ficheiros locais depois do build, executar a partir da raiz.

~~~powershell
node scripts/android-release-artifact.cjs --verify-only
~~~

Para preparar o APK aprovado a partir de um caminho absoluto, executar o modo de staging. Um ficheiro de destino existente com bytes diferentes provoca uma recusa. A criação do ficheiro é atómica e uma escrita concorrente é conservada.

~~~powershell
node scripts/android-release-artifact.cjs --stage W:/candidatos/mnemosyne-android.apk
~~~

O workflow de publicação recebe android_release_asset_id. Este valor identifica um ficheiro de uma release do próprio repositório GitHub, acessível ao token do workflow. A etapa Retrieve approved Android APK usa gh api e obtém os bytes pelo ID. O script valida o APK antes de o colocar em public/downloads. A API de assets suporta download autenticado com a permissão contents de leitura. [API de assets de releases](https://docs.github.com/en/rest/releases/assets)

Antes da execução remota, disponibilizar o APK validado como asset de release com visibilidade para o token e fornecer o respetivo ID. Esta preparação no GitHub e a execução remota ainda não foram realizadas nesta etapa. A listagem de releases em rascunho exige acesso de escrita ao repositório e a sua visibilidade precisa de ser validada antes de a usar no processo. O AAB assinado continua a depender da validação no Google Play. [Visibilidade das releases](https://docs.github.com/en/rest/releases/releases#list-releases)

A mesma verificação é obrigatória no deploy local depois do build e antes da primeira publicação Firebase. As condições gerais de lançamento continuam a ser verificadas. Os testes da sequência usam comandos injetados e recusam a continuação após qualquer falha. A validação local com as condições fechadas termina antes de publicar.

O contrato atual aprova o APK 1.0.9, código 9, cujo certificado e atualização sobre o APK 1.0.4 foram verificados no ensaio local de 5 de novembro de 2026. O hash é 932bc2bae6bdb6935b4a7cb6fdbd1796e6792e8e33405533ff680a1e20ccf40b. Uma alteração futura ao candidato exige repetir a assinatura e os testes pertinentes, atualizar os bytes aprovados e recalcular a identidade das fontes com o comando seguinte.

~~~powershell
node scripts/android-release-artifact.cjs --source-sha256
~~~
