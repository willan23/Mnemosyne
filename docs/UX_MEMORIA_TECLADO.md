# Memória por teclado — lista, tabela e revisões

## Continuação de 16 de outubro de 2026

O Universo 3D mantém-se como experiência principal. Lista e tabela apresentam o mesmo conjunto de memórias recebido da aplicação, com pesquisa por teclado e páginas de 100 resultados, sem montar WebGL. A lista usa botões nativos; a tabela tem caption, cabeçalhos de coluna e botões para abrir a memória. Esta continuação não modifica a seleção/autorização dos dados recebidos nem o motor de pesquisa.

## Paginação sem perder o foco

Ativar “Mostrar mais” coloca o foco no primeiro resultado acrescentado. A mudança também funciona na última página, quando o botão desaparece. O pedido de foco fica ligado ao ID do resultado e à pesquisa apresentada, é consumido uma vez e só alcança um botão ainda montado. Uma mudança de pesquisa conserva o reset de paginação existente. Não há setTimeout nem captura tardia de uma lista nova.

## Revisões como diálogo modal

A Review Inbox usa `HTMLDialogElement.showModal()`. O browser torna o fundo inativo e coloca o foco inicial no controlo de fechar. O tratamento de Tab/Shift+Tab conserva a navegação nos controlos atualmente visíveis e habilitados, incluindo campos de edição e prévias que aparecem depois. Fecha com Escape pelo evento nativo `cancel`, impedindo a ação implícita para executar primeiro a invalidação síncrona dos callbacks do painel. As teclas do diálogo não disparam os atalhos da aplicação no fundo.

Abrir/fechar o diálogo usa um layout effect. O cleanup chama `close()` enquanto o elemento ainda está ligado ao DOM; assim o browser restaura o foco anterior quando se fecha por Escape, pelo botão ou por abrir a fonte. A primeira versão com cleanup passivo não restaurava o foco depois da remoção do DOM. Também foi necessário tratar a passagem entre o último e o primeiro controlo: o ensaio encontrou saída de foco mesmo com o diálogo nativo aberto. Ambos os casos ficaram cobertos em Chromium.

Uma mutação em curso continua ligada ao UID/cofre/vista capturados. Escape fecha a interface e invalida a admissão de uma escrita ainda não confirmada; não desfaz uma transação já confirmada. A recuperação e os recibos do [backup cifrado](REVIEW_INBOX_PRIVADA_RECUPERAVEL.md) conservam o seu contrato. Estes controlos de teclado não concedem autorização para uma fonte indisponível nem alteram a privacidade das perguntas.

## Fonte incluída na aplicação

A folha de estilos importava Inter de Google Fonts. Ao testar o CSS real, houve uma tentativa de pedido externo, bloqueada pelo ensaio. A aplicação passa a servir `InterVariable.woff2` do próprio produto; mantém `font-display: swap` e o fallback de sistema. Não há alteração de pacotes npm ou locks.

O ficheiro original, sem modificações, provém do [repositório oficial Inter](https://github.com/rsms/inter), fixado no commit `353b61b9f4430d5f420d56605a6e7993e0941470`. A licença SIL OFL 1.1 acompanha-o em `frontend/public/fonts/inter/LICENSE.txt`. `provenance.json` regista URLs exatos, commit, instante, tamanho e hashes do ficheiro/licença. O build copia estes três ficheiros para `dist/fonts/inter/`. Esta mudança retira o pedido de fontes da folha de estilos da aplicação; não afirma que todas as outras funcionalidades do produto sejam offline.

## Validação e limites

O ensaio `scripts/review-accessibility-browser.cjs` usa os componentes, CSS do build, fonte local, AES, IndexedDB e Web Locks reais. Auth e memórias são sintéticos; os pedidos externos são bloqueados. Verifica foco inicial, fundo inativo por teclado/ponteiro, ciclos completos de Tab/Shift+Tab, atalhos do fundo, Escape/abertura da fonte com regresso ao botão anterior, edição dinâmica, paginação final de lista/tabela, pesquisa/Enter, viewport de 375×667 e texto aumentado para 200%. Confirma que a fonte local foi efetivamente carregada. O percurso final passou com zero pedidos externos e zero mutações de produção.

Os testes de componentes usam um stub apenas das operações `showModal`/`close`, porque jsdom não as implementa; esse stub não prova foco ou inatividade do fundo. O teste de cancelamento verifica que Escape invalida uma gravação retida antes do commit. Os testes de paginação cobrem os dois modos e a última página. Passaram **17 testes focados** e a suite geral de **1.399 testes/178 ficheiros**. Build/TypeScript, os dois ensaios anteriores de recuperação e quatro smokes públicos passaram; lint final zero erros/23 avisos anteriores. O âmbito de reutilização das regras/servidor e a prova consolidada constam de [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).

Este ensaio não é aceitação por NVDA, VoiceOver ou TalkBack, nem validação em Tauri/Capacitor ou dispositivos reais. O requisito de leitores/dispositivos e a fase 6 continuam abertos. O aumento de fonte ensaiado não substitui todos os modos de zoom do browser, contraste, preferências de movimento ou cenários de acessibilidade do produto completo. A interface exige um WebView/browser com diálogo nativo e as APIs locais de armazenamento/cifra/locks usadas pela Review Inbox. Não houve deploy.
