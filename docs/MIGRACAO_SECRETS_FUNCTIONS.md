# Migração de secrets Functions — 3 de outubro de 2026

## Atualização operacional — 18 de outubro

Foram criados os secrets `NVIDIA_API_KEY` e `HUGGINGFACE_API_KEY` no projeto explícito `mnemosyne-one`, com versão 1 ativa e replicação apenas em `europe-west1`. As novas credenciais fornecidas pelo operador foram enviadas diretamente da memória do processo para Secret Manager; as strings não foram copiadas para argumentos, evidências ou logs. A API validou CRC32C, seguido de releitura de metadata, sem acesso ao payload armazenado. O operador confirmou a substituição NVIDIA e revogação da anterior, sem verificação independente no fornecedor.

Os valores foram retirados do documento indicado pelo operador e substituídos por referências aos secrets. O documento limpo passou Gitleaks por stdin com redaction, sem achados. As duas entradas antigas de IA foram removidas de `functions/.env`, sem preservar uma cópia com valores antigos. Mantêm-se as entradas Stripe e os restantes campos do ficheiro. O procedimento fez quatro pedidos de mutação de recursos, nenhuma alteração IAM, chamada a fornecedor ou publicação de código.

O preflight posterior continua recusado: `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` ausentes, duas entradas Stripe antigas em dotenv e bindings por validar. A configuração não ativa Stripe. A revogação histórica global, credencial OpenAI, IAM/bindings, disponibilidade dos fornecedores e rollout completo permanecem necessários. Os números do estado de 3 de outubro abaixo são históricos.

Prova: `W:/real/mnemosyne-launch-evidence/provider-key-intake-operational-validation-20261018.json`. Fontes, relatórios de metadata, confirmação de gravação e redaction ficam vinculados à prova anterior de cápsulas. Nenhum before image com credenciais foi criado.

## Estado e problema

Incremento local da fase 2. A inspeção real anterior confirmou a ausência dos cinco nomes de secrets esperados no catálogo do projeto `mnemosyne-one` e ausência de bindings nas sete Functions consultadas. O código tinha placeholders e leitura genérica de ambiente. O antigo script de sincronização copiava credenciais do `.env`, usava o projeto implícito e tinha um comentário incompatível com PowerShell.

O novo preflight real, executado apenas com GET de metadata, completou as verificações e recusou os pré-requisitos: **cinco secrets em falta e quatro entradas de credenciais no `.env` de Functions**. O relatório distingue `complete=true` de `secretPrerequisitesReady=false`. Não leu payloads Secret Manager nem valores de ambiente remoto. A inspeção local lê o ficheiro dotenv para reconhecer nomes de chaves, mas não projeta, imprime, copia ou envia valores. O ficheiro permanece intacto.

Não foram criados secrets, alteradas permissões, revogadas chaves, ativado Stripe ou publicado código. A revogação histórica continua a depender da prova que ficou por fornecer; o ensaio de restauração também mantém o destino isolado por designar. O trabalho independente nas restantes áreas pode continuar.

## Decisão e threat model

As chaves de Stripe e fornecedores de IA passam a `defineSecret`; a leitura ocorre no runtime por `.value()` do parâmetro declarado. A configuração de cada Function liga explicitamente apenas os secrets necessários. O reader recusa parâmetros trocados, nomes desconhecidos, valores inválidos e falhas do SDK, sem usar aliases ou fallback genérico de ambiente. `readEnv` serve configurações não sensíveis, como IDs de preços/URLs aprovadas, e recusa nomes conhecidos de credenciais e variantes Vite.

| Functions | Secrets declarados |
|---|---|
| generateText, generateImage | OPENAI_API_KEY, NVIDIA_API_KEY, HUGGINGFACE_API_KEY |
| createCheckoutSession, createBillingPortalSession, getSubscriptionStatus, deleteUserAccount | STRIPE_SECRET_KEY |
| handleStripeWebhook | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |
| Restantes exports | Nenhum destes secrets |

A geração aceita vários fornecedores na mesma Function, pelo que essa Function recebe as três chaves. Separar em Functions por fornecedor é uma opção futura se houver necessidade de isolamento adicional. O servidor continua sujeito à allowlist, admissão, orçamento e circuito.

Foi rejeitado o import automático de chaves antigas do `.env`: isso não provaria revogação, poderia propagar uma chave já exposta e dependia do projeto global. O script de sincronização foi convertido num wrapper de verificações sem escritas. A criação das novas versões será uma operação explícita do procedimento de rollout autorizado.

O SDK injeta secrets como variáveis de ambiente. `.value()` sozinho não comprova a origem de uma variável; a garantia exige remover credenciais de dotenv de deploy, verificar os bindings reais e validar o runtime. O emulador não reproduz o isolamento de secrets por Function, conforme a [documentação Firebase de primeira geração](https://firebase.google.com/docs/functions/1st-gen/config-env-1st). Por isso os testes inspecionam também os descriptors reais das exports, sem ler valores no carregamento do módulo.

## Correção de isolamento encontrada na validação

O SDK instalado tem `FunctionBuilder.runWith()` que atualiza o próprio builder. Um primeiro teste encontrou que o builder regional partilhado transportava os secrets de IA para a Function seguinte de manutenção. As duas exports de IA agora criam builders independentes; as exports Stripe usam uma fábrica de builders. O teste inspeciona **todas** as Functions exportadas e exige exatamente os bindings da tabela, sem dar acesso às restantes. Não se tornou o teste permissivo para aceitar essa herança.

## Preflight e plano

`scripts/function-secrets.js` tem três modos sem mutações:

```powershell
node scripts/function-secrets.js plan --project mnemosyne-one --out W:\real\mnemosyne-launch-evidence\secrets-plan-NOVO.json
node scripts/function-secrets.js audit --project mnemosyne-one --out W:\real\mnemosyne-launch-evidence\secrets-audit-NOVO.json
node scripts/function-secrets.js preflight --project mnemosyne-one --out W:\real\mnemosyne-launch-evidence\secrets-preflight-NOVO.json
```

Exige Node 22, projeto explícito e output absoluto novo (`wx`). Recusa contexto de emulador para a consulta real. Verifica o binding no Resource Manager, usa quota project no cliente efémero e origens Google fixas, sem alterar gcloud global. Só solicita nome/estado de Secret/SecretVersion e runtime/estado/bindings das Functions; nunca chama `:access`. Os erros de rede são projetados por códigos fixos. Faz grupos limitados de quatro verificações independentes.

`preflight` grava o relatório e termina com código **2** quando falta um pré-requisito. HTTP 404 distingue recurso em falta de 403/indisponibilidade, que mantém resultado incompleto. Cada versão `latest` tem de resolver para uma versão numérica ENABLED do mesmo projeto/secret. A verificação publicada exige bindings exatos, versões numéricas correspondentes, Functions ACTIVE e Node 22. `deployedBindingsVerified` é separado dos pré-requisitos para permitir verificar uma migração antes de publicar a nova revisão.

A verificação local cobre dotenv geral, projeto explícito, aliases correspondentes de `.firebaserc` e `.env.local`; no frontend cobre os ficheiros de modos/local, excluindo exemplos. Projeta apenas nomes conhecidos de credenciais e localização do conflito. Não segue symlinks nem aceita ficheiros superiores a 2 MB. Não remove entradas automaticamente.

O wrapper PowerShell `scripts/sync-function-secrets.ps1` exige `-Project` e `-Out`, e aceita `-Mode plan|audit|preflight`. O comportamento antigo de criação foi retirado. O nome foi mantido para que operadores encontrem a explicação, mas chamadas antigas precisam dos novos argumentos.

## Migração e rollout por executar

1. Obter a prova de revogação histórica nos fornecedores e criar credenciais novas pelo procedimento autorizado. Não copiar as credenciais antigas para um secret novo. Em Founder Preview, manter Stripe inativo; usar configuração de teste quando necessária, sem ativar faturação live.
2. Criar as versões de secrets no projeto explícito, por operador autorizado. A [configuração Firebase de secrets](https://firebase.google.com/docs/functions/config-env) exige ligar os secrets às Functions e publicar para a alteração produzir efeito. Não inserir chaves em argumentos de shell, logs, Git, Vite ou este documento.
3. Remover as entradas de credenciais dos dotenv usados no deploy, sem conservar os valores em diffs/artefactos. Tratar cópias históricas/backups com o procedimento de revogação e retenção.
4. Executar novamente o preflight e rever a sua evidência. Confirmar permissões do runtime por secret, serviços habilitados e bindings que a revisão vai publicar. O preflight de metadata não comprova IAM efetivo do service account nem validade da chave no fornecedor.
5. Depois de concluir todas as fases/gates, publicar a revisão revista, verificar metadata real/versões e executar smokes autorizados, com dados sintéticos e logs sem conteúdo.
6. Escoar instâncias antigas, verificar clientes/dispositivos, receção dos alertas e confirmar revogação histórica. Não afirmar que um novo secret retirou as chaves do ambiente de instâncias anteriores.

Uma revisão posterior ligou este preflight ao [procedimento de deploy completo](PROCEDIMENTO_DEPLOY_COMPLETO.md), com projeto explícito, paragem em falhas e relatório de publicação parcial. O procedimento continua recusado pelos gates e não substitui a auditoria final de todas as áreas do [estado de lançamento](ESTADO_LANCAMENTO_COMPLETO.md).

## Validação

Build TypeScript e **175 unitários Functions** passaram em Node **22.23.3**, com uma omissão de rules fora do emulador. Os sete testes novos verificam parâmetros/erros, ausência de fallback, isolamento em todas as exports, projeção dotenv/aliases/Vite, metadata de duas gerações, indisponibilidade/missing/versões/bindings, argumentos e wrapper PowerShell. Os adapters Google são sintéticos nesses testes.

O primeiro teste de descriptors precisou do `GCLOUD_PROJECT` demo exigido pelo SDK para schedulers. A primeira suite completa encontrou a herança de secrets pelo builder; corrigiu-se o código e a repetição completa passou. Uma primeira tentativa focada de emulador falhou antes dos testes porque o shell Windows interpretou o separador do regex. O runner `run-ai-secrets-rule-tests.cjs` passa os argumentos diretamente ao Node e exige o contexto demo. Esses logs iniciais são diagnósticos, sem os apresentar como prova final.

A validação HTTP focada passou **seis testes**, com saída zero e emuladores terminados, em Node **22.23.3**, JBR **21**, projeto `demo-mnemosyne-rules`. Inclui os fluxos de geração/admissão/revogação/observabilidade e billing da conta, mais o caso de secrets indisponíveis para os seis modelos texto/imagem. Este último mantém seis reservas consumidas, devolve 503 honesto e faz zero chamadas externas apesar dos aliases sintéticos de ambiente. Não se chama fornecedor real. Nenhum ficheiro frontend mudou neste incremento; os resultados gerais anteriores conservam a cronologia.

Comandos finais: `npm --prefix functions test` e `npx --yes firebase-tools emulators:exec --only firestore,storage --project demo-mnemosyne-rules "node scripts/run-ai-secrets-rule-tests.cjs"`. O preflight real terminou com **código 2 esperado** e relatório completo com pré-requisitos recusados; o `plan` local terminou com zero. A suite completa de rules **114 +22** pertence ao incremento de observabilidade anterior; não se repetiu neste incremento a parte geral não afetada.

A prova local `W:\real\mnemosyne-launch-evidence\function-secrets-local-validation-20261003.json` conserva hashes de fontes/logs e dos relatórios privados. Assinala `releaseReady=false`, `allPhasesComplete=false`, gates fechados, zero mutações de produção e nenhum deploy. A prova não transforma os adapters sintéticos em validação IAM/fornecedor real.

## Rollback e risco residual

Rollback usa versões de secrets revistas e bindings conhecidos da revisão autorizada, com releitura, smokes e escoamento de instâncias. Não restaurar dotenv com chaves expostas nem reintroduzir aliases para recuperar disponibilidade. A ferramenta não cria, elimina ou desativa secrets; preserva recursos não abrangidos e não trata uma nova versão como prova de revogação no fornecedor. Falta validar a configuração real, permissões, chaves novas, smokes e todas as áreas do produto.
