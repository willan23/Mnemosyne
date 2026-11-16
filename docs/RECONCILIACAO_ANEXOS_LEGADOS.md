# Reconciliação de referências e objetos legados — 3 de outubro de 2026

## Implementação

`functions/src/legacyAttachmentReconciliation.ts` é manutenção Admin **somente de leitura**, sem export no entrypoint das Functions. O CLI `scripts/reconcile-legacy-attachments.js` exige projeto e bucket explícitos, confirma pelo Resource Manager/metadata GCS que o bucket pertence ao projeto, e recusa flags desconhecidas, repetidas, `--apply` e contexto misto de emulador.

O scan GCS limita-se ao prefixo `attachments/`, gerações vivas, sem download de bytes. Pede apenas nome, tamanho, geração e a entrada de metadata `firebaseStorageDownloadTokens`. A resposta parcial do SDK é um recurso JSON direto, não uma instância `File`. O catálogo recusa nomes duplicados, tamanho/geração inválidos e excesso de objetos: não transforma uma leitura ambígua num resultado limpo.

O scan Firestore pagina `sessions` e os grupos `versions`/`memories`. Projeta somente UID, âmbito e lista de anexos; os pais históricos projetam somente UID/âmbito. Não lê texto, título, `enc`, perfis ou Auth. Uma entrada inline já existente pode conter bytes dentro da própria lista legada; é classificada sem interpretar ou exportar esse conteúdo. Não se faz pedido a URLs, probe de token, scan de conteúdo, assinatura ou modificação de documentos.

O catálogo fica em memória. Nomes/caminhos/UIDs e digests de comparação não saem no output. O CLI devolve só contagens, razões, projeto/bucket e estado da passagem.

## Classificação e limites

As referências distinguem formato Firebase, URLs GCS de path/host/API, bucket estrangeiro, origem externa, inline, descritor opaco e entrada malformada. URLs Storage reconhecidas são mapeadas ao objeto exato, sem usar o domínio como prova de propriedade. URLs GCS reconhecidas mas não suportadas pelo leitor legado são contadas separadamente. Outros formatos de referência externa/ambígua impedem afirmar cobertura completa do mapeamento.

Compara separadamente:

- existência no catálogo da geração viva observada;
- token único da URL Firebase versus digests da metadata do objeto;
- token ausente, repetido/ambíguo, divergente ou metadata ausente/malformada;
- UID textual do caminho versus campo UID do documento;
- binding do autor histórico ao pai e do UID das memórias aninhadas ao namespace;
- campo de âmbito em falta, inválido ou divergente no histórico.

Um histórico sem autor válido **não adota** o UID do pai ou do caminho. Um UID diferente pode representar uma referência legítima de equipa, uma partilha ou metadata incorreta; a comparação não autoriza transferência/apagamento. Mnemónica, identidade Auth, proveniência dos bytes e autorização atual dos consumidores não foram verificadas aqui.

Listas malformadas/maiores que 200 e namespaces desconhecidos impedem cobertura completa. Não se truncam em silêncio para produzir zero problemas. Os limites do operador são 10 mil objetos legados e 100 mil documentos por fonte; atingir o limite conserva incompletude. Não há aplicação parcial apresentada como conclusão.

`mappingCoverageComplete` descreve apenas o mapeamento dos campos de referência e formatos conhecidos recebidos nesse scan. Não valida autoria/ACL, cifra, outros campos/coleções, versões administrativas ou cópias offline. `deletionAuthorized` é sempre `false`. Um objeto sem referência observada **não é um órfão comprovadamente eliminável**.

## Comando e operação real

```powershell
node scripts/reconcile-legacy-attachments.js --project=mnemosyne-one --bucket=mnemosyne-one.firebasestorage.app
```

O comando real terminou com saída zero, com projeto/bucket verificados e zero mutações. A evidência foi guardada, relida e validada fora do repositório: `W:/real/mnemosyne-launch-evidence/legacy-reconciliation-20261003T001428Z.json`. Não contém UID, nome/caminho de objeto, URL, token ou conteúdo de memória. Contagens detalhadas permanecem nessa evidência.

Resultados que mudam a próxima ação:

- As referências Storage reconhecidas das sessões atuais e do histórico encontram objetos vivos no catálogo; os tokens correspondem à metadata observada. Isto não é um teste de acesso pela URL.
- Há objetos legados vivos sem referência observada nas três fontes. Preservar e rever; não apagar em lote com base nesse resultado.
- O histórico observado tem duas referências com contexto de autor inválido/ambíguo. Existe o pai, mas não se fabrica o binding do autor histórico.
- Persistem campos de âmbito pessoal em falta nas sessões e nos namespaces legados. O scan não aplicou `teamId:null`.
- Referências inline continuam a exigir o percurso de migração/validação próprio. Uma entrada inline grande classificada neste scan como inline também era sinalizada como malformada pelo inventário geral anterior por exceder o limite de tamanho; os classificadores têm finalidades diferentes.

As leituras GCS e Firestore são independentes; não formam um snapshot global. Escritas concorrentes, um objeto ainda a ser associado, referências noutros campos e outras cópias podem explicar ausência no conjunto observado.

## Correção adicional na autorização legada

A revisão do leitor revelou dois casos não cobertos: um documento de outro autor podia pedir nova URL para um namespace cuja conta já estava em eliminação; uma equipa ainda não congelada podia continuar a pedir URLs depois de o dono receber o marcador de eliminação. Os dois testes novos falharam **antes** da correção, com rejeição esperada ausente, em fixtures sintéticas.

`authorizeAttachmentRead` agora observa, na mesma transação, o marcador/estado da conta do namespace do caminho, a existência de marcador de eliminação da equipa, o estado de eliminação da equipa e a conta do dono. Dono ausente/inválido no schema não produz autorização implícita. O caminho continua sem conceder autoria/membership; acrescenta uma recusa para namespace revogado. A autorização original por sessão/referência/pertença permanece necessária.

Esses checks também correm depois da assinatura, pelo percurso existente de dupla autorização. Um marcador surgido enquanto se assina impede publicar a resposta. Uma URL já emitida ou token antigo não é revogado retroativamente por esta mudança. Não houve assinatura ou alteração de tokens reais.

## Próxima operação de dados

1. Ensaiar restauração Firestore e recuperar bytes/metadados/gerações Storage no destino isolado; o export Firestore anterior não contém esses bytes.
2. Rever os objetos não observados e o binding histórico, com proveniência e consumidores; proteger dados dos outros autores. Não preencher UID apenas para fazer o inventário passar.
3. Preparar o cliente de migração assistida com proprietário autenticado, chave correta, checkpoint, CAS e precondição de geração. A cifra/transferência não pode ser fabricada pelo servidor.
4. Validar recuperação/pilotagem e preservar compatibilidade na janela de manutenção; aplicar os metadados autorizados e repetir inventários.
5. Só retirar tokens/objetos antigos depois de validar todos os consumidores conhecidos, rollback e retenção; cumprir os restantes gates globais antes do deploy completo.

## Evidência local

Os resultados finais da correção de autorização serão acrescentados após terminar a suite completa em curso. Já passaram **146 unitários Functions** e **um caso focado de reconciliação no emulador**, com paginação, projeção sem texto/cifra, histórico órfão/fora do namespace, UIDs divergentes e documentos intactos. O primeiro build rejeitou um literal BigInt pelo target ES2017; foi usado `BigInt(0)` sem alterar o target nem ignorar o erro. O build/unitário posterior passou.

Duas passagens completas posteriores terminaram com **106/107 Functions**, sem executar a suite frontend por causa do encadeamento do comando. Os casos novos de reconciliação e liveness passaram em ambas. O único teste falhado exigia que todos os convites simultâneos recusados devolvessem `already-exists`. Uma passagem focada dos oito casos de serialização passou; o diagnóstico da segunda passagem completa mostrou um erro numérico gRPC `3`, e o log do emulador registou `Transaction is invalid or closed` durante a query de convite após timeouts de locks. O SDK instalado só repete `INVALID_ARGUMENT` quando a mensagem corresponde a uma transação expirada.

O teste agora exige um único sucesso, três recusas e apenas um convite/auditoria/revisão. Só para a combinação exata de código `3` e detalhe `Transaction is invalid or closed.` exige ainda que um novo pedido completo seja recusado como `already-exists`; verifica novamente convite, ponteiro de inbox, auditoria e revisão. Qualquer outro erro continua a falhar. Não foi alterado o código de produção dos convites, desativada a concorrência ou adicionado retry global. A passagem completa seguinte passou **107 Functions +22 frontend**, saída zero, em Node 24; não é apresentada como prova do runtime Node 22.

Na verificação do runtime, a pasta temporária anterior já não tinha `node.exe`/npm. Acrescentar essa pasta ao PATH tinha permitido fallback silencioso para o Node 24 global. As execuções iniciais deste incremento não comprovam Node 22. Reconstituiu-se a distribuição portátil **22.23.3** em `W:/real/mnemosyne-launch-tools`, fora do repositório, a partir do ZIP/manifesto oficial; SHA-256 comparado antes da extração e versão do executável confirmada. A evidência do arquivo foi guardada e relida em `W:/real/mnemosyne-launch-evidence/node22-restoration-20261003.json`. Não se alterou o Node/PATH global. Isto não altera as evidências de outros incrementos, cujo runtime tem a sua própria cronologia.

O runner passa agora por `scripts/preflight-node.js` antes de Java/emuladores. Recusa qualquer major diferente de 22 ou versão não reconhecida, com erro fixo sem imprimir configuração/segredos; dois testes cobrem versões aceites e recusadas. O executável global 24 foi recusado antes de iniciar Java/emuladores. **148 unitários Functions** passaram em Node 22.23.3 (uma suite de rules ignorada por não haver emulador nessa execução); sintaxe dos dois novos ficheiros JavaScript validada nesse runtime.

A passagem completa final confirmou **Node 22.23.3/JBR 21** antes de iniciar; passou **107 Functions +22 frontend**, com build TypeScript, saída zero e encerramento normal dos emuladores. Os casos de reconciliação, liveness e convites passaram; não houve tests ignorados nessa passagem. Logs finais: `%TEMP%/mnemosyne-reconciliation-node22-unit-verified.log` e `%TEMP%/mnemosyne-reconciliation-node22-rules-final.log`. Verificação de whitespace aprovada no escopo dos ficheiros novos/alterados. Um manifesto local liga esses logs, hashes dos fontes do incremento e evidências de leitura, em `W:/real/mnemosyne-launch-evidence/reconciliation-local-validation-20261003.json`; não é uma aprovação de lançamento.

O novo código do reconciliador não é um endpoint público e não muda regras, schema, quotas, referências ou bytes. As mudanças frontend não foram repetidas neste incremento, porque nenhum ficheiro frontend foi alterado. Esta evidência não conclui a fase 4 nem as fases 0–6.
