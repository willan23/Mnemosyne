# Mnemosyne Play Store Release Guide

Data: 2026-05-12

## Estado atual

- App Android Capacitor configurada em `frontend/android`.
- Package name: `com.mnemosyne.mobile`.
- Nome publico: `Mnemosyne`.
- `targetSdkVersion`: 36, acima do requisito atual da Google Play para novos apps.
- App Bundle gerado em modo release:
  `frontend/android/app/build/outputs/bundle/release/app-release.aab`
- APK release gerado quando necessario:
  `frontend/android/app/build/outputs/apk/release/app-release.apk`
- O bundle gerado nesta maquina esta assinado quando `frontend/android/keystore.properties` e `frontend/android/keystores/mnemosyne-release.keystore` existem.
- O executavel desktop foi excluido do bundle Android antes do `cap sync`.

## Requisitos oficiais verificados

- Google Play exige Android App Bundle para apps novas desde agosto de 2021.
  Fonte: https://developer.android.com/guide/app-bundle
- Para submeter app nova na Play Store, a app deve cumprir o requisito atual de target API. A documentacao oficial aponta Android 15/API 35 ou superior para novas apps a partir de 2025-08-31; o Mnemosyne esta em API 36.
  Fonte: https://developer.android.com/google/play/requirements/target-sdk
  Fonte: https://support.google.com/googleplay/android-developer/answer/11926878

## Gerar keystore de release

Executar a partir de `W:\real\SaaS`:

```powershell
.\scripts\android\generate-release-keystore.ps1
```

O script cria:

- `frontend/android/keystores/mnemosyne-release.keystore`
- `frontend/android/keystore.properties`

Se `keytool` nao estiver no `PATH`, o script tenta usar automaticamente o JDK incluido no Android Studio em `C:\Program Files\Android\Android Studio\jbr`.

Ambos ficam ignorados pelo Git. Fazer backup offline destes ficheiros. Se a keystore se perder, futuras atualizacoes da app podem ficar bloqueadas.

O `keystore.properties` usa `storeFile=../keystores/mnemosyne-release.keystore`, relativo a `frontend/android/app`.

## Gerar AAB para upload

```powershell
.\scripts\android\build-playstore-aab.ps1 -VersionCode 1 -VersionName 1.0.0
```

Para iterar mais rapido sem testes:

```powershell
.\scripts\android\build-playstore-aab.ps1 -VersionCode 1 -VersionName 1.0.0 -SkipTests
```

Resultado:

```text
frontend/android/app/build/outputs/bundle/release/app-release.aab
```

Antes de sincronizar Capacitor, o script remove o download desktop de `dist/downloads`, para nao empacotar um `.exe` dentro da app Android.

## Gerar APK assinado

Se o fluxo onde estas a publicar/testar pedir APK em vez de AAB:

```powershell
.\scripts\android\build-android-apk.ps1 -VersionCode 1 -VersionName 1.0.0
```

Para iterar mais rapido sem testes:

```powershell
.\scripts\android\build-android-apk.ps1 -VersionCode 1 -VersionName 1.0.0 -SkipTests
```

Resultado:

```text
frontend/android/app/build/outputs/apk/release/app-release.apk
```

Nota: para publicacao nova na Google Play, a documentacao oficial continua a indicar Android App Bundle. APK e util para instalacao manual, testes, outros canais, ou fluxos especificos que ainda peçam `.apk`.

## Verificacao de propriedade Android

Se a consola pedir "Assine e carregue um APK" para provar propriedade do pacote:

1. Copiar o fragmento exibido pela Google.
2. Colar em `frontend/android/app/src/main/assets/adi-registration.properties`.
3. Garantir que o APK e assinado com a chave privada correspondente a fingerprint mostrada na consola.
4. Gerar APK:

```powershell
.\scripts\android\build-android-apk.ps1 -VersionCode 1 -VersionName 1.0.0 -SkipTests
```

Nesta sessao foi criado:

```text
frontend/android/app/src/main/assets/adi-registration.properties
```

Fragmento usado:

```text
D3MAXQVMYAWGWAAAAAAAAAAAAAA
```

Importante: se a consola disser "O APK carregado tem uma assinatura diferente", o problema nao e o APK em si. A fingerprint esperada na consola precisa bater com a fingerprint da keystore usada para assinar o APK.

Fingerprint SHA-256 da keystore atual:

```text
CC:CD:1D:63:D4:76:C6:71:C3:63:57:5D:EB:52:C5:CE:C6:9B:29:88:32:4B:5E:30:0A:34:1B:41:CF:8D:39:16
```

Certificados publicos exportados da keystore atual:

```text
frontend/android/certificates/mnemosyne-upload-certificate.pem
frontend/android/certificates/mnemosyne-upload-certificate.der
```

Se a consola mostrar outra fingerprint esperada, por exemplo `AB:83:...`, existem duas opcoes:

- voltar ao passo anterior da consola e fornecer um destes certificados publicos;
- ou assinar o APK com a keystore antiga que corresponde exatamente a essa fingerprint.

## Bloqueio anterior do package `com.mnemosyne.app`

A consola indicou que `com.mnemosyne.app` ja esta associado a certificados elegiveis existentes.

Fingerprints mostradas pela consola:

```text
AB:83:26:89:CE:27:7E:56:44:4B:61:F7:D2:2E:CD:B4:62:8C:47:70:4C:C9:09:23:5D:93:13:EF:DD:6D:EA:AA
EC:32:FA:E2:6C:1C:23:89:29:EF:DD:F5:A6:0B:D2:5B:8F:F1:BE:6F:20:7C:EA:34:BC:2C:10:A5:F5:...
```

O APK local atual esta assinado com:

```text
CC:CD:1D:63:D4:76:C6:71:C3:63:57:5D:EB:52:C5:CE:C6:9B:29:88:32:4B:5E:30:0A:34:1B:41:CF:8D:39:16
```

Tambem foi verificada a debug key local do Android:

```text
9B:B9:99:EE:B7:4E:2F:80:7A:CD:D9:39:17:6A:7C:2A:45:5A:D3:71:07:7D:3B:84:72:E2:EA:C8:41:59:0C:0C
```

Conclusao: a keystore atual e a debug key local nao batem com as fingerprints elegiveis da consola.

Nao e possivel gerar uma chave privada nova que produza a fingerprint `AB:83...` ou `EC:32...`. Para provar propriedade de `com.mnemosyne.app`, e necessario ter a keystore privada original correspondente a uma dessas fingerprints. Como essa keystore nao esta disponivel, o package name foi alterado para `com.mnemosyne.mobile`.

## Chave para `com.mnemosyne.mobile`

Para registar `com.mnemosyne.mobile`, colar esta fingerprint SHA-256 na consola:

```text
CC:CD:1D:63:D4:76:C6:71:C3:63:57:5D:EB:52:C5:CE:C6:9B:29:88:32:4B:5E:30:0A:34:1B:41:CF:8D:39:16
```

## Politica de privacidade

URL publica para a Play Console depois do deploy no Firebase Hosting:

```text
https://mnemosyne-one.web.app/privacy.html
```

Rota da app:

```text
https://mnemosyne-one.web.app/privacy
```

A versao estatica `privacy.html` foi criada para que a Play Console consiga ler a politica mesmo sem depender da renderizacao da SPA.

## URL de eliminacao de conta

URL para o campo "URL de eliminacao de conta" da Play Console:

```text
https://mnemosyne-one.web.app/account-deletion.html
```

Esta pagina permite iniciar o pedido por email e declara:

- app: `Mnemosyne`;
- package Android: `com.mnemosyne.mobile`;
- dados eliminados: conta, memorias, notas, etiquetas, metadados de sincronizacao, chaves publicas de Comms e dados de perfil;
- dados que podem ser retidos: apenas informacao limitada por seguranca, abuso, cumprimento legal, registos financeiros ou disputas.

## Validacao local desta sessao

Comando executado antes da keystore:

```powershell
.\scripts\android\build-playstore-aab.ps1 -VersionCode 1 -VersionName 1.0.0 -SkipTests
```

Resultado:

- `npm run build` passou.
- `npx cap sync android` passou.
- `gradlew bundleRelease` passou.
- `app-release.aab` foi criado unsigned, como esperado antes da keystore local.

Comando executado depois da keystore:

```powershell
.\scripts\android\build-playstore-aab.ps1 -VersionCode 1 -VersionName 1.0.0
```

Resultado:

- `npm run test -- --run` passou: 56 testes.
- `npm run build` passou.
- `npx cap sync android` passou.
- `gradlew bundleRelease` passou.
- `jarsigner -verify` confirmou `jar verified`.
- O aviso de certificado autoassinado e esperado para uma upload key local; a Play Console passa a gerir a assinatura final quando Play App Signing estiver ativo.

Comando APK executado depois da keystore:

```powershell
.\scripts\android\build-android-apk.ps1 -VersionCode 1 -VersionName 1.0.0 -SkipTests
```

Resultado:

- `npm run build` passou.
- `npx cap sync android` passou.
- `gradlew assembleRelease` passou.
- `app-release.apk` foi criado assinado.
- `apksigner verify --verbose` confirmou `Verified using v2 scheme: true`.

Depois da troca de package para `com.mnemosyne.mobile`:

- `frontend/capacitor.config.ts` usa `appId: com.mnemosyne.mobile`.
- `frontend/android/app/build.gradle` usa `namespace` e `applicationId` como `com.mnemosyne.mobile`.
- `aapt dump badging` confirmou `package: name='com.mnemosyne.mobile' versionCode='1' versionName='1.0.0'`.
- APK novo: `frontend/android/app/build/outputs/apk/release/app-release.apk`.
- AAB novo: `frontend/android/app/build/outputs/bundle/release/app-release.aab`.
- A fingerprint SHA-256 para colar na Play Console continua:

```text
CC:CD:1D:63:D4:76:C6:71:C3:63:57:5D:EB:52:C5:CE:C6:9B:29:88:32:4B:5E:30:0A:34:1B:41:CF:8D:39:16
```

Validacao final em 2026-05-13:

- AAB release assinado: `frontend/android/app/build/outputs/bundle/release/app-release.aab`
- APK release assinado: `frontend/android/app/build/outputs/apk/release/app-release.apk`
- `aapt dump badging` confirmou `com.mnemosyne.mobile`, `versionCode='1'`, `versionName='1.0.0'`, min SDK `24` e target SDK `36`.
- `apksigner verify --verbose --print-certs` confirmou assinatura APK valida por v2 e signer RSA 4096.
- SHA-256 do ficheiro AAB: `816FAB70B2557A1A647D56F16FCB9C3263461D6E70FB0880462FAA37DDAD6C9A`
- SHA-256 do ficheiro APK: `C808A40C7718BBFF707C3A821AA9DF14F9DF820FB99B14A26557BCA6ED414A49`

## Checklist Play Console

1. Criar app no Play Console com package `com.mnemosyne.mobile`.
2. Ativar Play App Signing.
3. Subir `app-release.aab` em Internal testing primeiro.
4. Preencher App content:
   - Privacy Policy URL: `https://mnemosyne-one.web.app/privacy.html`.
   - Data safety.
   - App access instructions se o reviewer precisar criar conta.
   - Target audience.
   - Ads: marcar sem anuncios se continuar sem ads.
5. Adicionar screenshots:
   - Usar primeiro os ficheiros Play-ready de `docs/playstore/screenshots/*-phone.png`.
   - Login / primeira entrada.
   - Criacao de conta.
   - Zero-Knowledge.
   - Politica de privacidade.
   - Eliminacao de conta.
6. Adicionar assets obrigatorios:
   - Icone: `docs/playstore/icon-512.png`.
   - Feature graphic: `docs/playstore/feature-graphic-1024x500.png`.
7. Testar instalacao por Internal testing num Android real.
8. Corrigir eventuais avisos de policy antes de passar para Production.

## Assets Play Store atualizados em 2026-05-13

Os assets abaixo foram gerados/validados para upload:

```text
docs/playstore/icon-512.png
docs/playstore/feature-graphic-1024x500.png
docs/playstore/screenshots/01-login-hero-phone.png
docs/playstore/screenshots/02-create-account-phone.png
docs/playstore/screenshots/03-zero-knowledge-phone.png
docs/playstore/screenshots/04-privacy-phone.png
docs/playstore/screenshots/05-account-deletion-phone.png
```

Validacao tecnica:

- Icone: 512x512, PNG 32-bit com alpha, abaixo de 1024 KB.
- Feature graphic: 1024x500, PNG 24-bit sem alpha.
- Screenshots: 1080x1920, PNG 24-bit sem alpha, proporcao 1.778 e abaixo de 8 MB cada.
- As capturas antigas `*-mobile.png` de 390x844 ficam apenas como arquivo interno e nao devem ser usadas na Play Console.

## Data Safety inicial

Declaracao tecnica recomendada para preencher no Play Console, a confirmar antes da submissao final:

- Dados recolhidos: email/autenticacao, conteudo criado pelo utilizador, identificadores de conta, chaves publicas E2E, diagnostico tecnico minimo.
- Dados sensiveis: memorias do utilizador sao conteudo criado pelo utilizador e devem ser tratadas como privadas.
- Seguranca: trafego via HTTPS/Firebase; chaves privadas e mnemónica nao devem sair do dispositivo; API keys ficam cifradas localmente.
- Partilha: public profiles e transmissoes cifradas existem para Comms; o conteudo de mensagem fica E2E.
- Camera: usada para ler QR code de pareamento mobile.

## Pontos antes de publicar

- Trocar o QR Play Store de pesquisa por URL final da ficha Play Store quando a app existir.
- Rever permissao CAMERA e explicar no onboarding de pareamento.
- Criar Privacy Policy publica com URL estavel.
- Fazer screenshots reais depois do visual final.
- Assinar o AAB com keystore de release antes de upload.
