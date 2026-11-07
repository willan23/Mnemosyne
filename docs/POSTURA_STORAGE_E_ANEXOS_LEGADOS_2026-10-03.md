# Postura real de Storage e anexos legados — 3 de outubro de 2026

## Operação e evidência

Foi executado um inventário **somente de leitura** do bucket configurado no cliente. O projeto explícito foi `mnemosyne-one`; a correspondência entre o número do projeto e o projeto proprietário do bucket foi verificada pela API Resource Manager e pelos metadados GCS. A configuração global do gcloud não foi alterada.

Foram lidos metadados do bucket, policy IAM direta, ACL do bucket e ACL por omissão, e uma listagem paginada de metadados dos objetos vivos. Não houve download de bytes, pedidos com URLs/token de utilizadores, gravação de objetos, alterações de IAM/CORS/retention, migração ou deploy.

Evidência final agregada, fora do repositório: `W:/real/mnemosyne-launch-evidence/storage-read-only-20261003T000051Z.json`. O ficheiro foi relido e validado. Não contém IDs de utilizadores, nomes/caminhos de objetos, tokens, URLs de ficheiros, emails de IAM, conteúdo ou chaves. O script operacional local também fica fora do repositório.

A primeira passagem adaptou incorretamente a resposta parcial do SDK como instância `File`. Confirmou configuração e nomes/contagem, mas os agregados de tamanho, geração, tokens, MIME e ACL ficaram inválidos. Essa evidência (`storage-read-only-20261003T000001Z.json`) foi marcada **incompleta** e corrigida, sem ser usada como prova desses campos. O código instalado mostrou que `getFiles` com `fields` devolve recursos JSON diretamente. A passagem final usou esse formato, bloqueou sucesso se faltassem tamanho/geração/ACL esperados e completou com saída zero.

## Configuração observada

| Campo | Estado observado | Consequência para o rollout |
|---|---|---|
| Localização | `US-CENTRAL1` | Mantém a limitação de residência dos anexos existentes. Um destino europeu novo exige migração própria |
| Uniform Bucket-Level Access | Desativado | ACLs individuais continuam a fazer parte da análise de acesso. Não converter sem rever os clientes e o plano de migração |
| Public Access Prevention | `inherited` | Não equivale a `enforced` no bucket. A política efetiva herdada não foi analisada neste incremento |
| IAM pública direta | Nenhum binding com `allUsers`/`allAuthenticatedUsers` observado | Prova limitada à policy direta, sem inferência sobre policies herdadas ou URLs com token |
| ACL do bucket e por omissão | Sem entidades públicas observadas | Não substitui a análise das ACLs dos objetos nem dos mecanismos Firebase |
| CORS | Sem regras | Preparar origens/métodos do protocolo de POST/GET cifrado e validar em browsers/WebViews reais antes de abrir writes |
| Versioning | Não ativado | A listagem não incluiu versões não correntes |
| Soft delete | `604800` segundos, sete dias | Apagamento de objeto vivo não comprova expiração das cópias retidas |
| Retenção do bucket e lifecycle | Sem policy de retenção bloqueada ou regras lifecycle observadas | Não existe prova neste inventário de uma política completa de recuperação/eliminação |

As configurações são leituras de momentos próximos; não constituem um snapshot global nem um teste de acesso público. IAM, ACL, tokens Firebase e URLs assinadas têm de ser tratados nos percursos próprios.

## Objetos legados

A listagem final completou todas as páginas observadas. Os objetos vivos encontrados pertencem ao namespace legado `attachments/`; não foram encontrados objetos nos namespaces novos `encrypted/` e `quarantine/` nessa passagem.

Todos os objetos observados têm metadata de token de download persistente. Os tamanhos, gerações e ACLs foram recebidos pela projeção esperada; não houve campo de tamanho/geração inválido nem ACL ausente nessa passagem, e não foram encontradas entidades públicas nas ACLs recebidas. A contagem de tokens é somente presença de metadata: não se usaram URLs para testar a validade ou efetividade de nenhum token.

Existem tipos declarados de conteúdo ativo entre os MIME observados. Isso não comprova os bytes nem uma classificação de malware. O inventário não leu originais, magic bytes, envelopes ou conteúdo cifrado, e não demonstra que um ficheiro pode ser apresentado com segurança. As contagens e bytes detalhados permanecem no ficheiro privado de evidência.

O resultado de registries vazios do inventário Firestore anterior não provava ausência de objetos. Este scan comprova a existência de objetos legados vivos. As duas leituras são independentes; não reconciliam cada objeto com memórias, versões, partilhas ou utilizadores.

## Sequência restante

1. Ensaiar a restauração Firestore no destino isolado e preparar uma estratégia de recuperação de bytes/gerações Storage; o export Firestore não contém esses bytes.
2. Reconciliar referências atuais, históricas e namespaces legados com objetos/gerações. Inventariar tokens desatualizados, objetos sem referência e ownership ambíguo; não atribuir propriedade apenas pelo caminho.
3. Confirmar o destino e configurar/pilotar um bucket adequado ao protocolo cifrado, com IAM privado, CORS das plataformas, limites, assinaturas e política de retenção/eliminação. Nenhuma alteração foi feita agora.
4. Executar migração assistida no cliente, com o proprietário autenticado e a chave apropriada, conservando checkpoints, revisões, referências de outros autores e provas de geração. Não promover `referenceSchemaVersion` apenas por terminar uma listagem.
5. Após confirmar a conversão e todos os consumidores/referências conhecidos, planear a retirada de tokens e objetos legados com rollback/retention. Não retirar tokens em massa antes de preservar o acesso autorizado e de validar a recuperação.
6. Ensaiar perda de rede, ACK, revogação, quotas, diferenças de geração e limpeza em web/Tauri/Android; repetir os inventários antes do corte final.

Este incremento conclui o inventário de configuração e metadados vivos no escopo indicado. Não conclui a migração, a fase 4 ou o lançamento.

## Referências do protocolo usado

O binding do projeto foi consultado com [Resource Manager `projects.get`](https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/get). A projeção/paginação de objetos e as permissões para receber ACLs seguem [Cloud Storage `objects.list`](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list). Esses documentos descrevem as APIs; os resultados Mnemosyne acima vêm da evidência local real, sem afirmações de configuração baseadas apenas na documentação.
