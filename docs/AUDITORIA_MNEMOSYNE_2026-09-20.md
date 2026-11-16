# Auditoria completa do Mnemosyne

**Data:** 20 de setembro de 2026  
**Autor:** Manus AI  
**Âmbito analisado:** repositório `W:\real\Mnemosyne`, aplicações web, desktop Tauri, Android Capacitor, Firebase, Cloud Functions, API REST/MCP, IA, sincronização móvel, equipas, anexos, pipelines de entrega e documentação disponível.

## Conclusão executiva

O **Mnemosyne já tem uma base de produto invulgarmente diferenciada**: memória pessoal cifrada no cliente, universo 3D, importação de vault Obsidian, exportação soberana, API/MCP que não expõe texto em claro, equipas com chave simétrica própria e apps web/desktop/mobile. A arquitetura revela preocupação séria com limites, ownership e honestidade de produto. O produto não é um protótipo visual; há funcionalidades persistentes, regras Firebase, testes unitários e uma superfície de integração real.

Ainda assim, **não deve ser posicionado como pronto para dados empresariais sensíveis ou para automação de agentes autónomos** sem fechar os itens P0. O risco dominante não é a falta de funcionalidades. É a diferença entre a promessa de soberania e alguns caminhos técnicos que ainda enviam prompts para a cloud, mantêm chaves de equipa válidas após a saída de um membro, aceitam modelos de IA sem uma política de custo e dependem de componentes com vulnerabilidades conhecidas. Há também uma dívida de escalabilidade: a lógica semântica atual funciona para um cofre pequeno, mas não suporta com segurança a meta documentada de grafos com milhares de nós.

> **Veredicto:** excelente base para um “Cognitive OS” privado de utilizador individual e founder preview. Para tornar o produto vendável com confiança, a prioridade deve ser corrigir privacidade e revogação criptográfica, estabilizar o pipeline de qualidade e substituir o grafo semântico heurístico por uma camada de memória avaliável, escalável e explicável.

| Dimensão | Avaliação | Leitura objetiva |
|---|---:|---|
| Diferenciação de produto | **Forte** | Universo 3D, E2EE, soberania/exportação, Obsidian import e memória conectada formam um posicionamento claro. |
| Segurança de conteúdo pessoal | **Boa, com ressalvas críticas** | Texto/título são cifrados no cliente; embeddings, tags, conexões e metadados permanecem expostos por desenho. |
| Segurança de equipas | **Parcial** | Há wraps por membro e controlo de acesso, mas não existe rotação de chave após revogação. |
| Privacidade de IA | **Insuficiente** | A configuração declara “nunca cloud”, mas fluxos de geração podem cair para backend/cloud sem a fazer cumprir. |
| Qualidade de engenharia | **Média** | Build passa; há testes relevantes; lint e uma suíte unitária falham; regras Firebase não foram executadas por dependência local de Java. |
| Escalabilidade semântica | **Fraca a média** | Pesquisa e enriquecimento iteram no cliente/servidor sobre coleções limitadas ou completas; não há índice híbrido nem avaliação. |
| Preparação comercial enterprise | **Inicial** | Falta SSO/SCIM, recuperação operacional, auditoria completa, governança de IA, DLP e evidência de controlos. |

## Escopo, evidência e limites

A análise foi estática e dinâmica no ambiente local. Foram revistos os manifests, o frontend React, Cloud Functions, regras Firestore/Storage, Tauri, Android, documentação, OpenAPI e CI. Foram também executados build, lint, testes unitários, auditoria `npm audit` e tentativa de testes dos emuladores Firebase. A auditoria não incluiu acesso à consola Firebase, contas de produção, pentest externo, revisão de configurações de IAM, certificados, logs de produção ou verificação de deploys. Portanto, as conclusões sobre produção devem ser tratadas como **riscos a confirmar**, não como prova de exploração.

### Resultado das verificações executadas

| Verificação | Resultado | Evidência e interpretação |
|---|---|---|
| Build do frontend | **Passou** | `tsc -b && vite build` terminou com código 0. A aplicação compila para produção. |
| Lint do frontend | **Falhou** | Existem **5 erros e 29 avisos**. Incluem referência a valores não usados, acesso a refs durante render e expressões regulares inválidas/desnecessárias. O CI deve bloquear estes erros. |
| Testes unitários do frontend | **Falhou** | 198 testes passaram e 1 falhou. `src/utils/export.test.ts` espera o cabeçalho `MEMÓRIA`, mas `formatAsTxt` usa o título fornecido sem incluir a etiqueta. É uma regressão funcional reproduzível na exportação. |
| Testes das Functions | **Passaram na execução agregada** | Foram observados 61 testes aprovados e 1 ignorado na execução das Functions. |
| Testes Firestore/Storage Rules | **Não executados** | O Firebase Emulator requer JDK 21 ou superior; o ambiente local tinha OpenJDK 17. Isto é uma lacuna de ambiente, não prova de falha das rules. |
| Auditoria de dependências frontend | **Crítica** | `npm audit --omit=dev` reportou 17 vulnerabilidades: 2 críticas, 13 altas, 1 moderada e 1 baixa. |
| Auditoria de dependências Functions | **Crítica** | Reportou 15 vulnerabilidades: 1 crítica, 4 altas, 9 moderadas e 1 baixa. |

## Arquitetura observada

O frontend usa React 19, Vite, Three.js, Zustand, Firebase Web SDK e Transformers.js. O desktop usa Tauri 2 e o Android usa Capacitor. O conteúdo de memória é gravado em `sessions` com envelope `enc:{v,iv,ct}`, produzido no cliente com AES-GCM-256. A chave da memória pessoal deriva da mnemónica BIP-39; equipas usam uma `teamKey` separada e guardam no servidor apenas wraps RSA-OAEP por membro.

Firestore é a fonte operacional de documentos e Storage guarda anexos. Cloud Functions em `europe-west1` expõem geração de texto/imagem, pesquisa web, account deletion, API keys, equipas, URL assinada de anexos, API REST e MCP. O backend Python antigo aparece como legado e não integra o caminho de produção atual. A API/MCP persiste apenas envelopes cifrados e metadados; não recebe texto em claro por contrato.

## Pontos fortes confirmados

### 1. Cifragem de conteúdo corretamente colocada no cliente

O fluxo de `memoryCrypto.ts` cifra texto e título antes de os enviar para Firestore; `firestore.rules` exige envelope `enc` nas criações de memórias do cliente. A API pública e o MCP também recusam campos de plaintext e operam sobre envelopes cifrados. Esta separação é coerente com a promessa de o servidor não ler o conteúdo do cofre.

### 2. Regras Firebase detalhadas e com defesa em profundidade

As regras restringem criação, leitura e atualização de sessões, chaves API, entitlements, equipas, convites, dispositivos e envelopes de sincronização. Storage limita tamanho e escopo de uploads; leituras partilhadas de anexos usam URL assinada temporária em vez de abrir o bucket. Esta é uma implementação mais madura do que a média dos produtos Firebase e ataca riscos típicos de autorização por objeto identificados pela OWASP.[1]

### 3. API e MCP têm escopos e autenticação reais

As chaves `mne_live_…` são aleatórias, guardadas apenas como hash SHA-256, revogáveis e limitadas a três scopes. A implementação evita o anti-padrão de “MCP de demonstração”: apenas anuncia ferramentas implementadas, protege chamadas por escopo e não entrega texto em claro. A documentação OpenAPI também explicita o trade-off dos embeddings.

### 4. Portabilidade e entrada de dados são diferenciais concretos

A importação de Obsidian preserva Markdown, frontmatter e wikilinks, enquanto a exportação soberana oferece uma saída do produto. O benchmark de mercado mostra que armazenamento local, exportabilidade e interoperabilidade são expectativas fortes no universo Obsidian; o Mnemosyne já está bem posicionado neste ponto.[7]

### 5. Há transparência sobre limites de produto

A documentação distingue Founder Preview de planos pagos, declara Stripe latente, não promete recuperação mágica de mnemónica e reconhece que embeddings e metadados não são E2EE. O documento de controles SOC 2 também afirma expressamente que é um inventário, não uma certificação. Esta honestidade é uma vantagem comercial e jurídica.

### 6. Boas decisões de operação e segurança de base

O projeto inclui exclusão de material de chave legado do `localStorage`, bloqueio por inatividade, URL assinada de anexos com validade de 15 minutos, rate limit server-side fail-closed, updater Tauri assinado, CSP desktop, limpeza paginada no apagamento de conta e jobs de retenção de sincronização. Também existe Sentry opcional com tentativa de remoção de alguns campos sensíveis.

## Achados prioritários

### P0 — corrigir antes de ampliar aquisição, planos pagos ou agentes com escrita

| ID | Achado | Impacto | Evidência no código | Medida corretiva verificável |
|---|---|---|---|---|
| P0-01 | **Saída de membro não revoga a chave de equipa.** Ao sair, a chave wrapped do membro é removida, mas a `teamKey` não roda. Um ex-membro que já tenha a chave pode ler conteúdo histórico e também conteúdo futuro cifrado com a mesma chave. | **Crítico — confidencialidade de equipas.** | `functions/src/teams.ts` remove o wrap no leave; `frontend/src/services/teamVault.ts` usa uma chave de equipa comum; não existe epoch/rekey. | Implementar chaves por época: `teamKeyEpoch`, `activeKeyId`, rekey obrigatório em leave/removal, wrap da nova chave só para membros ativos, re-encriptação progressiva e estado de migração. Bloquear escrita enquanto a rotação não estiver concluída ou cifrar novas memórias com a nova época. Testar que ex-membro não decifra conteúdo criado após a revogação. |
| P0-02 | **A preferência “never-cloud” não é aplicada aos fluxos de geração.** Com o provider Ollama sem modelo ou indisponível, `generateTextFromPrompt` faz fallback para backend. A geração de imagem também percorre backends e, por fim, Pollinations. A preferência de privacidade é consultada apenas no enriquecimento NVIDIA de uma memória normal. | **Crítico — quebra da promessa de privacidade e consentimento.** | `frontend/src/services/localAiConfig.ts`, `aiGenerationService.ts`, `CognitiveInput.tsx`, `aiSavePolicy.ts`. | Criar um único `CloudUsePolicyGate` obrigatório antes de qualquer `fetch` para provider externo. Em `never-cloud`, não fazer fallback; mostrar erro útil. Em `confirm-cloud`, mostrar fornecedor, região, retenção, texto exato enviado e custo estimado antes de cada envio. Em `allow-cloud`, registar consentimento versionado. Criar testes que assegurem zero pedidos externos em `never-cloud`. |
| P0-03 | **Geração de imagem pode enviar prompts para Pollinations sem controlo de fornecedor, retenção ou consentimento.** O prompt ainda fica codificado na URL remota e essa URL pode ser persistida como anexo. | **Alto — privacidade, compliance e reputação.** | `frontend/src/services/aiGenerationService.ts` e `functions/src/webApi.ts`. | Remover o fallback público por defeito. Exigir opt-in específico para cada fornecedor externo. Não persistir URLs que contenham prompts; descarregar bytes e guardar em Storage cifrado, ou guardar apenas hash/referência local. Criar allowlist de fornecedores e DPA/termos documentados. |
| P0-04 | **Backend aceita `model` arbitrário nos endpoints de IA.** Um utilizador autenticado pode tentar forçar SKUs caros disponíveis nos fornecedores com chaves do servidor. Rate limiting por número de pedidos não resolve custo por modelo ou tokens. | **Alto — consumo financeiro e abuso.** | `functions/src/webApi.ts`; o valor de `req.body.model` segue para Hugging Face, NVIDIA e OpenAI. | Substituir o campo livre por IDs de modelos permitidos no servidor. Definir política por plano, custo máximo por pedido, máximo de tokens, orçamento mensal por tenant, quota atómica, alertas e circuit breaker. Testar que modelos fora da allowlist retornam 400 antes de chamar um fornecedor. |
| P0-05 | **Dependências de produção têm vulnerabilidades críticas e altas.** | **Alto — supply chain, parsing de documentos, bundler e runtime.** | `npm audit --omit=dev`: frontend 2 críticas/13 altas; Functions 1 crítica/4 altas. | Criar branch de atualização, gerar SBOM, aplicar `npm audit fix` não destrutivo, atualizar dependências maiores com testes de regressão e bloquear PRs com vulnerabilidades críticas novas. Priorizar `tar`, `websocket-driver`, `pdfjs-dist`, `@huggingface/transformers`, `undici`, `form-data`, `protobufjs` e árvores transitivas. Nunca executar `--force` sem diff, lockfile e validação. |
| P0-06 | **O enriquecimento “NVIDIA NIM” aponta para `/api/v1/extract`, rota que não existe nas Cloud Functions/rewrite atuais, e envia texto sem o header de autenticação usado pelos endpoints ativos.** | **Alto — funcionalidade anunciada que falha ou depende de backend legado não governado.** | `frontend/src/services/nvidiaApiService.ts`; `firebase.json`; `functions/src/index.ts`. | Escolher uma única solução: implementar endpoint autenticado no Firebase com política de cloud/custo, ou remover integralmente o provider e a UI até existir. Acrescentar teste de integração de rota e health-check. |
| P0-07 | **O scraper de pesquisa web pode seguir URLs não confiáveis sem validação de rede suficiente.** Bloqueia alguns hosts de busca, mas aceita IPs privados, redirecionamentos e não usa timeout/limite de tamanho em todos os fetches. | **Alto — SSRF, disponibilidade e consumo de recursos.** | `functions/src/webApi.ts`. A OWASP trata fetch de URL controlada direta ou indiretamente como superfície de SSRF.[1] | Criar `safeFetchExternalUrl`: apenas `https`, resolver DNS e bloquear RFC1918/loopback/link-local/metadata/IPv6 local, revalidar cada redirect, aplicar timeout, máximo de bytes, máximo de redirects, allowlist de portas e user-agent controlado. Rodar em ambiente egress-restrito quando possível. Adicionar testes de SSRF. |

### P1 — corrigir no próximo ciclo de produto e confiabilidade

| ID | Achado | Impacto | Medida recomendada |
|---|---|---|---|
| P1-01 | **Semântica multilingue não é sustentada pelo modelo atual.** O código usa `Xenova/all-MiniLM-L6-v2` e afirma suporte multilingue. A model card classifica o modelo como inglês e limita inputs a 256 word pieces; isto é incompatível com a promessa pt-PT, pt-BR, inglês e francês.[4] | Pesquisa, autolink e “contradições” terão recall desigual e podem falhar silenciosamente nos idiomas prioritários. | Avaliar um modelo ONNX realmente multilíngue, como `Xenova/multilingual-e5-small`, suportado em Transformers.js.[5] Fazer migração de versão de embedding, prefixos `query:`/`passage:` quando exigidos pelo modelo, avaliação por idioma e reindexação em background. |
| P1-02 | **O motor cognitivo é heurístico e alguns nomes sugerem uma capacidade maior.** “Contradições” dependem de negação lexical; `louvainClusters` não implementa o algoritmo Louvain completo; tipos celestes e importância são regras de tamanho/palavras em inglês. | Risco de UX enganadora, falsos insights e baixa confiança. | Renomear enquanto for heurístico: “tensão provável”, “agrupamento por limiar” e “sugestão semântica”. Depois implementar pipeline com proveniência, score, modelo, versão, evidência e ação de aceitar/rejeitar. |
| P1-03 | **A complexidade semântica não escala para 10 mil nós.** Criação de memória compara vetores com todas as memórias; funções de grafo fazem buscas lineares dentro de loops; PageRank é O(n²); importações enriquecem e ligam itens em sequência. | Lentidão, consumo de memória e bloqueio de UI em cofres médios/grandes. | Mover indexação para Web Worker, usar ANN local/servidor com ACL, fila de ingestão, batching, backpressure, LOD separado da recuperação e métricas de p95. Não usar o canvas 3D como índice de pesquisa. |
| P1-04 | **A API REST/MCP pesquisa no máximo os 500 documentos mais recentes e faz cosine em memória no servidor.** Não há paginação de busca nem índice vetorial/híbrido. | Resultados incompletos e custo imprevisível em cofres reais. | Implementar índice híbrido por tenant: filtro ACL determinístico, lexical/BM25, vetorial, entidades e temporalidade. Guardar `indexVersion`, `sourceMemoryId`, `chunkId`, `keyEpoch`, `deletedAt` e proveniência. A recuperação híbrida e temporal é a direção demonstrada por sistemas de memória atuais.[6] |
| P1-05 | **A migração de memórias legadas lê todo o cofre e atualiza uma a uma.** | Pode exceder memória/tempo/custos e não é reiniciável. | Paginar por cursor, usar lote limitado, checkpoint de progresso, backoff, observabilidade e opção de pausar/cancelar. |
| P1-06 | **O lint bloqueia qualidade e há um teste de exportação falhado.** | Reduz confiança no CI e aumenta risco de regressão. | Corrigir primeiro `formatAsTxt` ou o teste, conforme contrato de produto; corrigir os cinco erros ESLint, converter avisos críticos em erros graduais e tornar o job obrigatório no merge. |
| P1-07 | **A suite de rules não executa no computador local porque usa Java 17, mas o Firebase Emulator atual pede JDK 21.** | Regras de autorização, a camada mais crítica num projeto Firebase, deixam de ter verificação reproduzível local. | Fixar JDK 21 em `.tool-versions`/documentação/CI, criar script de preflight e fazer o teste de emulador obrigatório no deploy. |
| P1-08 | **O papel de equipa ainda não limita edição de memória.** `owner/admin/member` controla principalmente convites e administração; qualquer membro pode editar conteúdo e metadados de memória de equipa. | A semântica de RBAC não corresponde a uma colaboração empresarial granular. | Definir matriz por ação: owner/admin/member e, quando necessário, author/editor/viewer por memória. Aplicar a matriz tanto em rules como Functions, API, MCP, busca, anexos e grafo. |
| P1-09 | **App Check está preparado, mas pode não estar configurado nem enforced.** | Maior exposição a abuso automatizado de Auth/Functions no browser. | Ativar monitor web, medir rejeições, distinguir web/Tauri/clipper/API e aplicar enforce seletivo. Não ativar globalmente antes do plano de compatibilidade. |
| P1-10 | **Redação Sentry é parcial.** Strings curtas, breadcrumbs, `exception.value`, tags e informação de utilizador não são explicitamente filtrados. | Possível envio acidental de conteúdo sensível para observabilidade. | Configurar `sendDefaultPii:false`, `beforeBreadcrumb`, allowlist de campos, filtro de exception/message, teste com mnemónica/prompt/texto e retenção mínima. |
| P1-11 | **Validação de upload confia sobretudo em extensão e MIME.** São aceites HTML, SVG, código e blobs grandes; não há verificação de magic bytes, antivírus ou sandbox. | Risco de conteúdo ativo, ficheiros maliciosos e custos de storage. | Para anexos partilháveis, aceitar só tipos necessários, validar assinatura de ficheiro no backend, reescrever/neutralizar SVG, usar scanning assíncrono, quarentena e content-disposition de attachment. |
| P1-12 | **A sincronização móvel resolve conflitos criando cópia, mas não tem CRDT nem uma política explícita de resolução.** | Duplicados e divergências aumentam com uso offline. | Definir modelo de conflito por campo, “last writer wins” apenas onde seguro, CRDT para texto se colaboração concorrente for requisito, UI de resolução e testes de rede intermitente. |

### P2 — oportunidades de maturidade comercial e operacional

| Tema | Lacuna atual | Melhor medida |
|---|---|---|
| Recuperação e continuidade | A perda de mnemónica é irreversível por desenho, mas faltam opções de recuperação soberana e exercício de restore operacional. | Oferecer recovery kit opcional cifrado por passphrase/WebAuthn e, para equipas, escrow explícito por organização apenas com consentimento. Confirmar PITR, testar restore e publicar RTO/RPO honestos. |
| Enterprise | Não existem SSO, SCIM, organizações, políticas de sessão, DLP, retenção, audit log global ou exportação administrativa. | Não prometer enterprise ainda. Criar roadmap: OIDC primeiro, grupos, SCIM, audit log imutável, políticas de exportação e administração de conectores. |
| Supply chain | Há CI de testes, mas faltam Dependabot, SBOM, SAST, secret scanning, DAST, política de vulnerabilidades e evidência de deploy. | Adotar Dependabot/Renovate, CodeQL, Trivy/OSV, `npm audit` com baseline, SLSA-lite, assinatura de releases, changelog de deploy e rotação para Workload Identity Federation. |
| Observabilidade de IA | Não há trace unificado para ingestão, recuperação, geração, custo, citação, aprovação e feedback. | Implementar `runId`, `retrievalId`, `memoryEventId` e telemetry sem conteúdo; medir qualidade, latência, tokens, custo, aceitação de sugestões e incidentes. |
| Acessibilidade e UX | O universo 3D é diferenciador, mas não pode ser a única superfície de navegação. | Criar vista de lista/tabela, pesquisa por teclado, modo de baixo desempenho, reader mode e experiência acessível por screen reader. |
| Internacionalização | Há quatro idiomas de UI, mas stopwords, classificador e títulos automáticos misturam português/inglês. | Criar pipelines linguísticos por locale, testes de português europeu/brasileiro/francês e métricas de qualidade por idioma. |

## Bugs reproduzíveis e integrações incompletas

### Bug confirmado: cabeçalho de exportação TXT

`formatMemoryContent(memory, 'txt')` devolve o título (`Memória Alfa`) como cabeçalho quando existe título. O teste exige também a marca `MEMÓRIA`, logo o contrato de output está inconsistente. A correção é pequena, mas deve decidir o formato canónico. Exemplo seguro: `MEMÓRIA — Memória Alfa` ou atualizar o teste se a etiqueta deixou de ser requisito. Não deixar a suíte vermelha.

### Integração incompleta: extração NVIDIA

A interface oferece enriquecimento NVIDIA, mas o cliente pede `/api/v1/extract`, endpoint que não é exposto pela configuração Firebase. Como o pedido também não usa `getAuthJsonHeaders`, ele não segue o mesmo contrato de autenticação do backend atual. Deve ser tratado como **código legado/inoperante**, não como capacidade entregue.

### Integrações legadas e fallbacks que requerem limpeza

Os serviços de geração mantêm candidatos como `http://localhost:8000` e uma URL Cloud Run histórica. Isto gera diagnósticos confusos, amplia a superfície de dados e mistura arquitetura atual com backend morto. Cada fluxo deve ter um único endpoint de produção, um modo de desenvolvimento explicitamente marcado e telemetria que diga qual fornecedor foi realmente usado.

### Limites de documentação versus comportamento

O Starter Founder é **conteúdo intencional de onboarding**, não um mock enganador. Também é positivo que o fallback de pesquisa web mostre fontes com estado `snippet-only`, em vez de fingir que leu páginas. Stripe está claramente indicado como latente. Contudo, chamar “contradição” a uma heurística de negação, “Louvain” a um agrupamento de limiar e “NVIDIA NIM” a uma rota não deployada reduz a transparência. A nomenclatura deve comunicar o estado de maturidade.

## Pesquisa comparativa: realidade de mercado e inovação aplicável

### Onde o Mnemosyne já está acima da média

O Mnemosyne combina elementos que concorrentes normalmente separam: soberania de conteúdo, visualização espacial, API/MCP zero-knowledge, importação de Obsidian, desktop nativo e equipas cifradas. O Obsidian mostra que portabilidade, offline e grafo por links explícitos são expectativas sérias; a extensão do Mnemosyne é usar relações semânticas como camada adicional, não substituta da intenção humana.[7]

O Notion mostra outra expectativa: pesquisa semântica e respostas devem respeitar as permissões existentes, apresentar fontes e tratar embeddings com a mesma governança de dados que o conteúdo original.[3] Isto valida a decisão de não chamar embeddings de “inofensivos” e reforça a necessidade de ACL no índice, no grafo e no MCP.

### O que falta para competir com um produto de memória moderno

| Realidade observada | Lacuna Mnemosyne | Implementação recomendada |
|---|---|---|
| Sistemas de memória maduros separam escrita, recuperação, grafo de entidades, temporalidade e auditoria. Mem0 combina sinais vetoriais, lexicais, entidades e tempo; também mede precisão, tokens e latência.[6] | O Mnemosyne grava embedding e conexões, mas não tem lifecycle de memória, ranking híbrido, temporalidade ou avaliação. | Construir **Memory Fabric**: evento append-only, memória canónica, chunks, entidades, índices, estado de validade, proveniência, feedback e avaliação. |
| Produtos de conhecimento estruturado usam objetos, propriedades, referências, backlinks e vistas, não apenas texto livre. Capacities usa objetos tipados, propriedades e grafos locais; Recall liga ingestão multimédia a relações e revisão.[10] | Memórias têm metadados, mas faltam modelos de entidades de primeira classe. | Criar tipos: Pessoa, Organização, Projeto, Decisão, Fonte, Reunião, Tarefa, Conceito e Documento. Cada relação deve ter tipo, direção, autor, confiança, evidência e validade. |
| Pesquisa e IA empresariais mostram citações e respeitam ACL em todo o percurso de recuperação e geração.[3] | Insights e pesquisa web têm fontes, mas o grafo semântico não fornece evidência nem explicabilidade de cada ligação. | Mostrar “porque esta ligação existe”: texto origem, trecho/chunk, scores lexical/vetorial/temporal, modelo e versão. Exigir aprovação para relações de alto impacto. |
| Revisão ativa e repetição espaçada distinguem uma app de “guardar coisas” de uma app de memória. Recall gera perguntas editáveis, apresenta itens devidos e usa estágios de aprendizagem.[9] | O Mnemosyne possui pulso cognitivo, mas não um ciclo de retenção mensurável. | Criar **Review Inbox**: perguntas a partir de notas/fontes, revisão editável, agenda adaptativa, importância, due dates e métricas privadas. Não começar com gamificação; começar com revisão opcional de decisões, ideias e aprendizagem. |
| MCP/API com escrita tornou-se um padrão, mas exige consentimento, scopes, auditoria e controlo de agência. O Notion e Capacities expõem conectores, porém controlam acesso e conexões.[3] [10] | O MCP é deliberadamente limitado, uma boa base; faltam OAuth, confirmação por mutação e logs de execução. | Evoluir para **Agent Gateway** com tokens curtos/OAuth PKCE, scopes por cofre/equipa, modo read-only padrão, proposta de diff antes de escrever, approval tokens, allowlist e kill switch. |

### Inovações recomendadas, por ordem de valor

1. **Proveniência cognitiva.** Cada insight, cluster, ligação e resposta deve ter uma cadeia de prova: fontes, chunks, modelo, versão, filtros ACL, data, score e confirmação humana. Isto torna a IA auditável e diferencia o produto de “grafos mágicos”.

2. **Memória temporal com validade.** Não sobrescrever factos sem preservar o histórico. Usar `observedAt`, `validFrom`, `validTo`, `supersedes`, `confidence`, `sourceType` e `reviewState`. A recuperação deve saber distinguir “o que era verdade” de “o que é verdade agora”.

3. **Grafo de duas camadas.** Manter links explícitos do utilizador separados de relações inferidas. A primeira camada é soberana e explicável; a segunda pode ser desligada, recalculada e revista. O Obsidian prova o valor de links intencionais; embeddings devem complementar, não apagar, essa semântica.[7]

4. **Agente local-first, não agente omnipotente.** Executar leitura, indexação e proposta de mudanças no dispositivo desbloqueado. Para ações cloud/MCP, usar manifestação de permissões e aprovação explícita. Isto evita que “agente” se transforme em exfiltração de cofre por prompt injection.

5. **Resurfacing contextual.** Enquanto o utilizador navega, escreve ou abre uma página, mostrar decisões, notas e fontes relacionadas, mas com pouca interrupção e um botão de explicar/dispensar. Recall ilustra o valor de resurfacing associado à navegação, e não só à pesquisa manual.[9]

6. **Plano de confiança por classes de dados.** Permitir classificar memória/anexo como pessoal, equipa, confidencial, restrita ou externa. A classe controla IA cloud, exportação, partilha, retenção, indexação e telemetria. Este é o alicerce para enterprise sem destruir a experiência individual.

## Arquitetura-alvo recomendada

### Núcleo de memória

Cada escrita deve criar um `MemoryEvent` imutável. Uma projeção materializada constrói a memória atual. A entidade `Memory` referencia conteúdo cifrado, chunks cifrados, metadados mínimos, referências de anexos, relações explícitas e relações inferidas. O evento contém `tenantId`, `vaultId`, `teamId`, `authorId`, `keyEpoch`, `source`, `createdAt`, `observedAt`, `supersedes`, `confidence` e `policyClass`.

Para E2EE, os índices e vetores devem ter uma política explícita. O caminho mais privado é indexar localmente; o caminho cloud deve usar opt-in, isolamento por tenant e tratar embeddings como dados sensíveis. A própria documentação do Notion explica que embeddings são representações de conteúdo e que precisam das mesmas considerações de segurança e privacidade.[3]

### Recuperação e respostas

A recuperação deve aplicar autorização **antes** de consultar os candidatos e **depois** antes de entregar qualquer resultado. O ranking deve combinar filtro estruturado, lexical, vetorial, entidade e tempo. A resposta deve conter citações de memória/chunk e recusar-se a inventar quando não houver evidência. Métricas obrigatórias: precision@k, recall@k, taxa de abstenção correta, latência p50/p95, tokens, custo, taxa de clique em fonte e taxa de rejeição de sugestões.

### Operação e segurança

Adotar NIST CSF 2.0 como mapa de outcomes de Governar, Identificar, Proteger, Detetar, Responder e Recuperar, não como selo de certificação.[2] Para IA, acrescentar ameaça de prompt injection, poisoning, exfiltração por ferramentas, vazamento de embeddings e consumo ilimitado. A OWASP destaca precisamente autorização por objeto, consumo de recursos, SSRF, inventário de APIs e consumo inseguro de APIs como categorias relevantes.[1]

## Roadmap prático

| Horizonte | Objetivo | Entregas e critério de aceite |
|---|---|---|
| **0–7 dias** | Fechar riscos que contradizem promessa de privacidade. | Implementar rekey de equipa ou desativar partilha de equipas até existir; aplicar gate cloud único; remover Pollinations por defeito; allowlist de modelos; remover/implementar rota NVIDIA; atualizar vulnerabilidades críticas; corrigir teste export; JDK 21 e rules test verde. |
| **8–30 dias** | Tornar produto confiável e observável. | CI com lint/build/unit/rules/dependency scan; App Check monitor; SSRF safe fetch; Sentry com redaction testada; matriz RBAC; scans de anexos; release checklist; métricas de erro/custo/latência sem conteúdo. |
| **31–60 dias** | Substituir heurística por memória avaliável. | Modelo multilingue, versão de embedding, worker de indexação, benchmark interno pt/en/fr, grafo explicável de duas camadas, pesquisa híbrida com ACL e proveniência. |
| **61–90 dias** | Criar loops de retenção e preparação comercial. | Review Inbox, resurfacing contextual, Agent Gateway read-only, auditoria de mutações, export/import Markdown robusto, recovery/restore exercise e piloto controlado com equipas. |
| **Depois de validação comercial** | Enterprise de verdade. | OIDC, SCIM, organizações, DLP, logs de auditoria, política de retenção, DPA/subprocessadores, pen test e escopo SOC 2 formal. |

## Métricas de decisão

Não ativar monetização ou automações de escrita com base apenas em uma demo visual. Medir semanalmente:

- **Ativação:** percentagem de utilizadores que criam/importam, encontram e reabrem uma memória significativa em 24 horas.
- **Aha moment:** tempo até primeira memória ligada com explicação entendida; alvo inicial inferior a 90 segundos para quem escolhe Starter ou importação.
- **Qualidade semântica:** precisão das cinco ligações sugeridas, taxa de aceitação, falsos positivos e desempenho por idioma.
- **Retenção de conhecimento:** memórias revisitadas, perguntas de revisão concluídas e decisões recuperadas no momento certo.
- **Confiança:** percentagem de ações de IA em cloud com consentimento, incidentes de privacidade, conclusões de threat model e exercícios de restore concluídos.
- **Economia:** custo de IA por utilizador ativo, tokens por recuperação, custo de anexos, custo de suporte e margem por plano.
- **Segurança:** cobertura de rules, vulnerabilidades críticas abertas, tempo de rotação, alertas de abuso e resultados de testes negativos de ACL.

## Decisões de produto recomendadas

O Mnemosyne não deve tentar vencer Notion em gestão genérica de trabalho nem Obsidian em marketplace de plugins. Deve vencer numa proposta mais específica: **“a memória privada e verificável que transforma conhecimento disperso em contexto útil, sem capturar o utilizador numa caixa preta.”**

Isso exige três compromissos: primeiro, soberania deve ser real também nos fallbacks de IA; segundo, qualquer relação inferida deve ser explicável; terceiro, a memória de equipa deve suportar revogação criptográfica, não apenas remoção de permissões no servidor. O universo 3D deve continuar como assinatura emocional do produto, mas sempre acompanhado de pesquisa, lista, acessibilidade e prova de valor.

## Referências

[1]: https://owasp.org/API-Security/editions/2023/en/0x11-t10/ "OWASP Top 10 API Security Risks – 2023"
[2]: https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20 "The NIST Cybersecurity Framework (CSF) 2.0"
[3]: https://www.notion.com/help/notion-ai-security-practices "Notion AI security & privacy practices"
[4]: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 "sentence-transformers/all-MiniLM-L6-v2 model card"
[5]: https://huggingface.co/Xenova/multilingual-e5-small "Xenova/multilingual-e5-small model card"
[6]: https://docs.mem0.ai/core-concepts/memory-evaluation "Mem0 Memory Evaluation"
[7]: https://obsidian.md/help/sync-notes "Obsidian Sync and data storage"
[8]: https://obsidian.md/help/plugin-security "Obsidian Plugin security"
[9]: https://www.recall.wiki/post/supercharge-your-memory-using-spaced-repetition-2023 "Supercharge Your Memory Using Spaced Repetition"
[10]: https://docs.capacities.io/reference/content-types "Capacities Content Types"
[11]: https://docs.letta.com/concepts/memfs "Letta MemFS"
[12]: https://genai.owasp.org/llm-top-10/ "OWASP Top 10 for Large Language Model Applications"
[13]: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02016R0679-20160504 "Regulation (EU) 2016/679 General Data Protection Regulation"
