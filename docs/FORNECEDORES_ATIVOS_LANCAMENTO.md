# Fornecedores de IA para o lançamento

## Decisão de 29 de outubro — pagos económicos autorizados, a aguardar saldo

O responsável autorizou modelos pagos de baixo custo pelo OpenRouter, substituindo a restrição anterior de usar exclusivamente gratuitos. O [catálogo oficial consultado](https://openrouter.ai/api/v1/models) apresenta GPT‑6 Luna a 0,10 USD/milhão de tokens de entrada e 0,50 USD/milhão de saída. É uma candidata, sem integração ou benchmark de qualidade concluídos no produto; o custo depende dos tokens e dos limites efetivos.

Dois pedidos pequenos com conteúdo sintético e preços máximos explícitos foram recusados: GPT‑6 Luna com HTTP 402; Gemini 2.5 Flash Lite com HTTP 404, sem diagnóstico detalhado conservado. Não houve inferência bem-sucedida. A metadata posterior indicou `is_free_tier:true` e utilização reportada de 0 USD. Uma leitura privada da versão existente em Secret Manager foi verificada por CRC32C; valores e respostas de texto não foram expostos. Não se comprou saldo, alterou chave/configuração de conta ou aplicação publicada.

O responsável determinou continuar nos outros pontos e avisará quando adicionar saldo. O runtime conserva, por agora, a configuração gratuita anterior. O próximo incremento de IA deverá definir allowlist económica, tetos por pedido/mês, consentimento com preço e validação real, sem fallback pago silencioso. O teto mensal ainda não foi escolhido. Evidência privada: `W:/real/mnemosyne-launch-evidence/openrouter-low-cost-discovery-20261029/`. As secções seguintes conservam a decisão/implementação anteriores, não uma proibição atual de preparar modelos pagos.

## Decisão e implementação

Em 25/10, o operador acrescentou credenciais OpenRouter e exigiu apenas modelos gratuitos. Esta decisão substitui a seleção NVIDIA de 21/10 na configuração candidata: só OpenRouter fica ativo, com `google/gemma-4-31b-it:free` e Google AI Studio fixos. NVIDIA, Hugging Face, OpenAI e Gemini conservam adaptadores/testes, mas não podem gerar nesta política. A [nota OpenRouter](OPENROUTER_GRATUITO_2026-10-25.md) descreve os limites de preço, a custódia e a validação. A política pública partilhada continua em `functions/src/generationProviderPolicy.ts`, sem SDK, ambiente ou valores de credenciais. Esta configuração ainda não foi publicada.

Só os fornecedores ativos registam `defineSecret`: o binding candidato de texto exige apenas `OPENROUTER_API_KEY`; o de imagem não recebe credenciais, pois o Gemma selecionado só produz texto. Uma declaração de secret sem binding também seria um requisito do Firebase; por isso os fornecedores inativos não são registados. O preflight deriva os requisitos dessa mesma política. Todos os nomes de credenciais, incluindo OpenRouter e os fornecedores inativos, continuam proibidos em dotenv/Vite e não existe fallback para variáveis antigas.

O frontend conserva uma seleção antiga, incluindo NVIDIA/OpenAI, e recusa os fornecedores inativos antes de consentimento, autenticação de geração ou rede. O servidor recusa os modelos desses fornecedores antes de quota de geração, circuito, leitura de secret ou fornecedor; autenticação e rate limit básico continuam a ocorrer antes. Não há substituição automática da seleção. O utilizador pode escolher OpenRouter nas Definições; a política local por omissão continua `never-cloud`/Ollama. Chaves pessoais antigas podem ser removidas nas Definições, sem ser usadas na geração do servidor.

## Modelos e encaminhamento

| ID | Fornecedor e modelo selecionados | Situação operacional mais recente |
|---|---|---|
| `openrouter-gemma-4-free` | OpenRouter → Google AI Studio, `google/gemma-4-31b-it:free` | Única opção cloud ativa na candidata de 25/10. Chave autentica; três pedidos reais devolveram HTTP 429, incluindo um após a substituição do transporte. Não existe ainda inferência real bem-sucedida. Uso diário/total reportado 0 USD. Tetos de preço zero, sem fallback/retry automático/rotação de chave; sem imagem. |
| `nvidia-nemotron-ultra` | NVIDIA, `nvidia/nemotron-3-ultra-550b-a55b` | Novo ID explícito e opção do seletor. Com NVIDIA_API_KEY v2, HTTP 200 e contrato de texto verificado no adaptador candidato. Teto 900 tokens, quatro unidades relativas; bindings publicados ainda não testados. |
| `nvidia-nemotron` | NVIDIA, `nvidia/nemotron-3-super-120b-a12b` | ID histórico conservado sem remapeamento para Ultra. Com a chave v2, o adaptador continua a devolver 404, `function_not_found_for_account`; não é oferecido para nova seleção. |
| `nvidia-image` | NVIDIA, `black-forest-labs/flux.1-schnell`, 1024×1024, quatro passos | Também com a chave v2, deadline de 120 segundos sem status HTTP recebido. Inferência não validada. |
| `hf-default` | Hugging Face Router → Nscale, `openai/gpt-oss-120b:nscale` | Pedido sintético devolveu 402. Requer regularização de pagamento/créditos e nova validação. |
| `hf-image` | Hugging Face Router → Nscale, `black-forest-labs/FLUX.1-schnell`, 1024×1024 | Endpoint Nscale devolveu 402. Mesma pendência. |
| `openai-mini` / `openai-image` | Adaptadores OpenAI conservados | Desativados por decisão do operador; não exigem chave para este lançamento. |
| `gemini-flash` / `gemini-image` | Integração Google Gen AI SDK 2.30.0 preparada para texto/imagem | Inativa. A chave correta passou autenticação e metadata dos modelos (200); texto e imagem devolveram 402. Créditos adiados pelo operador. Ver [integração Gemini](INTEGRACAO_GEMINI.md). |

As linhas NVIDIA/Hugging Face/OpenAI/Gemini e os ensaios seguintes conservam o contexto histórico; todos estão agora inativos na política candidata gratuita. Os IDs NVIDIA continuam a representar os modelos originais, sem remapeamento para OpenRouter. Um pedido de texto sem modelo usa o ID gratuito definido pelo servidor. O modelo Llama 3.1 70B original devolveu 410; o endpoint SDXL Turbo está [descontinuado pela NVIDIA](https://build.nvidia.com/stabilityai/sdxl-turbo). A presença em catálogo/management não prova inferência. Os exemplos GPT-OSS/Gemma na NVIDIA de 22/10 não são o endpoint OpenRouter. A segunda chave NVIDIA continua sem binding/fallback.

Hugging Face deixou de usar `:cheapest`. O destino Nscale é fixo e identificado no consentimento da operação. O contrato de imagem usa o [adaptador oficial Nscale](https://github.com/huggingface/huggingface_hub/blob/main/src/huggingface_hub/inference/_providers/nscale.py), com resposta base64 em vez do hostname antigo. A NVIDIA usa o [contrato FLUX.1-schnell](https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_1-schnell-infer), sem as opções SDXL. Não se seguem redirects nem URLs de imagem devolvidas pelos fornecedores.

As respostas de texto têm de identificar o modelo selecionado; um identificador ausente ou inesperado é recusado. Para imagens, verificam-se base64 canónico, assinatura raster e dimensões 1024×1024, com MIME derivado dos bytes e sem URL persistida. A verificação de cabeçalhos não constitui descodificação integral de imagem. A referência de custo continua a ser uma reserva relativa, sem a apresentar como faturação real.

## Evidência e limites

### Novas credenciais recebidas em 22/10

A [validação operacional atualizada](NVIDIA_VALIDACAO_OPERACIONAL_2026-10-22.md) distingue os três pedidos diretos dos adaptadores da aplicação. Ultra passou ambos os âmbitos com prompts sintéticos. Super e imagem continuam sem inferência validada; GPT-OSS/Gemma não foram ativados. As credenciais foram retiradas do documento depois da transferência/verificação no Secret Manager. NVIDIA_API_KEY v2 será a candidata para o rollout; a alteração do secret não prova binding do runtime. Foram três mutações de Secret Manager, cinco leituras de payload e seis pedidos generativos, zero retries/fallback/deploys. Os resultados abaixo conservam o contexto histórico v1.

### Consulta operacional de 22/10/2026

O ensaio com os adaptadores reais está descrito em [NVIDIA_VALIDACAO_OPERACIONAL_2026-10-22.md](NVIDIA_VALIDACAO_OPERACIONAL_2026-10-22.md). Fez dois pedidos generativos sintéticos, um GET de catálogo e uma leitura autorizada de NVIDIA_API_KEY v1 em memória, com projeto/CRC32C verificados. Não houve retries, fallback, conteúdo de utilizadores, persistência de conteúdo gerado, mutações de configuração ou deploy. A injeção privada do parâmetro SecretParam no processo de ensaio não verifica IAM/bindings de Functions publicadas. O catálogo é público e não serve como prova isolada de autenticação ou de disponibilidade da inferência.

A consulta separada de metadata, sem payloads, voltou a confirmar os dois secrets Stripe ausentes e os dois nomes antigos em dotenv. Os bindings publicados ainda não correspondem à configuração candidata. Não foi aplicada uma correção de modelo ou endpoint: o erro de texto não demonstra, por si só, a causa na conta/organização. Foi pedida ao operador a verificação de acesso NVIDIA. Aguardar mudança de estado antes de repetir geração; Gemini e Hugging Face mantêm os créditos adiados.

Os parágrafos seguintes conservam os ensaios históricos de 20–21/10.

Os ensaios reais usaram apenas prompts sintéticos fixos, com até 64 tokens de saída por pedido de texto, sem memórias/anexos, retries ou fallback automático. Foram sete pedidos generativos e uma consulta adicional à gestão NVIDIA, com cinco leituras autorizadas de secret e verificação de projeto/CRC32C. Não foram gravados valores, identidades de conta, texto gerado nem imagens. Nenhuma geração passou estes ensaios; autenticação bem-sucedida não foi promovida a prova de disponibilidade.

O preflight de 20/10 confirmou NVIDIA/Hugging Face v1 habilitados e retirou OpenAI dos requisitos. Os dois secrets Stripe continuam ausentes e os dois nomes Stripe permanecem em dotenv; não foram importados nem foi ativada faturação. Bindings/IAM de produção e smoke do runtime continuam por verificar após o rollout autorizado.

A repetição de 21/10, já com a política NVIDIA, exige apenas NVIDIA para geração e confirma a sua versão habilitada. Os dois secrets Stripe continuam ausentes. A entrada Gemini adicionada pelo operador junta-se às duas Stripe nos conflitos de dotenv. Não foram lidos payloads nessa repetição de metadata. A verificação da credencial Gemini e os resultados dos ensaios adicionais NVIDIA estão descritos na [nota da integração](INTEGRACAO_GEMINI.md).

Na continuação operacional, a entrada local Gemini, diferente da chave recém-criada na Google, foi substituída pela transferência direta dessa chave para Secret Manager e retirada do `.env`. Esta ação resolveu a autenticação; os 402 de inferência permanecem. A versão Gemini habilitada não se torna automaticamente um binding obrigatório enquanto o fornecedor estiver inativo. A criação do secret e a ativação autorizada da API de gestão não constituem deploy de produto.

A validação local e os logs de 20/10 ficam em `W:/real/mnemosyne-launch-evidence/active-ai-providers-validation-20261020/`; a continuação NVIDIA/Gemini de 21/10 fica em `W:/real/mnemosyne-launch-evidence/nvidia-gemini-validation-20261021/`. As suites locais com fornecedores simulados verificam política, encaminhamento e contratos, sem substituir os ensaios operacionais falhados. Todas as fases 0–6 continuam exigidas; nenhum gate ou deploy é autorizado por esta nota.
