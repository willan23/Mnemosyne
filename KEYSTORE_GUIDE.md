# 🔐 Guia de Geração de Keystore para Android

## O que é Keystore?

A keystore é um arquivo que contém a chave privada usada para assinar seu aplicativo Android. **É EXTREMAMENTE IMPORTANTE** guardar este arquivo e a senha com segurança, pois você precisará deles para TODAS as atualizações futuras do app na Play Store.

> [!CAUTION]
> **SE VOCÊ PERDER A KEYSTORE OU A SENHA, NÃO PODERÁ MAIS ATUALIZAR SEU APP NA PLAY STORE!**
> Você terá que publicar um novo app com um novo package name.

---

## Passo 1: Gerar a Keystore

Abra o PowerShell e execute:

```powershell
keytool -genkey -v -keystore w:\SaaS\mnemosyne-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias mnemosyne
```

### Perguntas que serão feitas:

1. **Enter keystore password**: Digite uma senha forte (mínimo 6 caracteres)
   - **ANOTE ESTA SENHA!**
   
2. **Re-enter new password**: Digite a mesma senha novamente

3. **What is your first and last name?**: Seu nome completo

4. **What is the name of your organizational unit?**: Pode deixar em branco ou "Mnemosyne"

5. **What is the name of your organization?**: Seu nome ou nome da empresa

6. **What is the name of your City or Locality?**: Sua cidade

7. **What is the name of your State or Province?**: Seu estado/província

8. **What is the two-letter country code for this unit?**: Código do país (ex: PT, BR)

9. **Is CN=... correct?**: Digite `yes`

10. **Enter key password for <mnemosyne>**: Pressione ENTER para usar a mesma senha

---

## Passo 2: Criar keystore.properties

Crie o arquivo `w:\SaaS\android\keystore.properties` com o seguinte conteúdo:

```properties
storePassword=SUA_SENHA_AQUI
keyPassword=SUA_SENHA_AQUI
keyAlias=mnemosyne
storeFile=../mnemosyne-release-key.jks
```

**Substitua `SUA_SENHA_AQUI` pela senha que você criou no Passo 1.**

---

## Passo 3: Adicionar ao .gitignore

**MUITO IMPORTANTE**: Adicione estes arquivos ao `.gitignore` para não commitar suas chaves:

```bash
# No arquivo w:\SaaS\.gitignore, adicione:
*.jks
keystore.properties
android/keystore.properties
```

Execute no PowerShell:

```powershell
Add-Content -Path "w:\SaaS\.gitignore" -Value "`n# Android Keystore`n*.jks`nkeystore.properties`nandroid/keystore.properties"
```

---

## Passo 4: Configurar build.gradle

O arquivo `android/app/build.gradle` precisa ser modificado para usar a keystore.

### Adicione ANTES de `android {`:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

### Dentro de `android {`, adicione:

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

---

## Passo 5: Guardar a Keystore com Segurança

### Opções recomendadas:

1. **Backup em nuvem criptografada**:
   - Google Drive (em pasta privada)
   - Dropbox
   - OneDrive
   
2. **Gerenciador de senhas**:
   - 1Password
   - Bitwarden
   - LastPass
   
3. **Backup físico**:
   - USB drive em local seguro
   - Disco externo

### Informações para guardar:

```
Arquivo: mnemosyne-release-key.jks
Senha: [SUA_SENHA]
Alias: mnemosyne
Localização: w:\SaaS\mnemosyne-release-key.jks
Data de criação: [DATA]
Validade: 10000 dias (~27 anos)
```

---

## Verificar Keystore

Para verificar se a keystore foi criada corretamente:

```powershell
keytool -list -v -keystore w:\SaaS\mnemosyne-release-key.jks -alias mnemosyne
```

Digite a senha quando solicitado. Você deve ver informações sobre a chave.

---

## Próximos Passos

Após criar e configurar a keystore:

1. ✅ Keystore gerada
2. ✅ keystore.properties criado
3. ✅ Adicionado ao .gitignore
4. ✅ build.gradle configurado
5. ⏭️ Gerar AAB no Android Studio

---

## Troubleshooting

### Erro: "keytool is not recognized"

O keytool vem com o Java JDK. Certifique-se de ter o JDK instalado:

```powershell
java -version
```

Se não estiver instalado, baixe em: https://adoptium.net/

### Esqueci a senha da keystore

Infelizmente, **não há como recuperar a senha**. Você terá que:
1. Gerar uma nova keystore
2. Publicar o app como um novo aplicativo na Play Store (novo package name)

Por isso é CRÍTICO guardar a senha com segurança!

---

**Pronto! Sua keystore está configurada e segura! 🔐**
