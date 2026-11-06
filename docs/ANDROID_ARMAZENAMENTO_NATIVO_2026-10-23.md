# Android: armazenamento nativo, logs e assinatura — 23 de outubro de 2026

## Decisões de segurança

O terceiro wrapper, `scripts/android/build-playstore-aab.ps1`, ainda usava versões antigas, saltava testes e reescrevia `keystore.properties`. Foi substituído por delegação ao pipeline comum. Raiz, APK e AAB exigem agora os mesmos pré-requisitos e versão explícita para release. O ficheiro privado de signing foi preservado.

O gerador de keystore passava passwords como valores dos argumentos de processo. Agora exige caminho absoluto novo e alias explícito, confirma uma password de 12–1024 caracteres em prompts SecureString e passa o nome de uma variável temporária através de `-storepass:env`/`-keypass:env`. Retira a variável no `finally` e liberta BSTRs/SecureStrings. Não escreve passwords ou configuração Gradle em ficheiros. PKCS12 usa a mesma password confirmada nas duas opções. O [keytool](https://docs.oracle.com/en/java/javase/21/docs/specs/man/keytool.html) suporta esse transporte. A password permanece temporariamente no ambiente dos processos; a proteção do ambiente e do heap depende do sistema local, sem garantia de zeroização do heap.

O Capacitor instalado inclui `methodData` nos logs de plugins quando o logger está ativo. Credenciais legadas podem assim aparecer antes do wrap pelo cofre. `capacitor.config.ts` passou a definir **`loggingBehavior: 'none'`**, conforme o [contrato Capacitor](https://capacitorjs.com/docs/config). O config empacotado e o bridge Android confirmaram essa opção antes de enviar fixtures ao plugin. O piloto recusa logging ativo. iOS e os restantes logs da aplicação/sistema não foram certificados por este ensaio.

## Piloto no Android emulado

Criou-se o AVD separado `MnemosyneSyntheticAPI36`, com imagem de fábrica API 36.1 x86_64, 2 CPU/2 GB e GPU software. Não reutilizou dados do AVD existente. Antes da instalação confirmou-se ausência de contas Google/aplicação anterior, Wi-Fi/dados desligados, modo avião e ausência de rede predefinida. O APK instalado foi ligado ao ficheiro local pelo SHA-256.

WebView, bridge Java, AndroidKeyStore, SharedPreferences, Web Crypto e Web Locks foram reais. O bundle de teste importa os serviços atuais de credenciais/cifra/pairing, substituindo o módulo Firebase por **Auth sintético sem servidor**. O adaptador e guards por omissão foram exercitados com esse Auth; ACK/retirement usam falhas controladas sobre storage real. Não houve login Firebase ou teste de API backend autenticada.

| Verificação | Resultado final |
|---|---|
| Arranque offline e plugin Android | Passou |
| Envelope do cofre e campos examinados ausentes em claro no disco | Passou |
| Paragem do processo e recuperação/validação da chave num PID novo | Passou |
| Cifra copiada para outro UID, sem overwrite | Recusada |
| ACK perdido, recuperação sem nova escrita e arquivo exato | Passou |
| ABA de conta/cofre, cofre fechado e cifra danificada | Recusados |
| Migração legada explícita com arquivo cifrado exato | Passou |
| Limpeza após retirar Auth/cofre, preservando outro UID/prefixo semelhante | Passou |
| Fixtures removidas e preferências vazias no disco | Passou |
| Linhas `methodData` / campo `privateKeyJwk` nos dois PIDs examinados | 0 / 0; logcat bruto não guardado |

Observaram-se dois pedidos HTTP externos tentados e zero respostas externas. A observação adicional de arranque identificou `mnemosyne-one.web.app`; o update prompt tem um feed público `version.json`. Não foram guardados URLs com query, headers ou corpos. Não se declara zero tentativas de rede globais nem um ensaio `never-cloud` de fornecedores IA.

## Backup, APK e testes

`aapt2` confirmou que o manifest compilado referencia os XML esperados e que cloud backup/device transfer excluem **WSSecureStorageSharedPreferences.xml**, usado pelo plugin **8.0.0**. As regras já estavam corretas e foram conservadas. Não houve backup/restauro cloud, transferência entre aparelhos ou atestação de hardware.

O APK final é **Debug 1.0.8/código 1**, com **39.945.927 bytes**, assinatura criptográfica válida, **43 ficheiros web iguais ao dist** e zero instaladores em `assets/public/downloads/`. Certificado de distribuição e Play Console não foram verificados. Downloads públicos conservados.

Passaram **15 testes de comandos**, sem omissões; os três guardas do CLI foram repetidos no fecho. O teste keytool verifica transporte sem password em argv, recusas, limpeza após falha e PKCS12 real exclusivamente temporário/sintético. JDK 21 e os testes estão no job Windows de CI, ainda não executado remotamente. Lint do config é verificado separadamente.

Para a alteração de logging executaram-se cap sync e Gradle Debug com Node 22.23.3/JBR 21. Código web e artefactos dist/Functions/SDK mantiveram os hashes da predecessora; suites gerais frontend/Functions/rules, audits e lint geral não foram repetidos. Os 1.695 testes do build anterior conservam o seu âmbito.

As falhas foram preservadas: helpers de prompts com scope incorreto/módulo SecureString indisponível; primeiro launcher terminado depois do boot por causa não estabelecida, confirmado ausente antes da retoma; Playwright CDP incompatível com gestão de contexto WebView; export default e Buffer introduzidos pela fixture; repetição monolítica acima de 30 segundos de observação. O estado desta última foi inspecionado sem locks pendentes e as fixtures próprias limpas. O ensaio final separa os mesmos casos em fases com estado consultável, mantendo 30 segundos por chamada CDP. A aplicação não foi alterada para corrigir erros da fixture.

## Reprodução, rollout e limites

Num emulador sintético preparado, com rede desligada, APK Debug atual instalado/aberto, storage vazio e SDK em ANDROID_HOME:

```powershell
node scripts/android-runtime-pilot.cjs --serial emulator-5580 --out W:\real\mnemosyne-launch-evidence\native-pilot-NOVO
```

O CLI recusa serial físico, AVD fora do prefixo sintético, contas Google, rede ativa, APK divergente, storage existente, logging ativo e output existente. As operações de teste ficam no dispositivo explícito. O emulador desta passagem foi encerrado com ACK/exit 0; não se apagou o AVD anterior.

Sem alteração Firestore/Rules/índices/bindings. Rollout e rollback devem conservar logging desativado no config fonte/empacotado, wrappers comuns e versões explícitas. Não houve rotação do certificado de produção. Continuam exigidos Auth/backend/App Check reais, hardware/aparelhos físicos, recuperação/QR/deep links, certificado/código de distribuição/Play Console, CI remota e restantes fases 0–6. AndroidKeyStore emulado não comprova proteção de hardware.

**49 gates fechados, sem deploy; releaseReady, allPhasesComplete e wholeCheckoutVerified falsos.** Evidência privada: `W:/real/mnemosyne-launch-evidence/android-runtime-validation-20261023/`, prova `W:/real/mnemosyne-launch-evidence/android-runtime-local-validation-20261023.json`. Predecessora SHA-256 `98999a4c75b00535254853e9e4c59f59940dba6c9eaea982463465edc5193b87`.
