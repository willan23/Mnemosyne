# Comms — inbox P2P com registos indisponíveis

Data: 12 de outubro de 2026. Incremento local, sem deploy.

## Comportamento

Uma página percorre até dez candidatos do índice local e um candidato adicional para saber se há continuação. Registos com schema inválido são contabilizados como indisponíveis. As restantes cópias continuam a ser verificadas, decifradas e abertas. Falhas de cifra, digest, UID cifrado ou chave histórica afetam apenas a cópia correspondente, enquanto o contexto continua válido.

A interface apresenta a contagem de cópias indisponíveis da página e conserva Anterior/Seguinte/Atualizar. Não apresenta texto, nome, ID ou erro bruto do registo inválido. A leitura não apaga nem substitui a cifra, não envia ACK e não grava um recibo failed. Uma mudança de conta/cofre/vista interrompe a página inteira, impedindo retorno de plaintext parcial; falhas de IndexedDB continuam a ser erros de serviço, não são convertidas em linhas indisponíveis.

A contagem é local à página e ao contexto da conta. Uma página pode ter dez candidatos indisponíveis e nenhuma mensagem aberta; o cursor permite alcançar as páginas seguintes. Não se preenche a interface com respostas fabricadas nem se infere que uma cifra danificada foi reparada.

## Cursor e âmbito

O cursor contém UID e a chave nativa do índice timeline, copiada/validada antes de abrir a transação. A chave tem de ser um IDBValidKey com três componentes e o primeiro UID igual ao da conta. Datas/IDs de metadata malformada podem continuar a posicionar o cursor; não autorizam leitura individual, escrita ou ACK. get/compareExchange continuam a exigir UUID de pacote e schema estritos.

O cursor é efémero em memória; não é persistido, exportado nem enviado a Functions. Não houve alteração da versão/layout IndexedDB. Registos antigos válidos continuam a usar o mesmo índice. A posição vem do índice e não de campos reconstruídos do último registo válido; assim, uma linha inválida no fim da página não impede a continuação.

As queries e a limpeza usam o intervalo composto de UID exato, de [uid] inclusivo até [uid + NUL] exclusivo. O limite termina antes de qualquer UID diferente, incluindo prefixos como bob2. Abrange todos os tipos nativos de chave da mesma conta, incluindo IDs malformados em arrays. A limpeza também remove registos próprios que não estão no índice timeline por falta de metadata.

Registos sem uma chave timeline não aparecem nessa lista nem na sua contagem, mas continuam guardados e são abrangidos pela limpeza primária do UID. A leitura não os reindexa, não inventa timestamps e não os descarta. Reparação/exportação/restauração de cópias e chaves mantém os critérios próprios de recuperação e retenção.

## Validação

- 1.046 testes gerais frontend / 152 ficheiros passaram, com build e TypeScript.
- Lint geral: zero erros e 23 avisos anteriores; lint do código alterado: zero erros/avisos.
- 61 focados / cinco ficheiros passaram antes de tornar determinística a corrupção da fixture; a suite geral posterior inclui essa fixture final e as cinco regressões novas.
- Chromium com painel/controladores/cifra/IndexedDB/Web Locks reais confirmou dez linhas de índice malformado seguidas de páginas saudáveis de 10 + 2 mensagens; uma página mista com quatro cópias indisponíveis conserva seis saudáveis.
- O navegador confirmou purga de chaves primárias malformadas e cópias fora do índice da conta, conservando bob2. Registos locais adicionais são fixtures cifradas a partir do pacote sintético do ensaio, não entregas novas admitidas pelo servidor.
- As regressões de dois peers WebRTC nativos, anexo 192 KiB interrompido/retomado sem quota adicional, perda de ACK, reload, reconciliação e relay/paginação continuam no mesmo harness. Auth/RPC/DB backend são fronteiras sintéticas; zero externos/produção/fornecedor.

Backend, rules, CI, índices, dependências e storage.rules foram conservados com hashes comparados. Os testes backend/emulador anteriores mantêm a data/prova próprias; não foram repetidos para alegar execução nova. A prova anterior de reconciliação continua imutável.

Prova privada: W:\real\mnemosyne-launch-evidence\comms-p2p-inbox-local-validation-20261012.json. Contrato de entrega: [COMMS_P2P_ENTREGA_RECUPERAVEL.md](COMMS_P2P_ENTREGA_RECUPERAVEL.md). 40 gates / 21 fontes permanecem fechados; não houve deploy, alteração de produção ou ativação de alertas.

O objetivo mantém todas as fases 0–6 antes do deploy completo autorizado. Diretório independente de contactos aceites, retenção/identidades/equipas/writers, aplicação do legado e pilotos/cutover, cloud/segredos/alertas/restauração, qualidade, agentes/acessibilidade e verificação integral continuam pendentes.
