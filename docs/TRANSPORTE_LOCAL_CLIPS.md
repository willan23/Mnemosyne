# Transporte local de clips — 4 de outubro de 2026

## Problema e âmbito

A extensão 1.0.0 colocava título, URL e seleção em parâmetros de query de `/clipper.html`. O Hosting recebia esse conteúdo no primeiro pedido e a página voltava a enviá-lo ao abrir `/clip`. Cifrar a memória posteriormente não protegia esses pedidos. Este incremento corrige o transporte no cliente atual e conserva a recuperação cifrada descrita em [RECUPERACAO_CIFRADA_CLIPS.md](RECUPERACAO_CIFRADA_CLIPS.md). Não conclui as fases de lançamento.

## Decisão e contrato

- A extensão local passa a **1.1.0**. O destino é `https://mnemosyne-one.web.app/clipper.html#mnemosyne-clip=v1&…`, sem query do recorte. O fragmento, incluindo o prefixo, tem no máximo **1500 bytes UTF-8**. O título/URL/seleção mantêm limites e sanitização.
- O parser v1 aceita exclusivamente `title`, `url` e `text`, uma ocorrência por campo. Recusa versão desconhecida, campo extra, percent-encoding inválido, conteúdo vazio, duplicados e excesso de tamanho. Queries antigas têm limite/validação e a combinação de query e fragmento de clip é recusada.
- O bootstrap clássico é gerado **a partir do mesmo módulo TypeScript** utilizado pela SPA. `npm run build` regenera `public/clip-ingress.js`. `index.html` e a página intermédia executam-no antes dos módulos da aplicação. Os metadados `no-referrer` precedem os recursos; a página intermédia restringe recursos com CSP.
- A entrada é lida para memória local e o endereço é limpo antes de guardar. Parâmetros/fragmentos de outros fluxos e `history.state` são conservados. Uma fila existente, incluindo outro UID, nunca é substituída por uma nova entrada.
- A escrita em `sessionStorage` exige readback exato. Falha, readback inválido ou entrada malformada produzem erro fixo sem conteúdo. A página intermédia não redireciona nesses casos. A ausência do bootstrap também impede a entrega; a SPA dispõe de limpeza/erro adicional antes de inicializar Sentry e renderizar a aplicação.
- O único redirecionamento normal é para **`/clip` sem parâmetros do recorte**. Foram removidos o segundo parser/escritor da rota e o fallback que reenviava a query quando `sessionStorage` falhava.
- O hook conserva a ligação posterior da fila ao UID e a preparação do journal cifrado. Nenhuma alteração ao contrato/recibo servidor, rules ou schema de Firestore neste incremento.

## Ameaças e limites

O fragmento e a fila inicial são **texto local, ainda sem cifra**. A extensão não conhece a mnemónica. Outros scripts com autoridade sobre a mesma origem, extensões privilegiadas, o browser e o dispositivo continuam a ser fronteiras de confiança. Não se promete apagar cópias da memória do browser ou do histórico externo. A cifra e o journal ligado ao UID começam depois de autenticar/desbloquear o vault.

Uma extensão 1.0.0 continua a enviar uma query no **primeiro** pedido. A página nova limpa-a e evita um segundo envio, mas não desfaz o primeiro. É obrigatório atualizar instalações antigas e confirmar o protocolo nos clientes suportados antes de concluir o lançamento. As queries legadas recusadas também já terão chegado no primeiro pedido.

O `no-referrer` da SPA é uma alteração de integração: os pilotos reais devem confirmar Auth, App Check, restrições da API key, OAuth e clientes nativos. Não se alteraram essas restrições ou a configuração cloud neste incremento.

## Validação local

Runtime **Node 22.23.3**. A passagem final da suite frontend, com código estabilizado e `--maxWorkers=2`, passou **589 testes em 112 ficheiros**, saída zero. O teste isolado do parser/fallback passou **20 testes**. A primeira passagem geral correu durante as últimas edições e em concorrência com build/lint: registou um módulo transformado anterior à nova função e um timeout do teste de sidebar. A repetição completa final passou ambos, sem alterar o teste de sidebar nem aumentar o timeout.

`node scripts/clip-ingress-browser.cjs` passou em **Chromium real** usando popup, landing e HTML de entrada reais, com o módulo da aplicação substituído por um fixture local que observa a ordem de arranque. Confirmou:

- URL produzido pelo popup sem query e compatível com o parser canónico, incluindo truncação multibyte;
- recorte ausente dos pedidos HTTP e dos referrers do protocolo novo;
- endereço limpo e bootstrap concluído antes da execução do módulo fixture;
- erro sem redirecionamento em armazenamento bloqueado, fila de outro UID, fragmento malformado e bootstrap ausente;
- fallback de limpeza/erro da entrada direta na SPA sem bootstrap;
- exatamente um pedido HTTP com dados no caso legado (o primeiro), sem reenvio ou referrer com dados;
- **zero pedidos externos e zero mutações de produção**.

O popup usa APIs Chrome simuladas; não é prova de instalação/permissions num pacote Chrome/Edge real. O fixture não inicializa Auth, App Check, fornecedores ou a aplicação completa; esses pilotos continuam necessários. Não foram repetidos os testes Functions/regras neste incremento cliente. A evidência de recuperação do servidor conserva a sua cronologia anterior.

O check de browser foi acrescentado ao job `rules-tests`; YAML e sintaxe/diff do escopo passaram localmente. Isso não comprova execução do **CI remoto**. O inventário local confirmou **15 gates em nove ficheiros, todos fechados**, com exit 2 esperado do preflight. Não houve publicação de extensão, deploy ou alteração cloud.

O build web final passou e o lint geral terminou com **zero erros/23 avisos preexistentes**. Mantêm-se os avisos de dimensão de chunks do Vite. Os resultados, integridade dos artefactos e hashes ficam na evidência privada `W:\real\mnemosyne-launch-evidence\clip-ingress-local-validation-20261004.json`. A matriz do lançamento é [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

## Migração, publicação e recuperação

1. Confirmar os restantes critérios das fases 0–6 e executar os pilotos de Auth/cofre/conta, navegação, referrer e armazenamento em Chrome, Edge, Android e desktop.
2. Publicar a versão web compatível através do rollout completo autorizado, com os demais pré-requisitos/gates verificados. Distribuir/atualizar a extensão 1.1.0 **depois** da landing/SPA compatível: uma página antiga não entende o fragmento novo. Este incremento não publica nas lojas.
3. Confirmar as versões instaladas e o comportamento perante ACK perdido, cancelamento e captura anterior. A abertura dos gates de captura exige essas provas, juntamente com os restantes gates de lançamento.
4. Uma regressão fecha os gates de captura e conserva os journals cifrados/recibos para recuperação. Não voltar ao transporte por query como rollback. Repor uma versão web anterior exige compatibilidade explícita com o fragmento novo; não fazer rollback cego para a landing antiga.

O próximo escritor a corrigir é `mobileSync.ts`: usa leituras sem CAS, cifra/commit separados por awaits e metadados recebidos espalhados no documento. A revisão deverá validar envelope/dispositivo/conta/cofre/âmbito pessoal/revisão, idempotência e confirmação antes da gravação/ACK. Nenhuma alteração desse escritor foi incluída aqui.
