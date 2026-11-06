# Mnemosyne Clipper (Chrome / Edge)

Extensão Manifest V3 que entrega título, URL e texto selecionado à web app. **A extensão não cifra** — não tem a mnemónica do vault. A versão **1.1.0** transporta o recorte num fragmento `#mnemosyne-clip=v1&…`, limitado a ~1.5 KB. O conteúdo do fragmento fica no browser; não integra o pedido HTTP ao Hosting. `/clipper.html` limpa o URL, grava/relê a fila em `sessionStorage` e abre a SPA sem parâmetros do recorte. Uma fila existente ou armazenamento indisponível impede a entrega e mostra um erro, sem substituir a captura anterior.

A fila de entrada e o fragmento são **texto local, ainda sem cifra**. Depois de iniciar sessão e desbloquear o vault, o cliente prepara a cifra AES-GCM e um journal cifrado ligado ao UID; a criação/consulta/cancelamento usa um recibo transacional. Novas capturas continuam temporariamente fechadas pelos gates de lançamento. A preparação e recuperação estão descritas em [RECUPERACAO_CIFRADA_CLIPS.md](../../../docs/RECUPERACAO_CIFRADA_CLIPS.md).

**Atualiza instalações 1.0.0.** Essas versões enviam o recorte numa query: o primeiro pedido ao Hosting já expõe essa query. A compatibilidade da página limpa o endereço e evita reenviá-la, mas não desfaz o primeiro envio. Não houve publicação nas lojas neste incremento.

## Carregar unpacked no Chrome ou Edge

1. Abre `chrome://extensions` (ou `edge://extensions`).
2. Liga **Developer mode** / **Modo de programador**.
3. **Load unpacked** / **Carregar sem empacotamento**.
4. Escolhe esta pasta: `frontend/extensions/clipper/`.
5. Clica no ícone da extensão numa página http(s). Revisa título / URL / seleção e **Enviar para o Mnemosyne**.

Precisas de estar autenticado e com o vault desbloqueado (PIN ou frase de 12 palavras) na origem `https://mnemosyne-one.web.app`. Caso contrário o clip fica na fila até desbloqueares.

## Limites e compatibilidade

- Fragmento máximo ~1.5 KB, incluindo o prefixo — seleções longas são truncadas.
- Páginas `chrome://`, PDF nativo e similares não expõem seleção.
- A cifra só corre no browser da web app / desktop, nunca na extensão.
- O atalho global `Ctrl+Shift+M` é da app desktop Tauri, não desta extensão.

Para desenvolvimento local, altera `APP_ORIGIN` em `popup.js` para `http://localhost:5173`.
