# Geração HTTP regional e prazos de resposta

## Problema observado no código

O cliente enviava texto e imagem pelo Firebase Hosting. A função de imagem e o adaptador admitiam 120 segundos, mas o [Hosting termina pedidos aos 60 segundos](https://firebase.google.com/docs/hosting/functions?hl=en), mesmo que a Function tenha um timeout maior. A documentação de [limites de Hosting com Functions/Cloud Run](https://firebase.google.com/docs/hosting/serverless-overview?hl=en) confirma a mesma restrição.

Foi ainda encontrada uma configuração local VITE_API_URL de loopback, herdada pelo percurso de geração. Esse destino não corresponde ao backend Firebase regional do lançamento. O valor e os restantes ficheiros .env foram preservados; não foram copiados ou mostrados valores privados.

Estes factos não explicam o [timeout anterior da NVIDIA](NVIDIA_VALIDACAO_OPERACIONAL_2026-10-22.md): aquele ensaio chamou o fornecedor diretamente e não passou pelo Hosting. Não se repetiu o pedido generativo nem se declarou o serviço de imagem disponível.

## Alteração

Texto e imagem passam a chamar `generateText` e `generateImage` diretamente em `europe-west1-<projectId>.cloudfunctions.net`. O projeto acompanha VITE_FIREBASE_PROJECT_ID, com o mesmo default mnemosyne-one do cliente Firebase. Não se pode introduzir outro host, credenciais, path ou query através do identificador de projeto. As rotas Hosting existentes permanecem para clientes anteriores; não adquirem um timeout maior.

VITE_API_URL deixa de escolher o destino da geração. Para desenvolvimento com Functions Emulator, usa-se VITE_FIREBASE_FUNCTIONS_EMULATOR_ORIGIN numa configuração apenas de desenvolvimento, por exemplo `.env.development.local`, e um projeto coerente com os restantes emuladores. O valor tem de ser uma origem loopback, sem path, query, hash ou credenciais. A configuração de build recusa emuladores antes de escrever os manifestos de versão. Não há fallback automático para o projeto público quando um emulador é inválido.

| Operação | Teto do fornecedor | Function | Cliente |
| --- | ---: | ---: | ---: |
| Texto | 30 s | 60 s | 75 s |
| Imagem | 120 s | 150 s | 180 s |

Os prazos são partilhados num contrato público sem SDKs/env/secrets. A margem da Function permite concluir verificações, circuit breaker e resposta depois do deadline do fornecedor. A margem cliente inclui rede; não garante disponibilidade ou latência do serviço. As [Functions de primeira geração admitem até 540 segundos](https://firebase.google.com/docs/functions/1st-gen/manage-functions-1st), pelo que a configuração candidata de 150 segundos está nesse limite. Não foi aplicada ao runtime publicado.

O transporte cliente cobre a preparação dos headers, espera por headers e leitura/descodificação do corpo. Recusa redirects, omite cookies/referrer, limita bytes descodificados e não repete pedidos. O limite lógico é 1 MiB para texto e 17 MiB para o envelope de imagem; não mede a heap total nem altera os limites de resposta da infraestrutura. Falhas não incluem prompt, credencial, URL ou corpo do fornecedor. Um HTTP status é conservado num erro próprio.

Mantêm-se consentimento/never-cloud, UID/epoch/equipa capturados, validação de acesso depois da geração, allowlist de modelos, quotas/circuit breaker, binding NVIDIA atual e gravação cifrada de anexos. A alteração não ativa Hugging Face/Gemini/OpenAI, não altera preços, não troca de modelo e não fornece retry/fallback de fornecedor. O contrato [oficial FLUX.1-schnell](https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_1-schnell-infer) continua a corresponder à URL e aos parâmetros do adaptador; não foi inventado um protocolo de polling para o timeout anterior.

## Validação local

- **70 testes frontend em seis ficheiros**, sem omissões: transporte, resolução de endpoint, contexto/revogação, políticas de cloud, configuração e integração do input. TypeScript e lint dos oito ficheiros frontend passaram, sem erros/avisos. Mensagens JSDOM de scrollTo não implementado foram conservadas no log; não são um ensaio de dispositivos reais.
- **32 testes Functions focados**, sem omissões, incluindo o novo contrato HTTP, modelos/fornecedores, resposta e transporte limitados e Gemini simulado. Compilação Functions passou. Os adaptadores mantêm os seus parâmetros/deadlines anteriores de fornecedor; a Function de imagem ganha margem para terminar.
- Chromium com fetch, dois servidores locais de origens distintas e CORS real. Houve nove preflights e nove POST, todos com Bearer sintético, zero cookies e zero seguimentos de redirect. A resposta sintética demorada chegou em **62.006 ms**, usando o deadline cliente de produção de 180.000 ms. Não se alongou o deadline para fazer o caso passar.
- Recusadas respostas sem headers, corpo bloqueado, redirect, tamanho declarado/stream acima do limite e gzip cujo corpo descodificado excede o limite. Os casos de falha usam limites sintéticos inferiores; o caso de 62 segundos usa a política real. Cancelamento por contexto fecha a leitura. Um erro HTTP conserva o status sem copiar o corpo.
- A primeira passagem do ensaio chegou ao fim da resposta longa mas falhou o assert de preflight com a interceção global Playwright ativa. A passagem final usa tráfego permitido sem interceção e um proxy local que nunca encaminha destinos externos. Os nove preflights foram então observados no servidor. O primeiro log foi conservado.
- O preflight real de Vite recusou um emulador num build de produção, antes de alterar public/version.json ou dist/version.json, e restaurou a variável do processo. A configuração CSP Tauri já admite o domínio cloudfunctions.net; não houve alteração dessa política ou piloto nativo.

O comando reproduzível é `node scripts/generation-http-browser.cjs`. A configuração CI passa a exigi-lo depois da instalação Chromium. Isto não comprova execução remota. A primeira espera longa não foi reiniciada por timeout de observação da ferramenta; cada execução foi acompanhada pelo respetivo processo.

O ensaio usa identidade, autorização e resposta sintéticas. Não valida JWTs Firebase reais, IAM/bindings publicados, Auth/App Check de cada plataforma, Hosting/proxy de produção, quotas cobradas ou geração real de imagem. O build frontend é registado separadamente. As suites gerais, Rules e audits anteriores não foram repetidos neste incremento; dependências não mudaram.

## Rollout e pendências

O rollout completo deve publicar Functions e cliente coerentes. A Function candidata de imagem passa de 120 para 150 segundos; contas/modelos/custos e secrets mantêm a política existente. Clientes antigos que usam Hosting continuam sujeitos ao limite de 60 segundos. Os APK/instaladores anteriores não foram recompilados nesta alteração web.

Evidência privada em `W:/real/mnemosyne-launch-evidence/generation-http-validation-20261024/`, prova `generation-http-local-validation-20261024.json`, encadeada a search-deltas-local-validation-20261024.json. **49 gates continuam fechados; todas as áreas das fases 0–6 continuam exigidas antes do deploy completo autorizado.** Zero mutações de produção, leituras de payloads de secrets e pedidos generativos neste incremento.
