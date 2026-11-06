# Transporte de fornecedores e consentimento específico

## Alterações locais

A geração de texto/imagem passa por `fetchProviderResponse`. O transporte recusa redirects de todos os tipos, preservando o destino solicitado. Mantém um único deadline até terminar a leitura do corpo, em vez de o desligar quando chegam os headers. Cada operação tem também um limite de bytes: **1 MiB** para a resposta de texto e **16 MiB** para as respostas de imagem, incluindo JSON/base64. Estes limites não são quotas de faturação nem limites de pixels.

São conferidos o tamanho anunciado e os bytes efetivamente recebidos/descodificados. Uma resposta demasiado grande ou que bloqueie durante a leitura aborta a operação. Em falhas HTTP, o adaptador conserva o status para a classificação existente e descarta o corpo upstream. Exceções de rede, tamanho ou timeout tornam-se um erro fixo, sem URL, credencial, prompt ou exceção bruta. Não existe retry ou alternativa automática neste transporte.

As respostas aceites preservam conteúdo e media type para os adaptadores existentes. O helper não certifica formato da imagem, número de pixels, fidelidade do modelo, custo ou compatibilidade de cada endpoint. As configurações administrativas de base URL permanecem; esta alteração não constitui uma allowlist de destinos nem revisão IAM. A proteção de SSRF da pesquisa web mantém o seu transporte separado.

O consentimento da geração passa a apresentar **NVIDIA (via Mnemosyne)** ou **OpenAI (via Mnemosyne)**, de acordo com o fornecedor selecionado, mantendo finalidade, categorias/tamanho e o aviso de custo/retenção indisponíveis. O cancelamento e `never-cloud` continuam a recusar antes de construir o pedido. A alteração não aprova o routing de outros fluxos/Hugging Face nem substitui a revisão global de política.

## Correção de outro ponto de entrada de publicação

A revisão de `.github/workflows/deploy.yml` encontrou comandos Firebase/Hosting diretos que não passavam pelo procedimento completo. Esse workflow passou a chamar o workflow desktop do mesmo commit através de `workflow_call`, com inputs tipados e secrets herdados. O workflow desktop exige agora o workflow reutilizável de **cinco jobs CI** antes do build Windows, da preparação criptográfica e de `deploy.ps1`. O input desktop continua falso por omissão; o workflow denominado Deploy solicita a sequência completa. Não existem comandos Firebase nem ação Hosting paralela nesse invólucro.

A configuração pública Vite anterior foi preservada no job de build, incluindo o rebuild do procedimento completo. O nome do upload usa `inputs.version`, válido tanto na execução manual como na chamada reutilizada. Foram acrescentadas verificações de ligação entre os três workflows. A primeira passagem encontrou uma expectativa do teste que assumia `steps` em todos os jobs; foi adaptada para jobs reutilizáveis, conservando as verificações de assinatura/audit. A segunda passagem aprovou os **49 testes de scripts**, sem omissões. A sintaxe segue o [contrato oficial de workflows reutilizáveis](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows); a execução remota e a proteção da branch continuam pendentes.

## Verificações

O transporte foi ensaiado com HTTP real em loopback e bytes/credenciais sintéticos. Um servidor devolve 307 para outro servidor: o segundo recebe zero pedidos. Foram também verificados bloqueio antes/depois dos headers, limites em streaming e por tamanho anunciado, corpo HTTP de erro descartado, JSON/imagem preservados, configurações inválidas antes do pedido e exceções sem conteúdo. Há um caso de gzip para verificar o limite depois da descompressão.

Os testes de cliente verificam o fornecedor/finalidade no consentimento das quatro combinações texto/imagem × NVIDIA/OpenAI e zero pedidos quando canceladas. Mantêm os cenários `never-cloud`, política desconhecida e contexto/conta/equipa retirados. Nenhum destes ensaios usa dados reais ou serviços generativos públicos.

Resultados finais: **1.535 testes frontend/193 ficheiros**, **499 Functions aprovados/uma omissão prevista**, **277 cenários Functions +23 cliente** na passagem completa de regras, **18 testes focados de política/contexto**, **dez testes de transporte** incluídos nos unitários Functions e **49 testes de scripts de lançamento**. Build/TypeScript, lint com zero erros/23 avisos anteriores e quatro smokes públicos locais passaram. Os emuladores demo foram encerrados normalmente. Os 549 inputs registados da suite de regras mantiveram os hashes. Dependências/locks não mudaram; as auditorias npm anteriores são reutilizadas, sem nova consulta.

Em revisão paralela do checkout, os dois ZIP de documentação tiveram CRC conferido e os **23 membros Markdown** foram inspecionados em memória pelo Gitleaks com redaction: zero ocorrências e zero extrações em claro. Treze PNGs permanecem opacos a essa inspeção; isto não comprova conteúdo visual nem revogação histórica. O inventário contabilizou 983 caminhos Git naquele momento, incluindo fontes ainda fora das provas e 22 remoções históricas que exigem contabilização. Não existe aprovação global do checkout.

Evidência do incremento: `W:/real/mnemosyne-launch-evidence/provider-transport-validation-20261020/`. A base é a prova operacional de autenticação `00174f03132c5f0b05011a88eb64c383961b5b03295f6d1f69e156a2fea78c63`. A consulta de autenticação anterior foi real e separada; estes testes não demonstram inferência, permissão, disponibilidade ou qualidade dos modelos reais. As fases 0–6, revisão dos endpoints/routing e os critérios operacionais/plataformas continuam exigidos antes do deploy.

Prova consolidada: `W:/real/mnemosyne-launch-evidence/provider-transport-and-release-entrypoints-local-validation-20261020.json`. O operador escolheu lançar com NVIDIA/Hugging Face e conservar OpenAI por configurar. A aplicação dessa configuração aos bindings e à interface é o incremento seguinte; não se finge uma chave para satisfazer o manifesto atual.
