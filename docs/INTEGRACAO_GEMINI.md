# Integração Gemini — 21 de outubro de 2026

## Atualização operacional — autenticação resolvida

A API de gestão de chaves foi ativada com autorização explícita em `mnemosyne-one` (`960796327752`). A consulta encontrou uma única chave Gemini recém-criada não eliminada, limitada à Generative Language API, com conta de serviço não desativada. O seu valor foi lido diretamente na Google para concluir a configuração pedida, sem o mostrar, copiar para ficheiro ou colocar em argumentos. A comparação em memória confirmou que a entrada local era diferente.

A chave real passou a listagem de modelos com HTTP 200. Foi transferida diretamente para `GEMINI_API_KEY`, versão 1 `ENABLED`, com replicação em `europe-west1`, checksum enviado à API e releitura da metadata. Só depois foi removida a entrada Gemini do `.env`, conservando as restantes linhas. Uma leitura de `keyString`, dois pedidos de mutação Secret Manager; nenhuma alteração IAM ou deploy.

O ensaio real do adaptador, já com o payload Secret Manager e CRC32C verificado, recebeu 200 na metadata dos dois modelos e **402 na geração de texto e imagem**. Foram duas tentativas sintéticas, sem retries, fallback, conteúdo real ou saída persistida. A Google descreve 402 como suspensão por créditos Prepay, que afeta todos os modelos ligados à conta. O operador adiou a regularização. Não se repetiu a tentativa com 2.5 após essa confirmação documental. Gemini permanece inativo até a geração real ser validada. [Faturação e suspensão por créditos](https://ai.google.dev/gemini-api/docs/billing).

As secções seguintes preservam a implementação e a cronologia das entradas locais recusadas antes da leitura da chave correta. Não representam um novo erro de autenticação da versão guardada no Secret Manager.

## Contrato preparado

O operador pediu acrescentar Gemini e continuar NVIDIA, deixando Hugging Face dependente da regularização dos erros 402. O adaptador Gemini está preparado no servidor para texto e imagem, usando o SDK oficial `@google/genai` **2.30.0**. O SDK antigo `@google/generative-ai`, que já não tinha imports nas fontes, foi retirado. A instalação com scripts desativados e a auditoria npm resultaram em zero vulnerabilidades conhecidas.

Os IDs controlados pelo servidor são `gemini-flash` e `gemini-image`, com candidatos estáveis `gemini-3.5-flash-lite` e `gemini-3.1-flash-image` consultados na [documentação de modelos](https://ai.google.dev/gemini-api/docs/models). São candidatos por validar com a conta efetiva. O pedido não aceita modelo livre, URL/base alternativa, ferramentas, uploads, grounding, código executável ou função chamada pelo modelo. Não existe fallback para Gemini quando NVIDIA falha, nem troca entre fornecedores por falha de credencial.

`GEMINI_API_KEY` pertence ao Secret Manager/runtime. Não se usam variáveis Vite nem chaves pessoais antigas do dispositivo. A política pública partilhada mantém Gemini inativo e sem `defineSecret` obrigatório até a configuração ser validada. O seletor conserva uma escolha Gemini guardada, mostra a indisponibilidade e não muda o fornecedor automaticamente. A remoção de uma chave local antiga permanece possível.

## Transporte, privacidade e custo

O SDK usa um `fetch` próprio que só permite o endpoint HTTPS exato do modelo selecionado no Google Generative Language API. Recusa query-key URLs e métodos inesperados. Esse hook chama o transporte já limitado: sem redirects, deadline incluindo o corpo, 1 MiB para texto/16 MiB para imagem, erros fixos sem corpo upstream. Existe uma tentativa por operação, sem retries SDK. Uma rejeição de segurança é tratada como rejeição do pedido e não abre o circuito para todos os utilizadores.

As respostas devem reportar o modelo selecionado e um único candidato permitido. Texto de pensamento é excluído. Chamadas de ferramentas, referências de ficheiros e código são recusadas. A imagem tem de conter uma única imagem inline, base64 canónico, MIME coerente com os bytes e dimensões 1024×1024. Não se seguem URLs fornecidas pelo modelo. A inspeção de assinatura/cabeçalho não constitui descodificação integral de imagem.

Gemini utiliza o mesmo consentimento, contexto de conta/equipa, admissão, quota atómica, circuitos e observabilidade sem conteúdo dos restantes adaptadores. O consentimento identifica Google Gemini. Os limites técnicos de pedidos/bytes/tokens/custo mensal mantêm-se; os modelos básicos NVIDIA/Gemini entram na allowlist técnica de texto dos planos gratuitos, quando ativos. As unidades relativas não são apresentadas como preços ou faturação real. Não foi ativado Stripe nem alterado preço algum.

## Verificação real da credencial fornecida

A entrada foi localizada apenas em `W:/real/Mnemosyne/functions/.env`, com o nome `GEMINI_API_KEY`; o valor nunca foi mostrado, copiado para relatório ou incluído em argumentos de processo. O Secret Manager de `mnemosyne-one` ainda não tinha esse nome. O procedimento de intake exige autenticação do fornecedor antes de criar secret/versão e só retira a entrada do ficheiro depois de uma versão habilitada confirmada.

O primeiro filtro local assumia o formato tradicional de chave Google. Foi substituído por validação de token opaco e verificação no fornecedor, compatível com a evolução dos [tipos de chave Google](https://ai.google.dev/gemini-api/docs/api-key). A listagem real de modelos respondeu **400 / `API_KEY_INVALID`** antes e depois da alteração do `.env` confirmada pelo operador. O SDK oficial confirmou HTTP 400 na mesma operação, com a chave no header e sem modelo selecionado. Nenhuma destas chamadas usou Gemini 1.5 ou executou inferência.

Para investigar a hipótese de uma chave Vertex/versão 2.5, foi efetuado também `countTokens` com um texto sintético e `gemini-2.5-flash` no endpoint oficial Vertex Express. Respondeu **401**, sem autenticação validada. Esse teste não ativou Vertex nem mudou o backend configurado. O nome 2.5 não explica a recusa na listagem, que não seleciona modelo; a disponibilização de um modelo concreto só pode ser verificada depois da autenticação.

**Nenhum secret Gemini foi criado e nenhum valor foi removido do `.env`.** Não se fizeram mutações de produção, IAM ou deploy nesta tentativa. O operador foi informado dos resultados e questionado sobre a origem da chave. Uma entrada recusada continua a ser tratada como credencial, não como texto público.

## Validação e pendências

Os oito testes do adaptador usam o SDK real com transporte simulado: header/endpoint, limites de saída, ausência de ferramentas, ausência de retry, erros sem conteúdo, resposta inesperada, segurança, bytes/MIME/dimensões e recusa de URLs/redirects/tamanho excessivo. A configuração futura dos fornecedores é testada em processos separados com os `SecretParam` e descriptors reais Firebase. O modo atual recusa os fornecedores inativos antes de quota, circuito, secrets ou pedidos de geração.

Passaram 515 testes gerais Functions, com uma omissão prevista fora do emulador, e sete casos HTTP focados com Firestore/Storage. O primeiro ensaio geral teve duas falhas rápidas de sockets de loopback; a suite isolada de transporte passou e os fixtures passaram a fechar explicitamente ligações entre servidores efémeros. A repetição geral ficou verde; a causa exata das primeiras falhas não foi demonstrada. Os logs iniciais foram preservados.

A suite completa de regras anterior (277 servidor +23 cliente) continua a ser evidência histórica; não foi repetida integralmente para este incremento. Os sete casos atuais verificam os percursos HTTP alterados, sem certificar o rollout do produto ou a disponibilidade de fornecedores.

Passaram 1.553 testes frontend em 193 ficheiros, build e lint com zero erros/23 avisos anteriores. A primeira passagem geral teve um timeout no teste de paginação; a repetição isolada dos quatro casos e a repetição geral com um único worker passaram, com o timeout original e sem alterações nesse ficheiro. A causa exata da falha inicial não foi provada. O controlo estático encontrou zero escritas SDK proibidas nas 298 fontes da sua raiz; a política partilhada do servidor é vinculada separadamente. O Gitleaks das 36 fontes alteradas/novas teve um UUID sintético de teste, conservado e classificado sem acrescentar ignores, com zero achados de credenciais por resolver nesse âmbito.

O comando `npm --prefix functions run deploy -- -Project mnemosyne-one` passou a encaminhar para `deploy.ps1`, com contexto explícito e modo não interativo. Nove testes de entradas de publicação passaram. O ensaio real desse comando com `-PreflightOnly` confirmou a interrupção no gate inicial: Node 22 validado, 48 gates fechados, zero comandos de publicação tentados. A falha inicial do teste, executado antes da alteração do comando, foi conservada.

O preflight atual de secrets voltou a consultar apenas metadata: NVIDIA v1 habilitado; os dois secrets Stripe ausentes; três nomes de credenciais presentes no `.env` (Stripe e Gemini). A exigência de geração é apenas NVIDIA, conforme a política ativa. A consulta não leu payloads e não configurou bindings/IAM. A entrada Gemini recusada continua no ficheiro e impede a aprovação da configuração de publicação.

Na NVIDIA, a chave continua a autenticar em NVCF, mas o modelo legado devolveu 410, o candidato atual devolveu 404 no endpoint integrado e uma invocação direta à função ativa devolveu 504. Nenhum ensaio real de geração passou. As capacidades de gestão e os testes simulados não substituem esse critério.

Evidência: `W:/real/mnemosyne-launch-evidence/nvidia-gemini-validation-20261021/` e prova `nvidia-gemini-and-active-providers-local-validation-20261021.json` no diretório de evidência superior, ligada à prova de transporte anterior. A disponibilização Gemini exige credencial aceite, modelo permitido e ensaios sintéticos reais; NVIDIA, dados, alertas, CI, plataformas, Stripe e a auditoria final das fases 0–6 continuam por concluir. Os 48 gates permanecem fechados e não houve deploy.
