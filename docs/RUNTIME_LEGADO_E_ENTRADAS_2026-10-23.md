# Runtime legado e comandos públicos — 23 de outubro de 2026

## Alterações

Foram retirados os aliases `backend` e `backend:install` do package raiz. Apontavam para o backend Python já eliminado nesta revisão. Em Functions foram retirados `serve`, `shell`, `start` e `logs`: herdavam o projeto Firebase configurado por omissão e os três primeiros abriam percursos que não constituíam um sandbox demonstrado do produto atual. Os comandos de build, testes e publicação explícita permanecem documentados no README.

Os três wrappers npm de publicação (raiz `deploy`/`deploy:all` e Functions `deploy`) usam PowerShell não interativo e o mesmo `deploy.ps1`, que exige `-Project`. A revisão adotou este wrapper, o package raiz e o procedimento de deploy no manifesto de fontes verificadas. O wrapper PowerShell não precisou de alterações. Não se alteraram lógica de aplicação, Rules, índices, schemas, versões de dependências ou artefactos compilados neste incremento.

O novo `scripts/runtime-entrypoints.cjs` verifica os scripts dos dois packages, recusa aliases dos runtimes retirados, CLI Firebase direta e wrappers de publicação divergentes, e exige a ausência dos oito pontos de entrada de runtime identificados. Não executa esses comandos nem lê ficheiros de credenciais. Não controla comandos manuais arbitrários ou qualquer programa novo com outro nome.

A sequência de publicação passou a ter 23 etapas: Node, guard de runtime, gates e restantes pré-requisitos, seguidos das cinco publicações. O guard corre antes dos gates e das consultas remotas. Os testes foram acrescentados aos jobs Functions e Windows de CI; a execução remota e os checks obrigatórios continuam pendentes. O [procedimento](PROCEDIMENTO_DEPLOY_COMPLETO.md) conserva a sequência e a recuperação de falhas parciais.

## Referências e ficheiros já eliminados

Foram inspecionados em memória os 24 caminhos eliminados que já constavam do checkout, sem os restaurar ou criar backups do conteúdo histórico. A análise estática atual percorreu **648 fontes** TypeScript/JavaScript em `frontend/src` e `functions/src` e **2.413 ligações literais relativas** de import/export/require: nenhuma apontou para esses caminhos. Três manifests de assets também não referenciam os dois assets retirados examinados. Os hashes e caminhos constam da evidência privada.

Esta análise não prova equivalência funcional dos ecrãs retirados, resolução de caminhos calculados ou revisão do checkout inteiro. O inventário inicial continha 171 entradas de estado Git fora do manifesto de 934 fontes, incluindo as 24 eliminações e documentação/artefactos com âmbitos de validação distintos. Essa contagem não equivale a 171 fontes sem revisão. A adoção de três ficheiros e os novos guard/teste/documento ampliam o manifesto deste incremento, mantendo `wholeCheckoutVerified=false`.

Os dois ZIP de entrada (`docs.zip` e o ZIP da auditoria em `docs/`) foram preservados no disco e acrescentados ao ignore, assim como `.secret.local`. O exame limitado de texto percorreu 15 entradas elegíveis do primeiro ZIP e oito do segundo; não encontrou os padrões de credenciais de fornecedor e chave privada selecionados. Não incluiu todos os formatos binários nem as chaves Google, que também podem ser configuração pública Firebase. Não constitui certificação de ausência de secrets, revogação ou limpeza de histórico. O ignore não remove ficheiros já rastreados. O eventual `backend/.env` ignorado foi preservado.

## Validação e limites

Passaram **31 testes de scripts**, sem omissões, com Node **22.23.3** no Windows. Incluem a recusa real dos seis aliases npm retirados, a recusa não interativa dos três wrappers sem projeto, a preservação de relatórios existentes e a sequência PowerShell simulada com falha em cada uma das 23 etapas. Os testes existentes de gates e publicação desktop/versão também passaram. Os testes de sequência usam executor simulado e não publicam componentes.

O entrypoint público real executou `-Project mnemosyne-one -PreflightOnly`: Node e runtime passaram, a etapa 3 recusou os **49 gates fechados**, e não arrancou qualquer consulta de produção. O exit 1 do wrapper/exit 2 dos gates é o resultado esperado desta recusa. Os relatórios têm `publicationAttempts=[]`, `releaseComplete=false`, zero pedidos/mutações de API de produção, leituras de payload de secrets, chamadas de geração ou deploys neste incremento. `PreflightOnly` poderá fazer leituras remotas quando os gates passarem; não é um modo universal sem rede.

As suites gerais, os builds, os audits e os pilotos do incremento anterior de [ledger/Vite](LEDGER_MEMORIA_LOCAL_E_REVISOES_2026-10-23.md) conservam o seu âmbito histórico. Foram comparadas as dependências, fontes de aplicação e artefactos desse manifesto, sem repetir suites gerais para alterações de comandos e documentação.

Evidência privada: `W:/real/mnemosyne-launch-evidence/runtime-entrypoints-validation-20261023/`. A prova local encadeada é `W:/real/mnemosyne-launch-evidence/runtime-entrypoints-local-validation-20261023.json`; a predecessora tem SHA-256 `72afe42108a6fbee4665eec89ae775d60c3bdad218ff2c6a1b39c80385d9bfa1`. `releaseReady=false`, `allPhasesComplete=false` e todos os gates permanecem fechados. O [estado completo](ESTADO_LANCAMENTO_COMPLETO.md) mantém os critérios das fases 0–6 antes do deploy já autorizado.
