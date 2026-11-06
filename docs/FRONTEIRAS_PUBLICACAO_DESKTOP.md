# Validação local dos pontos de entrada desktop — 20 de outubro de 2026

## Execução e publicação

O workflow desktop passa versão e notas através de variáveis de ambiente para argumentos PowerShell. Nenhuma expressão GitHub é interpolada no código executável. O ensaio com o corpo real do workflow confirma preservação literal de aspas, subexpressões, Unicode, quebras de linha e uma versão malformada, usando um publicador sintético num diretório temporário. Não executa GitHub nem o publicador de produção.

O input booleano `deploy_release`, falso por omissão, chama `deploy.ps1` com projeto explícito e diretório de relatório próprio. O caminho direto `firebase deploy --only hosting` foi retirado desse workflow. O switch antigo `publish-desktop.ps1 -DeployHosting` recusa a operação antes de criar diretórios ou copiar instaladores; a publicação segue o procedimento completo. A versão do publicador exige três componentes numéricos. Estes controlos não comprovam os restantes requisitos de lançamento.

## Política de conteúdo nativa

A CSP acrescenta `wasm-unsafe-eval` a `script-src`. O ensaio Chromium local executa um módulo Wasm no contexto principal e num Worker, mantendo recusados `new Function` e scripts inline. O controlo com a mesma política sem essa opção recusa ambos os módulos Wasm. Usa só pedidos GET em loopback, sem credenciais ou dados reais. A configuração segue a [orientação oficial do Tauri para Wasm](https://v2.tauri.app/security/csp/).

É uma validação da política configurada em Chromium; a aceitação em WebView2, no pipeline de modelos e em hardware continua necessária.

## Dependências e assinaturas do updater

A primeira revisão atualizou o updater de 2.10.1 para a versão estável 2.14.0 e o verificador minisign de 0.2.5 para 0.3.0. O Tauri documenta as correções de [comparação de versões](https://v2.tauri.app/release/updater/v2.12.0/) e de [assinaturas Ed25519 não canónicas](https://v2.tauri.app/release/updater/v2.13.3/). O manifesto fixa 2.14.0 e o lockfile regista as dependências efetivas.

A auditoria inicial encontrou nove advisories em quick-xml, rustls e zip, mais avisos separados. As atualizações compatíveis resolveram plist 1.10.2/quick-xml 0.42.0, rustls 0.23.46 e anyhow 1.0.104. A versão estável do updater ainda dependia de ZIP 4; foi preservado o suporte ZIP através de uma cópia do pacote oficial 2.14.0, verificada contra o checksum do arquivo de crates.io. A única alteração num ficheiro upstream é a dependência Windows de ZIP 4 para ZIP 9, resolvida em 9.0.5. Código Rust, permissões e licenças upstream permanecem iguais. A nota e os hashes de origem identificam o patch, cuja remoção depende de uma versão upstream corrigida e validada. Não foi adotada a versão 3 alpha nem retirado o suporte a arquivos para passar a auditoria.

A nova auditoria encontrou zero vulnerabilidades conhecidas. Mantém visíveis `proc-macro-error` sem manutenção e o aviso GLib; o grafo Windows consultado não inclui GLib. O relatório do lockfile cobre também dependências de outros alvos e não certifica Linux. O CI e o workflow de publicação incluem compilação com lockfile, auditoria RustSec e os testes upstream selecionados de assinatura/versão. A execução remota permanece por verificar.

O CLI foi fixado em 2.12.3. A configuração exige `requireSignedVersion:true` e conserva `allowDowngrades:false`. O CLI disponibiliza assinatura ligada à versão da aplicação. Passaram oito testes upstream de versão e um de integridade dos bytes, incluindo recusa de alteração de versão, ausência de versão assinada e bytes adulterados. A compilação Windows com lockfile passou com a política final. Os defaults e conjuntos de permissões nativas foram comparados com a base e permanecem iguais; os descritores novos de comandos não foram acrescentados aos conjuntos por omissão.

O diagnóstico oficial encontrou a API JavaScript 2.11.0 incompatível com o Rust 2.12.4, apesar de terminar com código zero. A API passou para 2.12.4 e para `dependencies`, ficando incluída na auditoria de produção. O controlo `check-tauri-version-alignment.cjs` valida versões instaladas/lockfile, o par major/minor e a classificação do SDK de runtime; tem seis casos automatizados e integra ambos os workflows. As alterações npm ficam limitadas à API e ao CLI Tauri, incluindo os binários opcionais do CLI.

## Validação e pendências

Resultados finais: **1.531 testes frontend/193 ficheiros**, **28 testes Node/PowerShell**, **nove testes upstream do updater**, compilação Rust Windows com lockfile, build web/TypeScript, lint com zero erros/23 avisos anteriores e quatro smokes públicos locais. O ensaio da CSP passou nos contextos principal e Worker, com controlo negativo e recusa de JavaScript dinâmico/inline. As auditorias npm de produção e RustSec reportaram zero vulnerabilidades conhecidas; os dois avisos RustSec descritos permanecem visíveis, sem advisories ignorados. Gitleaks 8.29.1, com redaction, inspecionou cerca de 215 KiB do diretório vendor e reportou zero ocorrências.

Os logs de todas as tentativas foram preservados. O primeiro comando de testes da dependência recusou a execução fora do workspace; a inclusão do pacote no workspace e a resolução inicial do lockfile permitiram a execução, depois repetida com `--locked`. A aplicação continua a ser o membro por omissão. A verificação de alinhamento foi acrescentada porque o diagnóstico informativo não falhava por exit code. A suite de regras e os testes Functions do incremento anterior são reutilizados com fontes e executores inalterados; não representam uma nova execução neste incremento.

Evidência local: `W:/real/mnemosyne-launch-evidence/native-release-entrypoints-validation-20261019/`. A base é a prova do corte SDK `049549c6432b9d88750d25500614c815dfc333a6da8b9b40ade09fecebd8d347`.

Prova deste incremento: `W:/real/mnemosyne-launch-evidence/native-release-entrypoints-local-validation-20261020.json`, com fontes, before images, proveniência do pacote upstream, resultados e artefactos web reconstruídos. O âmbito continua local e não cobre o checkout inteiro.

O publicador de artefactos ainda exige a revisão completa da seleção, assinatura, versão, cópia e feed. Instaladores novos, verificação das assinaturas e aceitação real de atualização ainda não foram produzidos neste incremento. Authenticode mantém o contrato documentado; nenhum certificado foi comprado ou configurado. Permanecem também os critérios globais das fases 0–6, segredos/bindings, dados legados, alertas, CI protegida, plataformas e qualidade. Não houve publicação de produto, abertura de gates ou mutação de produção.
