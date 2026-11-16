# Validação operacional NVIDIA — 22 de outubro de 2026

## Atualização: novas credenciais e Ultra validado no adaptador

O operador acrescentou três exemplos NVIDIA a `AUDITORIA_CHAVES_FIREBASE.md`, com duas credenciais distintas. A primeira é partilhada por Nemotron 3 Ultra e GPT-OSS 20B; a segunda pertence ao exemplo Gemma. São modelos alojados pela NVIDIA: o cliente Python OpenAI não representa uma chave da conta OpenAI. Os valores não foram publicados nos resultados.

| Pedido sintético atual | Resultado |
| --- | --- |
| Direto: `nvidia/nemotron-3-ultra-550b-a55b`, 64 tokens | HTTP 200 em 1.043 ms, texto e identidade do modelo verificados |
| Direto: `openai/gpt-oss-20b`, 256 tokens | Deadline de 30 segundos, sem resposta validada |
| Direto: `google/gemma-4-31b-it`, 64 tokens, segunda credencial | Deadline de 30 segundos, sem resposta validada |
| Adaptador anterior com a nova credencial: Super 120B | HTTP 404, `function_not_found_for_account`, 278 ms |
| Adaptador anterior com a nova credencial: FLUX.1-schnell | Deadline de 120.012 ms, sem status HTTP recebido |
| Adaptador candidato com a nova credencial: Ultra 550B | HTTP 200 em 1.059 ms, texto, modelo e fornecedor verificados |

A primeira credencial está em `NVIDIA_API_KEY`, versão 2. A segunda foi conservada em `NVIDIA_GEMMA_API_KEY`, versão 1, com réplica `europe-west1`, sem declaração/binding na aplicação. Ambas foram relidas em memória com CRC32C e comparação dos bytes antes de retirar os valores do documento. A versão NVIDIA anterior foi conservada; não se alega revogação das credenciais antigas nem limpeza de históricos/cópias. Foram três mutações de Secret Manager: uma criação de secret e duas adições de versão, zero alterações IAM e zero deploys. Neste incremento completo houve cinco leituras de payload e seis pedidos generativos, sem retries/fallback ou conteúdo real de utilizadores.

### Decisão de modelo e limites

O novo ID explícito `nvidia-nemotron-ultra` identifica exclusivamente `nvidia/nemotron-3-ultra-550b-a55b`. Tem teto de 900 tokens e reserva de quatro unidades relativas por pedido, conservando os limites mensais e atómicos existentes. As quatro unidades são uma reserva interna conservadora, não um preço observado da NVIDIA. O [contrato oficial Nemotron Ultra](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/modelcard) admite desativar raciocínio; o adaptador usa `enable_thinking:false`, temperatura 1 e `top_p:0.95`, sem streaming.

O seletor oferece Ultra para nova seleção NVIDIA. Configurações vazias usam o novo ID; uma seleção Super guardada continua a representar Super e requer escolha explícita de Ultra. Não se alteram os IDs antigos para outro modelo e não existe tentativa automática de Ultra depois de falhar Super. GPT-OSS e Gemma não foram acrescentados à allowlist nem ao seletor. As políticas `never-cloud`/consentimento continuam aplicadas antes do pedido.

O ensaio do adaptador injeta o valor de SecretParam só no processo privado e transpila a fonte candidata em memória. Não valida IAM/bindings publicados, Auth real, quotas de produção, imagens, disponibilidade contínua ou toda a fase 2. A validação direta anterior é distinta do ensaio do adaptador. Os relatórios conservam os dois âmbitos em `W:/real/mnemosyne-launch-evidence/nvidia-document-intake-20261022/`. Nenhum gate foi aberto; as fases 0–6 continuam exigidas.

### Validação local do incremento

Passaram 27 testes focados Functions, 46 testes frontend em quatro ficheiros e três cenários HTTP/Firestore/Storage no emulador, sem omissões nos conjuntos executados. Estes últimos verificam encaminhamento, parâmetros Ultra, reserva de custo, recusa de fornecedores inativos e revogação durante geração. Os pedidos a fornecedores são simulados nesses testes; os dois resultados Ultra HTTP 200 da tabela acima são os ensaios reais separados.

Passaram o build/TypeScript de Functions, o build/TypeScript frontend e o lint dos cinco ficheiros frontend alterados, com zero erros/avisos de lint. O build frontend conserva o aviso de chunks acima de 1.000 kB. A primeira tentativa de emuladores parou por porta Storage 9199 ocupada, sem executar os testes; a passagem final usou portas isoladas e conservou código, asserts e timeouts. A configuração do repositório não foi alterada para isso. As suites gerais, as restantes regras e CI remoto não foram repetidos.

## Ensaio anterior com NVIDIA_API_KEY v1

No ensaio anterior, a inferência real não passou. Os resultados seguintes são históricos e usam a versão 1, antes das novas credenciais acima. Gemini e Hugging Face permanecem inativos com regularização de créditos adiada pelo operador; OpenAI foi excluído dos requisitos deste lançamento. Não houve deploy nem alteração dos gates.

| Verificação | Resultado observado |
|---|---|
| Projeto | `mnemosyne-one`, número `960796327752`, associação verificada |
| Secret NVIDIA | Versão 1 habilitada; uma leitura autorizada em memória, CRC32C verificado |
| Catálogo | GET 200, 83 modelos; modelo de texto selecionado presente |
| Texto | POST `/v1/chat/completions`, `nvidia/nemotron-3-super-120b-a12b`, até 64 tokens; 404 em 299 ms, categoria fixa `function_not_found_for_account` |
| Imagem | POST `/v1/genai/black-forest-labs/flux.1-schnell`, 1024×1024, quatro passos; deadline em 120.007 ms, sem status HTTP recebido |
| Stripe | Consulta de metadata confirma `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` ausentes; nenhum payload lido nessa consulta |
| Runtime publicado | Bindings ainda não correspondem à configuração candidata; smoke de produção não executado |

O ensaio começou às 18:17:34 UTC e terminou às 18:19:37 UTC. Foram dois pedidos generativos com prompts sintéticos fixos, um GET de catálogo e uma leitura de payload de secret. Zero retries, fallback, mutações de produção ou deploys. Valores de credenciais, corpos de erro, identidades de conta e conteúdo gerado não foram guardados. O catálogo público não prova autenticação por si só.

## Relação com o código validado

O executor transpila os adaptadores privados atuais de `webApi.ts` em memória, conservando o transporte e a validação de resposta do produto. Conferiu hashes de seis fontes contra a prova anterior da reversão, SHA256 `a5598f2a7531b777b9b0e6411bda58217ac470e4fcb5e8c62e03c1e76c89daee`.

O parâmetro SecretParam recebe o valor apenas no processo privado de ensaio. Isso permite testar a chamada ao fornecedor; não verifica os bindings ou IAM do runtime Functions publicado. Nenhuma fonte de produção foi alterada para o ensaio. Não foi repetida a suite de produto para esta consulta operacional.

Evidência privada:

- `W:/real/mnemosyne-launch-evidence/nvidia-live-validation-20261022/adapter-probe.json` — resultados e hashes dos seis adaptadores/contratos.
- `W:/real/mnemosyne-launch-evidence/nvidia-live-validation-20261022/secret-metadata.json` — metadata de secrets/bindings, sem payloads.
- `W:/real/mnemosyne-launch-tools/probe-nvidia-adapters-20261022.cjs` — executor do ensaio.

## Próximo passo operacional

Foi pedida ao operador a verificação do acesso da chave e da organização NVIDIA ao serviço/modelo escolhido. O 404 observado não demonstra isoladamente qual a restrição da conta. O deadline da imagem também não identifica a causa. Conservar a chave e os resultados; repetir geração apenas depois de uma mudança de estado confirmada. Não trocar silenciosamente de fornecedor/modelo para contornar o resultado.

Para diagnóstico com a NVIDIA, o texto seguinte está preparado para revisão. **Não foi enviado**:

> No hosted API, o pedido de texto para `nvidia/nemotron-3-super-120b-a12b`, em 22/10/2026 às 18:17:37 UTC, devolveu HTTP 404 com a indicação “function not found for account”. O modelo aparece no catálogo GET `/v1/models` (200). O endpoint de imagem FLUX.1-schnell atingiu o deadline do cliente de 120 segundos, sem status HTTP recebido. Podem confirmar o acesso da conta/organização aos dois modelos e indicar o próximo diagnóstico? Não anexamos credenciais nem conteúdo de utilizadores.

O lançamento completo continua a exigir os restantes critérios das fases 0–6: dados/migrações, alertas, CI remoto, plataformas e pilotos. Esta consulta não abre nenhum gate.
