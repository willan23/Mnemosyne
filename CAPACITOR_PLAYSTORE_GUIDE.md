# 📱 Guia Capacitor + Play Store - Mnemosyne

## Pré-requisitos

- Node.js instalado
- Android Studio instalado
- Java JDK 17+ instalado
- Conta Google Play Developer ($25 USD)

## Passo 1: Instalar Capacitor

```bash
# Na raiz do projeto
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/assets --save-dev
```

## Passo 2: Configurar Capacitor

### Criar capacitor.config.ts

Crie o arquivo `capacitor.config.ts` na raiz do projeto:

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mnemosyne.app',
  appName: 'Mnemosyne',
  webDir: 'frontend/dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    }
  }
};

export default config;
```

## Passo 3: Preparar Ícones

### Criar pasta de recursos

```bash
mkdir resources
```

### Criar ícone principal

1. Crie um ícone 1024x1024px chamado `icon.png` em `resources/`
2. Crie um splash screen 2732x2732px chamado `splash.png` em `resources/`

> **Dica**: Use ferramentas como Figma, Canva ou Adobe Express para criar os ícones

### Gerar ícones automaticamente

```bash
npx capacitor-assets generate
```

Isso vai gerar automaticamente todos os tamanhos necessários para Android.

## Passo 4: Build do Frontend

```bash
cd frontend
npm run build
```

Verifique se a pasta `frontend/dist` foi criada com sucesso.

## Passo 5: Inicializar Capacitor

```bash
# Na raiz do projeto
npx cap init
```

Quando perguntado:
- **App name**: Mnemosyne
- **App ID**: com.mnemosyne.app
- **Web asset directory**: frontend/dist

## Passo 6: Adicionar Plataforma Android

```bash
npx cap add android
```

Isso vai criar a pasta `android/` com o projeto Android.

## Passo 7: Configurar AndroidManifest.xml

Edite `android/app/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:usesCleartextTraffic="true">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>
    </application>

    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

</manifest>
```

## Passo 8: Sincronizar e Abrir Android Studio

```bash
npx cap sync android
npx cap open android
```

Isso vai abrir o Android Studio com o projeto.

## Passo 9: Configurar Assinatura do App

### Gerar Keystore

```bash
# Windows (PowerShell)
keytool -genkey -v -keystore mnemosyne-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias mnemosyne

# Responda as perguntas:
# - Password: [escolha uma senha forte]
# - Nome e sobrenome: Seu nome
# - Unidade organizacional: Mnemosyne
# - Organização: Seu nome/empresa
# - Cidade, Estado, País: Suas informações
```

⚠️ **IMPORTANTE**: Guarde o arquivo `.jks` e a senha em local seguro! Você vai precisar deles para todas as atualizações futuras.

### Configurar build.gradle

Edite `android/app/build.gradle` e adicione antes de `android {`:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Dentro de `android {`, adicione:

```gradle
signingConfigs {
    release {
        keyAlias keystoreProperties['keyAlias']
        keyPassword keystoreProperties['keyPassword']
        storeFile file(keystoreProperties['storeFile'])
        storePassword keystoreProperties['storePassword']
    }
}

buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

### Criar keystore.properties

Crie `android/keystore.properties`:

```properties
storePassword=SUA_SENHA_AQUI
keyPassword=SUA_SENHA_AQUI
keyAlias=mnemosyne
storeFile=../mnemosyne-release-key.jks
```

⚠️ **IMPORTANTE**: Adicione `keystore.properties` e `*.jks` ao `.gitignore`!

## Passo 10: Gerar AAB (Android App Bundle)

No Android Studio:

1. Menu: **Build → Generate Signed Bundle / APK**
2. Selecione **Android App Bundle**
3. Clique em **Next**
4. Selecione seu keystore (`.jks`)
5. Digite as senhas
6. Selecione **release**
7. Clique em **Finish**

O AAB será gerado em: `android/app/release/app-release.aab`

## Passo 11: Preparar Assets para Play Store

Você vai precisar:

### Screenshots (obrigatório)
- Mínimo 2 screenshots
- Resolução: 1080x1920 (portrait) ou 1920x1080 (landscape)
- Formato: PNG ou JPG

### Ícone (obrigatório)
- 512x512px
- PNG com fundo transparente

### Feature Graphic (obrigatório)
- 1024x500px
- JPG ou PNG

### Descrição (obrigatório)

**Título** (máx 50 caracteres):
```
Mnemosyne - Seu Biógrafo Pessoal
```

**Descrição curta** (máx 80 caracteres):
```
Capture memórias com IA. Criptografia E2EE. Knowledge Graph inteligente.
```

**Descrição completa** (máx 4000 caracteres):
```
🧠 Mnemosyne - Seu Biógrafo de Conhecimento

Capture e organize suas memórias de forma inteligente com criptografia end-to-end e um knowledge graph alimentado por IA.

✨ RECURSOS PRINCIPAIS

📝 Captura Inteligente
• Grave áudio ou escreva suas memórias
• IA extrai automaticamente entidades e relações
• Organização automática com tags e categorias

🔐 Segurança Total
• Criptografia end-to-end (E2EE)
• Suas memórias são 100% privadas
• Nem nós conseguimos acessá-las

🧠 Knowledge Graph
• Visualize conexões entre suas memórias
• Descubra padrões e insights
• Navegação intuitiva e interativa

🎨 Interface Moderna
• Design dark/light elegante
• Animações fluidas
• PWA - funciona offline

📊 Analytics Pessoal
• Acompanhe seu progresso
• Estatísticas detalhadas
• Insights sobre suas memórias

🔄 Compartilhamento
• Gere links públicos
• Exporte para arquivo
• Copie para clipboard

💎 PLANOS

Free: 50 memórias/mês, 1GB storage
Pro: Ilimitado, 50GB, recursos avançados
Business: 500GB, API, equipes

Baixe agora e comece a construir seu legado de conhecimento!
```

## Passo 12: Criar Conta Google Play Developer

1. Acesse [play.google.com/console](https://play.google.com/console)
2. Pague a taxa de $25 USD (pagamento único)
3. Preencha informações da conta
4. Aguarde aprovação (pode levar até 48h)

## Passo 13: Criar App na Play Console

1. Acesse Play Console
2. Clique em "Create app"
3. Preencha:
   - **App name**: Mnemosyne
   - **Default language**: Português (Portugal) ou Português (Brasil)
   - **App or game**: App
   - **Free or paid**: Free
4. Aceite os termos
5. Clique em "Create app"

## Passo 14: Preencher Informações do App

### Dashboard → App content

1. **Privacy policy**: URL da sua política de privacidade
2. **App access**: All functionality is available without restrictions
3. **Ads**: Does your app contain ads? → No
4. **Content rating**: Complete o questionário
5. **Target audience**: 13+
6. **Data safety**: Preencha informações sobre dados coletados

### Dashboard → Store presence

1. Upload screenshots
2. Upload ícone
3. Upload feature graphic
4. Preencha descrições

### Dashboard → Production → Countries/regions

Selecione os países onde o app estará disponível.

## Passo 15: Upload do AAB

1. Dashboard → Production → Releases
2. Clique em "Create new release"
3. Upload o arquivo `app-release.aab`
4. Preencha "Release notes":
   ```
   Versão 1.0.0
   - Lançamento inicial
   - Captura de memórias com áudio/texto
   - Knowledge Graph inteligente
   - Criptografia E2EE
   - Compartilhamento de memórias
   ```
5. Clique em "Save"

## Passo 16: Teste Interno (Opcional mas Recomendado)

1. Dashboard → Testing → Internal testing
2. Crie um grupo de testadores
3. Adicione emails dos testadores
4. Faça upload do AAB
5. Compartilhe o link de teste
6. Aguarde feedback (1-2 semanas)

## Passo 17: Submeter para Revisão

1. Verifique se todos os itens do dashboard estão completos ✅
2. Dashboard → Production → Releases
3. Clique em "Send for review"
4. Aguarde aprovação (pode levar de 1-7 dias)

## Passo 18: Publicação

Após aprovação:
1. Dashboard → Production → Releases
2. Clique em "Publish"
3. Seu app estará disponível na Play Store em algumas horas! 🎉

## Atualizações Futuras

Para atualizar o app:

```bash
# 1. Fazer mudanças no código
# 2. Incrementar versão em android/app/build.gradle
# 3. Build do frontend
cd frontend
npm run build

# 4. Sync
npx cap sync android

# 5. Gerar novo AAB no Android Studio
# 6. Upload na Play Console
```

## Troubleshooting

### Erro de build
- Limpe o projeto: Build → Clean Project
- Rebuild: Build → Rebuild Project

### App não abre
- Verifique logs: View → Tool Windows → Logcat
- Verifique permissões no AndroidManifest.xml

### AAB rejeitado
- Verifique se incrementou o versionCode
- Verifique se assinou com a mesma keystore

## Recursos Úteis

- [Capacitor Docs](https://capacitorjs.com/docs)
- [Android Studio](https://developer.android.com/studio)
- [Play Console](https://play.google.com/console)
- [Play Store Guidelines](https://play.google.com/about/developer-content-policy/)

---

**Parabéns! Seu app está na Play Store! 🚀**
