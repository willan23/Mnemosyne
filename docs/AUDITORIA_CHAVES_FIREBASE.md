# Auditoria de metadata das chaves Firebase

## Continuação de 21 de outubro de 2026

Resource Manager confirmou `960796327752` como número de `mnemosyne-one`. A API Gemini e IAM estavam habilitadas, e a API Keys API estava desativada. O operador autorizou explicitamente a ativação de `apikeys.googleapis.com`; o pedido terminou e a releitura confirmou `ENABLED`.

A repetição do executor de metadata terminou com sucesso: **uma app web ativa e duas chaves não eliminadas**. O UID da chave associada à app foi encontrado na listagem e as APIs explicitamente permitidas dessa chave **excluem Generative Language API/Gemini**. A chave pública tem restrições de browser. A outra chave não eliminada é específica de Gemini; uma chave Gemini antiga aparece como eliminada na consulta separada que incluiu esse estado.

Este executor não leu valores de chaves nem configuração SDK. A associação do UID ao valor incluído no bundle, os padrões de referrer, a eficácia das restrições e a compatibilidade web/desktop/Android continuam por validar. Não se apresentam propriedades de metadata como testes dos clientes. Os possíveis segredos históricos e a revogação de todas as credenciais antigas continuam fora desta conclusão.

Evidência atual: `W:/real/mnemosyne-launch-evidence/gemini-project-metadata-20261021/firebase-key-metadata.json`. A preparação separada da integração Gemini leu exclusivamente o `keyString` da chave Gemini identificada para transferi-la para Secret Manager; essa leitura não pertence ao executor de metadata Firebase. Nenhuma chave Firebase foi alterada e não houve deploy.

## Consulta de 18 de outubro de 2026

O executor local vinculou explicitamente `mnemosyne-one` ao número do projeto devolvido por Resource Manager e consultou a metadata das apps Firebase. Identificou uma app web ativa e o UID da chave associada. Não descarregou a configuração da app, não leu valores de chaves, não chamou `getKeyString`/`lookupKey` e não alterou produção.

A listagem de metadata em API Keys API devolveu **HTTP 403, reason `SERVICE_DISABLED`**. A resposta indisponível não é uma lista vazia, nem prova que a chave esteja restringida ou que admita Gemini. A correspondência entre o UID da app registada e o valor usado no artefacto cliente também não foi certificada por esta consulta.

Evidência privada: `W:/real/mnemosyne-launch-evidence/firebase-key-restrictions-20261018/metadata-diagnostics.json`. Inclui os endpoints GET, status e reason normalizado; não guarda mensagens remotas arbitrárias ou credenciais. O primeiro resultado e os logs anteriores foram conservados. Não se ativou uma API para contornar a recusa.

## Critério ainda pendente

No rollout autorizado, disponibilizar a API de metadata e a permissão de listagem ao operador, repetir a consulta e vincular cada UID de app às restrições da chave. Validar separadamente APIs permitidas, limitações de aplicação/plataforma e compatibilidade dos clientes. Alterações de restrições exigem teste antes de afetar a chave de produção.

As chaves de configuração Firebase são públicas por desenho; a sua presença no cliente não comprova, por si só, fuga de uma credencial de fornecedor. A documentação recomenda APIs específicas para chaves públicas e exclui expressamente Gemini Developer API das suas allowlists. Uma chave sem restrições de API não satisfaz esse critério. Estas propriedades continuam **por verificar neste projeto**. [Gestão de chaves Firebase](https://firebase.google.com/docs/projects/api-keys).

As APIs oficiais permitem identificar a associação por UID e listar restrições sem obter a string da chave. [Metadata das apps](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/searchApps), [listagem de chaves](https://docs.cloud.google.com/api-keys/docs/reference/rest/v2/projects.locations.keys/list).

Esta consulta não resolve os sete possíveis segredos históricos encontrados pelo scanner, não comprova revogação no fornecedor e não substitui a migração para Secrets de Functions. O lançamento completo permanece condicionado aos critérios das fases 0–6.


## Credenciais NVIDIA recebidas em 22 de outubro de 2026

Os três exemplos acrescentados eram de modelos alojados pela NVIDIA. A biblioteca OpenAI era usada apenas como cliente do protocolo; não foi recebida uma chave da conta OpenAI.

| Modelo indicado | Resultado do pedido sintético | Referência segura |
| --- | --- | --- |
| nvidia/nemotron-3-ultra-550b-a55b | HTTP 200, resposta de texto e identidade do modelo verificadas | NVIDIA_API_KEY, versão 2 |
| openai/gpt-oss-20b | Deadline de 30 segundos; sem resposta validada | A mesma credencial de NVIDIA_API_KEY |
| google/gemma-4-31b-it | Deadline de 30 segundos; sem resposta validada | NVIDIA_GEMMA_API_KEY, versão 1; conservada sem binding na aplicação |

As duas credenciais distintas foram transferidas diretamente em memória para o Secret Manager de mnemosyne-one e relidas com CRC32C e comparação em memória. Os valores foram retirados deste documento após a confirmação. Nenhuma versão antiga foi revogada ou desativada por esta operação.

Os resultados são diagnósticos diretos com prompts sintéticos. Não demonstram os bindings de Functions publicados, o funcionamento do modelo selecionado na aplicação ou a geração de imagem. Não houve deploy nem abertura dos gates de lançamento.

Na validação seguinte, o adaptador candidato passou com Ultra (HTTP 200 e modelo/texto verificados). Foi acrescentado o ID explícito `nvidia-nemotron-ultra` ao servidor e ao seletor. Super continuou a devolver 404 e a imagem atingiu 120 segundos; não existe fallback automático. Ver [resultados, decisões e limites](NVIDIA_VALIDACAO_OPERACIONAL_2026-10-22.md).

Para futuras alterações, usar os secrets do projeto. Não acrescentar chaves a documentos ou código. O valor anterior permanece nos eventuais históricos/cópias já existentes; a limpeza deste ficheiro não prova a sua remoção dessas cópias.

## Novas credenciais recebidas em 23 de outubro de 2026

| Modelo NVIDIA | Pedido sintético de texto | Referência segura |
| --- | --- | --- |
| nvidia/nemotron-3-nano-omni-30b-a3b-reasoning | HTTP 200, palavra solicitada e modelo verificados, 459 ms | NVIDIA_NEMOTRON_OMNI_API_KEY v1 |
| google/diffusiongemma-26b-a4b-it | HTTP 200, modelo identificado, sem texto utilizável no contrato testado, 2.655 ms | NVIDIA_DIFFUSION_GEMMA_API_KEY v1 |

As duas credenciais distintas foram transferidas diretamente em memória para o Secret Manager de mnemosyne-one, com réplica europe-west1, e relidas com CRC32C e comparação dos bytes. Só depois foram retiradas deste documento. Não foram copiadas para logs ou backups em claro.

Ambos os exemplos são modelos alojados na NVIDIA com saída de texto. Foram testados apenas prompts sintéticos de texto, sem imagens, áudio, vídeo, memórias ou ferramentas. As capacidades multimodais não foram ensaiadas. O resultado vazio de DiffusionGemma não é uma validação do seu contrato de geração.

Os dois secrets ficam conservados sem declaração/binding na aplicação. O modelo candidato Ultra e NVIDIA_API_KEY v2 mantêm-se configurados como antes; não houve troca automática, alteração de IAM, revogação de versões ou deploy. Os novos modelos ainda não estão no seletor/allowlist. O suporte a idiomas, contratos e limites deve ser revisto antes dessa integração explícita.

A documentação oficial do Omni identifica saída de texto e a opção enable_thinking:false: https://build.nvidia.com/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning/modelcard . A ficha DiffusionGemma também identifica saída de texto: https://docs.api.nvidia.com/nim/reference/diffusiongemma-26b-a4b-it .

A limpeza deste ficheiro não prova a eliminação de cópias ou históricos anteriores. Para novas credenciais, usar diretamente o Secret Manager.
