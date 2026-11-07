# Matriz de App Check por cliente — 25 de setembro de 2026

## Estado verificado no código

Esta matriz descreve a implementação local. Não confirma o registo dos clientes na consola Firebase, a emissão de tokens em produção nem métricas reais. Nenhum serviço tem enforcement de App Check configurado por este trabalho.

| Cliente / entrada | Implementação local | Validação antes de enforcement |
| --- | --- | --- |
| SPA no browser (`mnemosyne-one.com`, `web.app`) | O SDK web inicializa reCAPTCHA v3, ou Enterprise se `VITE_FIREBASE_APPCHECK_PROVIDER=enterprise`, apenas quando existe `VITE_FIREBASE_APPCHECK_SITE_KEY`. A inicialização ocorre antes de Auth, Firestore e Storage. | Registar a app e o domínio corretos; confirmar tokens e métricas de Auth, Firestore, Storage e Functions em browsers reais, incluindo sessões antigas, modo privado e bloqueio de scripts. |
| Tauri desktop | O WebView é excluído do provider web. Usa o SDK Firebase web para o cofre, sem token App Check. | Desenhar e testar um provider de atestação apropriado ou manter os serviços usados pelo desktop sem enforcement. Validar instalação e atualização em Windows antes de qualquer alteração de consola. |
| Android Capacitor | O WebView nativo é excluído do provider web. Não há ponte de App Check/Play Integrity implementada para os pedidos do SDK Firebase web. | Criar e testar a integração nativa e a passagem do token ao SDK usado pelo WebView; registar o certificado de assinatura e testar distribuição real. A documentação Firebase descreve Play Integrity para apps Android, mas isso **não** prova que o WebView atual envie tokens. |
| Extensão Clipper | A extensão abre `clipper.html` na origem da SPA; não usa Firebase diretamente. | Testar o percurso extensão → SPA no browser com uma sessão desbloqueada e observar o token da SPA. Não publicar a extensão como mecanismo autónomo de atestação. |
| REST/MCP com Bearer key | `publicApi` e MCP usam a chave de API e não enviam um token App Check de cliente. | Definir um fluxo de token separado, ou manter estes endpoints fora de enforcement de Functions; verificar clientes existentes antes de alterar `enforceAppCheck`. |
| Scripts administrativos / Admin SDK | Acesso server-side, não é um cliente web ou Android. | Confirmar que jobs administrativos e recuperação continuam a funcionar com qualquer política futura. |
| Recuperação de eliminação sem Auth | Callable de consulta protegido por comprovativo do dispositivo e rate limit por digest do IP da plataforma. Não inicia eliminação. | Confirmar emissão/aceitação de App Check sem sessão Auth nos clientes compatíveis; preservar recuperação dos dispositivos Tauri/Android antes de enforcement. O piloto real continua pendente. |

## Ordem operacional

1. Verificar a configuração e a site key na consola e no build web, sem mostrar o valor em logs. A presença da variável no build não prova inicialização bem-sucedida nem emissão de token.
2. Publicar primeiro clientes compatíveis e observar métricas de pedidos válidos, inválidos e sem token por produto e plataforma. Fazer smoke de login, leitura/escrita pessoal, anexos históricos, Functions e Clipper.
3. Projetar as integrações Tauri e Android e o contrato para clientes REST/MCP; testar em dispositivos e versões antigas ainda em uso.
4. Só considerar enforcement seletivo depois de cada cliente afetado emitir tokens válidos e de existir rollback de consola ensaiado. Não ativar enforcement global agora.

O projeto usa reCAPTCHA v3 por decisão anterior. A [documentação web atual do Firebase](https://firebase.google.com/docs/app-check/web/recaptcha-provider) recomenda Enterprise para integrações novas; uma troca de provider requer avaliação de quota, custo, configuração e testes próprios. O [guia Android](https://firebase.google.com/docs/app-check/android/play-integrity-provider) exige registo da app e certificado para Play Integrity. A [documentação de provider personalizado](https://firebase.google.com/docs/app-check/web/custom-provider) descreve o caminho para ambientes sem provider integrado. O Firebase recomenda [monitorizar métricas antes de enforcement](https://firebase.google.com/docs/app-check/web/recaptcha-provider).

## Rollback

Se o web client falhar a obter token em monitor, remover ou corrigir a site key no próximo build; os serviços ainda aceitam pedidos. Se no futuro houver enforcement, o rollback de consola por produto deve preceder o rollback do cliente para não cortar Tauri, Android, API ou utilizadores com versão antiga. Esta sequência ainda não foi ensaiada.
