# Autenticação NVIDIA e Hugging Face — 20 de outubro de 2026

As credenciais fornecidas pelo operador permanecem na versão **1 ENABLED** dos secrets `NVIDIA_API_KEY` e `HUGGINGFACE_API_KEY` em `mnemosyne-one`. A NVIDIA é a substituta cuja revogação anterior o operador confirmou. Esta leitura não comprova de forma independente a revogação de todas as credenciais históricas.

## Verificação realizada

Foi confirmada a associação do projeto ativo e lida, em memória, apenas a versão 1 de cada secret. Nome de recurso e CRC32C foram verificados antes do uso. As respostas completas do Secret Manager e dos fornecedores, os valores, identificadores da conta e emails não foram gravados ou mostrados. Os buffers foram limpos após uso; strings JavaScript em memória não têm apagamento garantido.

Foram feitos cinco pedidos GET a origens HTTPS fixas, com redirects recusados e timeout:

| Fornecedor/pedido | Sem credencial | Com a substituta | Resultado delimitado |
| --- | --- | --- | --- |
| NVIDIA, catálogo `/v1/models` | 200 | Não necessário | Catálogo público; não demonstra uma chave válida |
| NVIDIA Cloud Functions, lista `/v2/nvcf/functions` | 401 | 200, schema de lista reconhecido | Credencial aceite para essa leitura autenticada |
| Hugging Face, `/api/whoami-v2` | 401 | 200, identidade/token reconhecidos | Credencial aceite para essa leitura autenticada |

O pedido NVIDIA segue o [contrato de descoberta de funções](https://docs.nvidia.com/nvcf/dev/overview/api); o contrato Hugging Face está descrito na [API do Hub](https://huggingface.co/docs/hub/en/api). Uma leitura autenticada não prova acesso a todas as operações ou modelos.

**Contagem:** dois acessos a payloads autorizados, cinco GET a fornecedores, zero pedidos generativos, zero conteúdo de memórias enviado, zero cópias de credenciais em ficheiros, zero alterações de recursos de produção e zero deploys. Os acessos de leitura podem gerar os registos de auditoria normais dos serviços.

## Pendências do lançamento

Continuam por validar a inferência dos modelos efetivamente selecionados, as permissões e quotas específicas, respostas/tamanhos/imagens, contratos e disponibilidade dos endpoints, custo observado, bindings e IAM das Functions e alertas operacionais. O catálogo público não substitui esse ensaio. Os adaptadores atuais de imagem HF e o routing `:cheapest` exigem revisão explícita de compatibilidade, fornecedor efetivo e consentimento antes do rollout; não foram alterados nem aprovados por esta consulta.

Na última consulta de metadata dos secrets, OpenAI e os dois secrets Stripe continuavam ausentes. Não foram importadas as entradas Stripe antigas de dotenv nem ativada faturação. Todas as fases 0–6 e a verificação global continuam exigidas antes do deploy completo autorizado.

Evidência: `W:/real/mnemosyne-launch-evidence/provider-authentication-readback-20261020/`. Prova consolidada: `W:/real/mnemosyne-launch-evidence/provider-authentication-operational-validation-20261020.json`, ligada à prova de preparação desktop `33694b7c821c5358d029f6fe1fd276a3f4d290652acc425c7c25b70f8f1a1c85`. A consulta não reexecuta suites de produto nem verifica o checkout inteiro.
