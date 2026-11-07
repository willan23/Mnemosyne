# Windows 1.0.9: novo canal de atualização e custódia da chave

## Estado desta continuação

**25 de outubro: backup recuperável verificado.** A nova chave tem uma cópia no Secret Manager, versão 1 de `MNEMOSYNE_DESKTOP_UPDATER_EPOCH2`, no projeto mnemosyne-one, réplica europe-west1. Uma execução nova recuperou esse secret para outro diretório, assinou um desafio novo e passou o verificador Rust com a chave pública configurada. Os bytes privados recuperados correspondem à chave original. A preparação de CI separa agora compilação sem chave e empacotamento com o secret da época 2; esse secret ainda não foi criado no GitHub e não houve execução remota ou deploy.

**Candidata 1.0.9 compilada, assinada e validada localmente.** MSI/NSIS e respetivos nomes/versão passaram o verificador Rust antes e depois da cópia. O executável extraído do MSI final passou o ensaio WebView2 e o publicador passou com os ficheiros reais numa cópia isolada. Os downloads do checkout e o feed antigo mantêm-se intactos. Não houve instalação de um MSI/NSIS, atualização instalada, alteração do Hosting ou deploy. Prova consolidada: windows-candidate-local-validation-20261024.json.

## Problemas confirmados e decisão do responsável

Os instaladores existentes eram de setembro. A primeira tentativa de construir a revisão atual foi recusada pela CLI: Rust updater 2.14.0 e JavaScript updater 2.10.1 não pertenciam ao mesmo par major/minor. O preflight anterior examinava apenas o núcleo Tauri e tinha aprovado essa instalação. O erro foi reproduzido num teste negativo, corrigido com @tauri-apps/plugin-updater 2.14.0 fixado e o preflight passou a verificar todos os quatro plugins JavaScript/Rust, os locks e a classificação de runtime. As outras dependências npm ficaram idênticas; os locks da aplicação passaram a 1.0.9.

O build seguinte compilou Rust em release e criou MSI/NSIS 1.0.9, mas a assinatura ficou por concluir. A variável de caminho usada inicialmente não foi reconhecida pelo comando build desta CLI. A tentativa com TAURI_SIGNING_PRIVATE_KEY apontada ao ficheiro encontrou a chave, mas recusou a password vazia. Os dois erros foram conservados. Não se tratou a existência dos instaladores como sucesso da assinatura.

O responsável informou que esqueceu a password e escolheu explicitamente **nova chave e migração por instalação manual**. Não foi encontrada essa variável nas configurações locais examinadas nem nos secrets do repositório GitHub. Não se tentou adivinhar ou redefinir a password. O ficheiro antigo continua preservado.

Uma instalação que confia na chave antiga não pode autenticar uma atualização assinada apenas pela nova. A [documentação do updater Tauri](https://v2.tauri.app/plugin/updater/#signing-updates) exige essa relação de confiança e avisa que perder a chave impede novas atualizações para instalações existentes. O novo par não recupera a chave anterior.

## Canal separado e migração

- Versão candidata: **1.0.9**, distinta dos instaladores 1.0.8 já existentes. Não se substituem bytes diferentes sob um nome versionado já preparado em public.
- Canal anterior: `/desktop/latest.json`. A consulta pública confirmou versão 1.0.8 e bytes iguais à cópia local. O contrato fixa o seu SHA-256 e exige a sua conservação em public e dist. Não se afirma que foi ensaiada uma atualização de um cliente histórico.
- Canal novo: `/desktop/v2/latest.json`, com manifesto `/desktop/v2/release-manifest.json`, epoch 2, primeira versão 1.0.9 e fingerprint da chave pública nova. A configuração Tauri usa apenas este canal e conserva requireSignedVersion e recusa de downgrades.
- Clientes 1.0.8 ou anteriores precisam de instalar manualmente a primeira versão do canal novo. Depois passam a confiar na nova chave. A página Download explica isso nos quatro idiomas; não apresenta caminhos internos de JSON como instrução ao utilizador.

`frontend/src/config/desktopReleaseChannel.json` é metadata pública. `check-desktop-release-contract.cjs` exige canal, chave, política e versões npm/Tauri/Rust coerentes, além do hash do feed legado. O preflight corre antes do build frontend do Tauri. O publicador também o exige com ambos os destinos presentes e volta a comparar os hashes da configuração e do contrato antes de escrever os feeds.

O publicador mantém verificação criptográfica de MSI/NSIS, versão e nome assinados, cópia para temporário, readback, aliases e escrita dos feeds por último. Uma alteração de configuração durante a cópia é recusada antes dos feeds. A assinatura de um instalador não pode ser aproveitada para bytes ou versão diferentes. A publicação local de ficheiros continua sem transação global entre public e dist; uma falha exige inspeção e nova verificação, não rollback automático.

## Custódia local da chave nova

O par foi gerado pela CLI Tauri e a chave privada ficou fora do checkout, em `W:/real/mnemosyne-launch-secrets/desktop-updater-epoch2-20261024/`. O diretório tem herança de ACL retirada e concessões apenas ao utilizador atual e SYSTEM. Os bytes privados são protegidos por DPAPI CurrentUser e relidos para confirmar a proteção antes de remover o ficheiro privado temporário em claro. Não se publica material privado nem se regista o output da geração.

O [DPAPI CurrentUser](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata.protect) protege os bytes para a conta Windows atual. **O ficheiro DPAPI não é um backup portátil nem uma recuperação independente da conta/máquina.** Em 24 de outubro só existia esta custódia local. A continuação de 25 de outubro acrescentou a cópia de recuperação abaixo; a custódia e a execução de CI permanecem pendentes.

O script local tem ações fechadas, sem executor arbitrário:

```powershell
# Nova custódia: exige um diretório novo e absoluto fora do checkout.
.\scripts\desktop-updater-key.ps1 -Action Generate -KeyDirectory W:\real\mnemosyne-launch-secrets\outro-diretorio-novo

# Compila sem credencial de assinatura; só depois abre a chave para empacotar/assinar.
.\scripts\desktop-updater-key.ps1 -Action Build -KeyDirectory W:\real\mnemosyne-launch-secrets\desktop-updater-epoch2-20261024
```

Generate não substitui uma chave existente. Build/Bundle recusam links, ficheiros incompletos/excessivos, chave pública incoerente e runtimes desalinhados. As credenciais anteriores do processo e a diretoria são restauradas, inclusive em falha. O valor privado não entra nos argumentos do processo. Não se promete eliminação completa de strings da heap: a CLI de assinatura precisa da chave em memória e no seu ambiente durante o empacotamento.

## Recuperação a partir do Secret Manager — 25 de outubro

A revisão leu as permissões efetivas dos roles atribuídos na política do projeto. Encontrou um utilizador owner com acesso direto ativo a payloads e uma concessão condicional de secretmanager.admin já expirada em abril. Os runtimes identificados não tinham acesso direto a payloads por essa política. Há agentes administrativos com capacidade de alterar IAM ou criar tokens; esta custódia depende da segurança administrativa do projeto e da conta Google. Não se afirma isolamento contra esses administradores ou uma auditoria completa de impersonação.

Criaram-se apenas um secret novo e a sua versão imutável 1. A política no recurso não tem concessões próprias; não se acrescentaram permissões, bindings de Functions, configuração de Hosting ou acessos a runtimes. O upload incluiu CRC32C e o servidor confirmou a receção do checksum. O restauro verifica o checksum recebido, nome exato da versão, esquema, época e chave pública, conforme o [contrato de integridade do Secret Manager](https://docs.cloud.google.com/secret-manager/docs/data-integrity).

O payload do secret GCP é um pacote JSON v1 com época, chave pública e chave privada. **O secret GitHub com o mesmo nome, quando configurado, deve conter só o valor privado esperado pela CLI Tauri; não deve receber esse pacote JSON.** Nenhum dos valores entra no Git, argumentos de processo ou logs. O GitHub continuava sem secrets/environments na consulta de 25 de outubro; não se escreveu nele nesta etapa.

O comando de recuperação exige uma versão numérica explícita e uma diretoria nova, absoluta e fora do checkout:

```powershell
.\scripts\recover-desktop-updater-key.ps1 -Project mnemosyne-one -SecretVersion 1 -KeyDirectory W:\real\mnemosyne-launch-secrets\desktop-updater-epoch2-recovery-new
```

O comando exige Node 22, cargo/CLI Tauri e autenticação gcloud com acesso à versão. Confere o contrato do canal e compila o verificador antes de ler o pacote. Lê a chave por HTTPS para memória, sem ficheiro privado em claro, restringe a diretoria a utilizador/SYSTEM e usa um processo de assinatura com credencial só no ambiente desse filho. Só grava a custódia DPAPI depois de uma assinatura de desafio aceite pela chave pública configurada; confirma ainda o readback DPAPI. Recusa links, diretórios existentes e versões implícitas como latest. A recuperação nunca modifica secrets ou IAM. Se uma execução falhar depois de criar a pasta, deve-se inspecioná-la e escolher outra pasta nova; não há substituição automática.

O ensaio real recuperou da versão remota, num processo e diretório novos sob a mesma conta Windows. Não recebeu o diretório DPAPI original. Passou a assinatura e a comparação dos bytes recuperados com a chave original, sem guardar o hash privado. Isto verifica o percurso cloud; não constitui ensaio numa segunda máquina ou de recuperação da conta Google.

O workflow compila com `--no-bundle` sem injeção da chave. A etapa seguinte recebe exclusivamente `secrets.MNEMOSYNE_DESKTOP_UPDATER_EPOCH2`, recusa valor ausente e executa `tauri bundle --ci`, com password vazia e caminho de chave herdado retirado. Os testes executam o corpo PowerShell real dessa etapa com CLI sintética: falta de chave não chega à CLI, os argumentos não contêm o valor e o exit 42 propaga-se. A verificação criptográfica dos instaladores antes do staging mantém-se. Não houve dispatch nem publicação das alterações do checkout misto.

Passaram **74 testes Node/PowerShell em sete ficheiros**, sem omissões, incluindo publicação/assinaturas, contrato do canal, identidade de build e custódia. Os testes novos cobrem CRC32C conhecido, nove classes de pacotes recusados, seis entradas/destinos inseguros e isolamento do processo de assinatura. As suites gerais de produto não foram repetidas para estas alterações de scripts/workflow.

Prova deste incremento: `updater-custody-local-validation-20261025.json`, encadeada à prova Windows de 24 de outubro. O resultado regista duas mutações de Secret Manager, uma leitura de payload, zero alterações de IAM, zero escritas GitHub e zero deploys.

## Validação já concluída

- **68 testes Node/PowerShell**, sem omissões: contrato de canal, custódia DPAPI real com material sintético, preflight de plugins, publicação, falhas de cópia/IO/concorrência, assinaturas/versões e coerência de bundle web.
- **55 testes frontend em oito ficheiros**, sem omissões: versões e lifecycle, página Download nos quatro idiomas, traduções e abertura de downloads. TypeScript passou; lint dos cinco ficheiros do âmbito tem zero erros/avisos.
- Auditoria atual das dependências npm de produção do frontend: zero vulnerabilidades. Só o updater JavaScript mudou de versão de dependência.
- Antes da troca da chave, o executável real extraído do MSI passou um ensaio WebView2 com perfil isolado: versão 1.0.9 e bundle type msi via IPC, interface pública renderizada, contexto seguro, Wasm permitido, avaliação dinâmica recusada e Worker real. Houve quatro CONNECT bloqueados pelo proxy que não encaminha pedidos, a Edge/Hugging Face/feed público, zero pedidos encaminhados e nenhum Auth/cofre real. O processo foi parado deliberadamente e o proxy encerrado. Não é evidência de instalação, atualização instalada, conta, hardware ou do binário final com a chave nova.
- O build com a nova chave passou por compilação sem credencial e empacotamento com a chave aberta apenas nessa fase. Não houve drift das fontes observadas ou dos downloads anteriores durante o build. MSI e NSIS têm assinaturas válidas com versão/ficheiro vinculados; as cópias privadas foram novamente verificadas.
- No MSI final, o ensaio confirmou a chave pública nova embutida e ausência da anterior, IPC de versão/bundle type, Wasm/Worker/CSP e o aviso de migração nos quatro idiomas. O comando nativo real recusou um URL file. O clique de download foi observado num breakpoint do debugger com destino HTTPS correto; apenas essa chamada de teste foi desviada para um comando inexistente antes de poder abrir o browser. Não houve download ou browser externo. A primeira tentativa de interceção falhou porque a função Tauri é readonly; conservou-se a falha e ajustou-se o harness, sem alterar o produto para o teste.
- O ensaio anterior tinha reproduzido um problema real: o botão usava http://tauri.localhost como origem de download. A origem de Tauri/Capacitor passou para o Hosting público, com preservação da origem em browsers normais. O Windows usa agora o comando open_external_url já existente; esquemas executáveis/credenciais de URL e falhas nativas são recusados sem logs brutos ou fallback. A candidata foi recompilada e assinada de novo após esta correção. O despacho Android não foi ensaiado.
- A preparação/verificação completa de public/dist passou numa mirror isolada, com instaladores reais e o verificador real. Conservou o feed antigo, todos os instaladores versionados anteriores e o APK. Isto valida o procedimento sem congelar uma versão ainda com gates fechados nos downloads reais. O staging final do checkout ocorrerá a partir das fontes finais do rollout.
- As primeiras falhas dos testes novos foram conservadas: módulo PowerShell de outra edição herdado por PSModulePath e seleção ambígua de mais de um node.exe. O script passou a importar o módulo da edição em execução e a selecionar o primeiro executável resolvido. O teste de staging passou a definir explicitamente a versão sintética da fixture, independentemente da versão real em desenvolvimento.
- A primeira leitura JSON do feed público encontrou BOM UTF-8. O parser foi corrigido para o aceitar sem modificar os bytes preservados. O setup anterior não foi repetido e a consulta seguinte confirmou os hashes. Isto não valida por si o parser de um cliente antigo.

## Limites, rollout e rollback

A chave do updater e Authenticode são assinaturas diferentes. O executável e os instaladores examinados não tinham assinatura Authenticode; esta continua opcional no procedimento existente. Não foi importado certificado, alterada a política Windows ou suprimida a validação do updater.

Não há mudança de schema Firestore, Rules, índices, identidade da aplicação ou cifra do cofre. Não se apagam dados nem se roda a mnemónica para esta migração. Os APK/SDK/backend anteriores não foram recompilados nesta etapa. Pilotos de instaladores/atualização real, Auth/App Check por plataforma, custódia/execução de CI e restantes critérios das fases 0–6 continuam exigidos. A recuperação da chave a partir do Secret Manager tem a validação e os limites de 25 de outubro descritos acima.

Rollback deve preservar o canal antigo e a nova chave/contrato para clientes já migrados. A chave perdida não assina um rollback novo; não se pode simplesmente voltar ao canal anterior para resolver a custódia. O rollout completo só poderá publicar os ficheiros coerentes e os aliases depois das fases e dos smokes operacionais. **49 gates continuam fechados; nenhum deploy foi executado.**
