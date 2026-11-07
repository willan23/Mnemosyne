# Preparação verificada dos instaladores Windows

## Custódia recuperável — 25 de outubro de 2026

A [recuperação da nova chave](MIGRACAO_CHAVE_UPDATER_WINDOWS_2026-10-24.md#recuperação-a-partir-do-secret-manager--25-de-outubro) foi verificada a partir do Secret Manager, com checksum, assinatura de desafio real e custódia DPAPI nova. O secret GCP contém um pacote de recuperação JSON; a injeção GitHub preparada no workflow espera apenas a chave privada. O build Tauri não recebe essa chave: compila com --no-bundle e só a etapa seguinte executa bundle --ci com o secret da época 2. Falta configurar o secret GitHub e executar o CI remoto depois de rever as alterações do checkout. O procedimento não publicou downloads nem executou deploy, instalação ou atualização instalada.

## Novo canal de atualização — 24 de outubro de 2026

A [migração da chave Windows](MIGRACAO_CHAVE_UPDATER_WINDOWS_2026-10-24.md) foi escolhida pelo responsável depois de perder a password da chave anterior. A candidata passa a 1.0.9 e usa o canal `/desktop/v2/latest.json`, com manifesto `/desktop/v2/release-manifest.json`. O feed anterior `/desktop/latest.json` é conservado byte a byte para os clientes antigos. Estes precisam de instalação manual para entrar no novo canal.

O contrato público fixa epoch, primeira versão, caminhos, fingerprint da chave pública e hash do feed antigo. O preflight/publicador validam essas relações, os metadados de versão e a preservação do feed nos dois destinos. Alterar contrato/configuração durante a cópia impede escrever feeds novos. A custódia local usa DPAPI fora do checkout; geração e rotação são operações separadas do verificador. A assinatura final da candidata e os pilotos operacionais têm estado no documento da migração, sem herdar aprovação dos testes sintéticos abaixo.

## Contrato de publicação

`scripts/publish-desktop.ps1` prepara os downloads e o feed localmente. A publicação completa usa `deploy.ps1 -Project mnemosyne-one`; o switch antigo `-DeployHosting` recusa a operação antes de preparar ficheiros. O workflow desktop mantém o deploy opcional desativado por omissão.

A versão deve coincidir com `frontend/package.json`, `src-tauri/tauri.conf.json`, o pacote da aplicação em `Cargo.toml` e `DESKTOP_APP_VERSION`. São obrigatórios os nomes exatos `Mnemosyne_<versão>_x64-setup.exe` e `Mnemosyne_<versão>_x64_en-US.msi`, ambos com o respetivo `.sig`. Não existe seleção de outro MSI por wildcard ou reutilização de uma assinatura antiga.

O verificador Rust independente usa **minisign-verify 0.3.0**, a mesma biblioteca e modo de verificação do updater 2.14.0. Valida a assinatura dos bytes e do comentário de confiança antes de ler os campos `version` e `file`. Ambos têm de existir uma única vez e corresponder exatamente ao artefacto anunciado. A chave pública vem da configuração atual; o verificador não gera, roda ou recebe a chave privada. O lockfile do pequeno verificador tem auditoria própria, sem advisories ignorados.

## Ordem e falhas

O publicador confirma primeiro ambos os instaladores e as assinaturas. Recusa links/junctions e a substituição de bytes ou assinatura diferentes sob o mesmo nome versionado. Um lock exclusivo impede dois escritores no mesmo checkout; um lock deixado por uma interrupção exige inspeção e não é removido automaticamente por outra execução.

Depois copia para uma pasta temporária, volta a verificar criptograficamente os ficheiros copiados e compara os hashes com a leitura inicial. Prepara apenas a lista explícita desta versão, sem copiar arquivos antigos ou APKs por wildcard. Publica os ficheiros por substituição individual, confirma os hashes nos dois destinos e escreve `release-manifest.json` e, por último, `latest.json`. O manifest conserva versão, hashes e tamanhos de ambos os instaladores.

Uma falha antes dos feeds pode deixar alguns instaladores/aliases novos, mas conserva os feeds anteriores. Não existe uma transação global entre `public` e `dist`: uma falha entre as duas substituições finais pode deixar os feeds em versões distintas, cujos ficheiros versionados já foram preparados em ambos os destinos. Deve repetir-se a verificação antes de qualquer deploy. As versões anteriores permanecem no disco; retenção/remoção de artefactos antigos é uma operação separada.

`-SkipCopy` usa os instaladores versionados já presentes em `public`, voltando a exigir os dois `.sig` e a verificação completa antes de preparar `dist`. Não aceita apenas um alias ou um feed antigo.

## Verificação sem preparar downloads

```powershell
node scripts/stage-desktop-artifacts.cjs --verify-only
```

O comando compila o verificador com `--locked`, lê os quatro instaladores versionados nos dois destinos, verifica assinaturas/versão/nomes, aliases, manifests e feeds, e recusa inconsistências. Não altera instaladores, manifests ou feeds; usa um lock temporário e o diretório de compilação do verificador. Está no pipeline completo depois do build web e antes dos comandos Firebase. Uma recusa interrompe as etapas posteriores.

O workflow testa o verificador e os cenários do publicador antes de construir a aplicação. O upload de CI enumera nove ficheiros exatos e falha se faltarem, incluindo as assinaturas e os dois JSON. A assinatura Authenticode mantém o contrato opcional documentado e não substitui minisign.

## Evidência de 20 de outubro de 2026

Passaram **48 testes Node/PowerShell** na seleção de publicação, inputs e gates; **cinco testes Rust** com um vetor público upstream; e o ensaio PowerShell da sequência completa, incluindo interrupção em cada uma das 22 etapas simuladas. A auditoria do verificador reportou zero vulnerabilidades e zero avisos, sem ignorar advisories.

As fixtures usam chaves Ed25519 descartáveis apenas em memória e bytes sintéticos que nunca são executados. Os testes chamam o verificador real, incluindo assinaturas válidas com versão/ficheiro errados ou ausentes, bytes modificados, assinatura de outra chave, aliases/feed/manifest alterados, mudança durante cópia, falha de I/O, lock concorrente e junction. Isto valida a preparação local; não comprova os instaladores reais, SmartScreen, WebView2, atualização instalada, CI remota ou deploy.

A execução de `--verify-only` no checkout atual recusou os artefactos antigos por faltar um ficheiro versionado/assinatura obrigatório. Não preparou downloads nem fez deploy. É necessária uma versão candidata nova, construída e assinada a partir das fontes finais; os binários anteriores não receberam aprovação por herança.

Fontes, logs e limites: `W:/real/mnemosyne-launch-evidence/desktop-artifact-staging-validation-20261020/`. Prova consolidada prevista: `W:/real/mnemosyne-launch-evidence/desktop-artifact-staging-local-validation-20261020.json`. A base é a prova nativa `d59232f1cc7d3e3ca19160321a17487b9debbd8e0d9d9cafc2eaf2b9503d43a0`. As suites frontend/Functions/regras são reutilizadas dessa cadeia apenas mediante igualdade de hashes; não foram executadas de novo para este incremento de scripts.

As fases 0–6 e os restantes critérios globais continuam obrigatórios. Não houve deploy, alteração de gates, acesso a secrets ou execução de instaladores.
