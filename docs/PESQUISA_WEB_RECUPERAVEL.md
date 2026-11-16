# Pesquisa web recuperável — 9 de outubro de 2026

## Pedido e privacidade

A pesquisa captura conta, cofre, política e contexto do painel antes dos awaits. Mudar conta, bloquear o cofre ou fechar/reabrir o painel invalida resultados e feedback, mesmo depois de voltar ao estado anterior. O cabeçalho HTTP exige o token da conta capturada e volta a confirmar o UID após obtê-lo; não faz pedidos anónimos quando Auth falha. Geração de IA usa a mesma verificação de credenciais.

Só o modo contextual envia as memórias selecionadas. Os modos público e privado local retiram contexto do pedido; as comparações privadas são locais e usam o modo do resultado capturado. Candidatos são memórias pessoais próprias, ativas, legíveis e sem partilha. O pedido limita a consulta a 2 000 bytes UTF-8, até oito contextos de 2 000 bytes e 12 000 bytes no conjunto, e até doze fontes. Consentimento, política e conta são revalidados após a confirmação e através do transporte.

A resposta tem contrato limitado, consulta/modo correspondentes ao pedido e URLs HTTP/HTTPS sem credenciais. A leitura conta bytes durante o stream, cancela ao exceder 250 kB e recusa UTF-8 inválido. Respostas de autenticação, outros erros 4xx, JSON inválido ou contrato adulterado interrompem a operação. Falhas de rede/5xx podem oferecer as alternativas públicas existentes apenas enquanto o contexto continuar válido, sem incluir diagnósticos do fornecedor. Resultados tardios não são publicados.

## Gravação e recuperação

Guardar usa `createPersonalMemory` e o diário cifrado comum de [criação pessoal](CRIACAO_PESSOAL_RECUPERAVEL.md). Consulta, resumo, ideias e URLs das fontes ficam no texto cifrado. Os únicos campos de pesquisa em metadata são o modo e o timestamp positivo de gravação; tags, embeddings e demais metadata de aprendizagem conservam a visibilidade documentada do produto. O servidor valida essa allowlist e grava memória/uso/recibo atomicamente.

O resultado é copiado antes de inferência e escrita. A inferência usa candidatos pessoais do destino capturado. Gate fechado ou diário pendente recusa nova criação antes de inferência. Perda de resposta conserva ID/cifra/pedido e o painel de recuperação permite confirmar o recibo noutra aba sem recriar ou cobrar de novo. A gravação confirmada desativa o botão para o mesmo resultado no painel. A confirmação pela recuperação genérica não reconcilia automaticamente esse marcador de UI; não se declara deduplicação de novas ações explícitas depois de limpar o diário.

`never-cloud` recusa divulgação à IA, conservando a sincronização cifrada normal do cofre. Uma gravação de pesquisa já existente pode usar essa sincronização sem abrir consentimento de IA. As guardas percorrem inferência, journal, RPC, confirmação e feedback. Não há fallback para `addDoc`.

## Evidência e limites

Passaram 799 testes gerais frontend/132 ficheiros, 43 focados/seis ficheiros, 225 unitários Functions com uma suite fora do emulador ignorada, 150 Functions +23 frontend no emulador, builds/TypeScript, lint zero erros/23 avisos anteriores, quatro testes do procedimento de deploy/21 pontos de falha e audits de produção com zero vulnerabilidades. O Chromium usa os serviços reais, cifra/storage/Web Locks reais e Auth/fornecedor/RPC sintéticos locais. Confirma contexto privado retirado, gravação cifrada sob never-cloud, ACK perdido/recuperação entre abas, URLs inseguras recusadas e resultados tardios após mudança de conta/cofre recusados. Zero pedidos externos ou mutações de produção.

Os logs conservam a primeira falha de fecho síncrono do painel, o erro de fixture do browser sem export de Storage e o lint inicial; todos foram corrigidos antes da validação final. Prova privada: `W:\real\mnemosyne-launch-evidence\web-research-local-validation-20261009.json`. Os 25 gates em treze ficheiros continuam fechados. O APK debug anterior pertence à revisão anterior do cliente.

Importação integral de cápsulas e registo final, revisão pessoal com ACK perdido, escritores/regras legados, retenção e recuperação entre instalações, quotas globais, migrações, segredos, alertas, restauração, pilotos, qualidade e agentes/acessibilidade continuam necessários. Este incremento não conclui uma fase nem autoriza publicação antecipada; todas as fases 0–6 precedem o deploy completo autorizado.
