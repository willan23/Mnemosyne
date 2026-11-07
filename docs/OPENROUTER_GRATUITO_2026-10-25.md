# OpenRouter: geração exclusivamente gratuita — 25 de outubro de 2026

O operador forneceu duas credenciais locais e determinou usar apenas modelos gratuitos. A candidata passa a permitir um único modelo cloud de texto: `openrouter-gemma-4-free`, resolvido no servidor para `google/gemma-4-31b-it:free`. NVIDIA, Hugging Face, OpenAI e Gemini permanecem implementados, mas inativos nesta política. Nenhuma configuração foi publicada.

## Encaminhamento e custo

O [catálogo oficial](https://openrouter.ai/google/gemma-4-31b-it:free) identifica a variante gratuita, com saída de texto. A API pública confirmou preço zero de entrada/saída e o endpoint Google AI Studio. A geração de imagens é recusada antes do pedido; entrada multimodal não equivale a produção de imagens.

Cada pedido fixa o modelo e `provider.only: ['google-ai-studio']`, com `allow_fallbacks: false`, `require_parameters: true`, `data_collection: 'deny'` e `max_price` zero para prompt, completion, request e image. Estes são [filtros documentados de encaminhamento](https://openrouter.ai/docs/guides/routing/provider-selection). Não são enviados arrays alternativos de modelos, routers, ferramentas ou plugins. Não se seguem redirects, nem se fazem retries ou rotação automática de credenciais.

O cliente só envia o ID interno e o servidor recusa alterações de fornecedor/modelo/opções antes de reservar quota ou contactar o adaptador. O adaptador volta a verificar o modelo exato, prompt de 2–4.000 caracteres e saída de 64–900 tokens. Exige resposta de texto, modelo reconhecido, fornecedor esperado quando reportado e `usage.cost` numérico igual a zero; custos ausentes ou diferentes de zero são recusados. Um erro do fornecedor não é substituído por texto fabricado.

A unidade relativa reservada no budget da aplicação continua a limitar abuso; não representa euros/dólares cobrados. O resultado inclui `inference_cost_usd: 0` apenas após validar esse campo. Os controlos abrangem inferência OpenRouter; armazenamento, Hosting, Functions e outras infraestruturas continuam sujeitos aos seus próprios custos. Uma resposta recusada por divergência de custo não é prova de estorno: os tetos são impostos antes do pedido.

## Privacidade e credenciais

O consentimento identifica OpenRouter → Google AI Studio, finalidade, categorias, bytes aproximados, preço de inferência e retenção desconhecida. `never-cloud` continua a impedir rede; `confirm-cloud` continua por operação, e a seleção local/Ollama por omissão mantém-se. Seleções antigas não são substituídas silenciosamente pelo novo fornecedor. O filtro `data_collection: 'deny'` não constitui uma promessa de ausência absoluta de retenção ou de residência europeia do processamento.

As duas chaves autenticaram por consulta de metadata; só a primeira foi selecionada. A chave selecionada foi transferida para `OPENROUTER_API_KEY` v1 em `mnemosyne-one`, réplica europe-west1, com CRC32C e leitura de confirmação. Os valores em claro foram retirados de `functions/.env` depois da confirmação. Uma cópia do estado anterior e as duas credenciais ficaram protegidas por DPAPI/ACL fora do Git. A segunda chave permanece sem utilização generativa; não é um mecanismo de contornar quotas. A encriptação DPAPI foi verificada sob a mesma conta Windows, sem ensaio noutra máquina.

Só texto declara/binda o novo secret; a Function de imagem não o recebe. Não houve alteração de IAM, bindings publicados ou deploy. A validação por injeção privada do SecretParam no processo de ensaio não demonstra acesso de uma Function publicada ao secret. As antigas credenciais Stripe e a comprovação de revogação histórica continuam sujeitas aos seus requisitos de lançamento.

## Resultado operacional e validação

Houve inicialmente dois pedidos reais sintéticos: um direto e outro pelo adaptador compilado com o parâmetro SecretParam real. Ambos devolveram **HTTP 429**. Após substituir o transporte e passarem várias horas, uma única validação adicional do novo caminho também devolveu 429. Os três pedidos usaram a mesma variante gratuita; os ensaios dos adaptadores verificaram os tetos/caminho enviados. As consultas posteriores indicaram uso diário/total de 0 USD. Não existe ainda geração real bem-sucedida para este modelo.

O último ensaio conservou apenas indicadores derivados de palavras do erro: quota/limitação e indisponibilidade temporária, sem indicadores de pagamento ou política de dados e sem headers numéricos de reset. Estes indicadores não comprovam a causa exata nem uma hora de reposição. Não se conservaram mensagens brutas, prompts, chaves ou texto de resposta. A presença/uptime no catálogo público não foi promovida a prova de inferência. Não haverá repetição automática, rotação de chave ou substituição de modelo; nova geração requer revalidação de uma mudança de disponibilidade/quota.

O incremento fez duas mutações de Secret Manager (criação do secret/versão), três leituras de payload em memória e cinco consultas de metadata de chave. Os três POST generativos usaram apenas a variante gratuita com tetos zero e entrada sintética. Zero pedidos a modelos pagos, dados de utilizadores, alterações de faturação, retries automáticos, rotação de chave, IAM ou deploys.

Os testes do adaptador exercitam adulteração do modelo, router/array, prompt/tokens, custo ausente/não zero, resposta inesperada, ferramentas e erros 402/429/503 com uma só tentativa. A integração HTTP usa Auth e fornecedor sintéticos com Firestore real em emulador para verificar admissão atómica, orçamento e telemetria sem conteúdo; os testes de cliente verificam consentimento, cancelamento, `never-cloud`, conta/âmbito capturados e imagem recusada sem rede. Os resultados gerais e o build ficam vinculados na prova privada deste incremento; não substituem a disponibilidade real recusada por 429.

O audit atualizado encontrou dependências HTTP vulneráveis no backend. A [correção das dependências](DEPENDENCIAS_HTTP_NODE22_2026-10-25.md) e os testes com HTTP malformado fazem parte deste incremento. O transporte passou a usar fetch de undici 7.30.1 explicitamente, pois o embutido no Node local também reproduziu a falha. A terceira tentativa real usa este transporte e o parâmetro SecretParam em processo privado; não valida o binding de uma Function publicada. A primeira suite integral identificou uma fixture que pressupunha NVIDIA ativa; passou a declarar a configuração futura e a testar OpenRouter com a política real. A aplicação não foi alterada para satisfazer essa pressuposição antiga.

| Validação executada em Node 22.23.3 | Resultado final |
|---|---|
| Frontend: node node_modules/vitest/vitest.mjs run, reporter JSON, em frontend | 1.790 testes/212 ficheiros, zero falhas/omissões |
| Frontend: npm run build, em frontend | TypeScript/Vite passaram; 12 downloads/feed legado conservados |
| Frontend: npm run lint, em frontend | Zero erros/23 avisos existentes; oito ficheiros do âmbito com um aviso existente nas Definições |
| Functions: npm test, em functions, depois da correção de transporte | 580 aprovados; uma omissão prevista de Rules fora do emulador |
| node scripts/run-rules-tests.js, JDK 21/Firebase CLI 15.34.0 | 316 Functions/Rules +23 frontend, zero falhas/omissões; emuladores encerrados normalmente |
| node --test nos quatro ficheiros de transporte/adaptadores | 26 aprovados, incluindo três processos isolados |
| npm audit --omit=dev --json nos dois packages | Zero vulnerabilidades de produção reportadas depois da correção |

Os fontes/pacotes consumidos pelo frontend foram conservados depois da sua passagem; só transporte, dependências e fixtures backend mudaram, com repetição das suites Functions/Rules. A prova encadeada fica em `W:/real/mnemosyne-launch-evidence/openrouter-free-local-validation-20261025.json`. A primeira execução frontend sem resultado terminal comprovado e a primeira falha da fixture de Rules são conservadas, sem serem contadas como passagens. Não houve build novo dos instaladores Windows/APK ou execução remota de CI neste incremento.

O scanner redigido produziu seis correspondências no exame amplo de fontes, provas e JavaScript compilado: três nonces de idempotência de teste (incluindo duas cópias anteriores), duas expressões de construção de vocabulário da biblioteca Transformers e a configuração pública Firebase do cliente. As ocorrências foram classificadas individualmente, sem expor valores ou desativar regras globais. O nonce recebeu uma anotação local justificada; a comparação de AST sem comentários comprovou que os testes executados não mudaram. Uma verificação final dos ficheiros do produto conserva os alertas de artefactos públicos e a sua classificação, sem os apresentar como uma execução bruta sem alertas.

A chave do cliente coincidiu com a configuração devolvida pela Firebase para a Web App de mnemosyne-one; o UID associado permitiu consultar as restrições sem pedir valores de chaves privadas. Foram confirmadas restrições de APIs/referrer e ausência de Generative Language API na allowlist. A [documentação Firebase](https://firebase.google.com/docs/projects/api-keys) distingue esta configuração pública das credenciais de fornecedores. Não se alteraram restrições, App Check ou quotas, nem se declararam esses requisitos globais encerrados. O exame não encontrou credenciais inesperadas de fornecedores; as chaves novas não entram no frontend.

As fases 0–6, revisão integral/CI remota, pilotos Windows/Android e os restantes requisitos operacionais continuam exigidos. Os 49 gates não foram abertos; este incremento não autoriza publicar um produto incompleto.
