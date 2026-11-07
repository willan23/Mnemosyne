# Ensaio de restauro Firestore — 18 de outubro de 2026

## Destino aprovado e isolamento

O responsável indicou `mnemosyne-one` como projeto do ensaio. Foi usada a base temporária **`mnemosyne-restore-20261018`**, Standard/Native, em **`eur3`**, a localização da base ativa. A aplicação continua ligada a `(default)`; não foi alterada a sua configuração nem feito deploy de aplicações/Functions.

Este é isolamento entre bases de dados no mesmo projeto. **IAM, identidades de serviço e Auth continuam partilhados pelo projeto**; não equivale a um ambiente independente. Não foram concedidas permissões IAM. Antes de importar, foi publicada uma release de regras exclusiva da base temporária, que recusa todas as leituras e escritas SDK. As releases de regras de `(default)` foram comparadas antes/depois sem diferenças.

## Resultado observado

| Verificação | Evidência |
| --- | --- |
| Origem | Export concluído de 24 de setembro: `gs://mnemosyne-one-firestore-backup-euw1/firestore/export-20260924T185215Z` |
| Bucket | `EUROPE-WEST1`, Uniform Bucket-Level Access ativo, Public Access Prevention `enforced`, sem bindings públicos diretos |
| Importação | `SUCCESSFUL`, de `2026-10-18T00:19:55.077523Z` a `00:20:02.318962Z`, **359 documentos** reportados pelo serviço |
| Leitura recursiva | **359 documentos**, IDs distintos, **13 grupos de coleções**, incluindo **32 documentos em subcoleções** e cinco antepassados sem documento |
| Conferência independente | Treze agregações de contagem no servidor concordam com os treze totais da leitura recursiva; soma **359** |
| Amostras | Doze documentos relidos e comparados por hash em memória; manifesto dos 359 caminhos/corpos guarda apenas hashes |
| Índices | **Dez índices compostos** copiados das definições efetivamente existentes em `(default)` e confirmados `READY`, com comparação das definições |
| Acesso SDK | Fonte das regras `deny-all` relida; pedido REST anónimo recusado com `403 / PERMISSION_DENIED` |
| Eliminação da base de ensaio | Operação concluída, ausência confirmada pela API e listagem final só com `(default)`; UID e releases de regras da base ativa mantidos |

As contagens por grupo e os horários completos ficam na evidência privada. A contagem histórica de oito objetos no registo inicial do backup não foi usada como critério: a listagem atual contém três ficheiros físicos, incluindo os dois manifestos e `output-0`, e o import do serviço recuperou os 359 documentos.

Não foi escrito um documento sintético em produção ou na cópia. O ensaio recuperou e releu documentos reais do export, sem imprimir campos, IDs de documentos, textos ou cifras nos logs. As leituras por IAM contornam as Security Rules; a recusa do acesso dos clientes foi verificada separadamente.

## Executor e repetição

O executor está em `scripts/firestore-restore-rehearsal.cjs`, acompanhado por cinco testes de proteção e por `scripts/firestore-restore-rehearsal-verify.cjs`, que faz apenas leituras/agregações na base de ensaio. Usa a sessão `gcloud` existente e conserva o token só em memória. Não guarda tokens nem lê segredos da aplicação.

O modo `plan` exige que o destino ainda não exista, verifica edição/localização, o export concluído e os índices atuais. O plano e o seu SHA-256 ficam registados antes das operações. `execute` exige esse hash exato, recusa um destino já existente e publica as regras fechadas antes do import. Import, criação de índices e eliminação têm destinos explícitos; o código recusa mutações em `(default)`, documentos arbitrários, outro projeto ou outro URI de origem.

Para uma repetição, escolher **outro ID datado da base e outra pasta de evidência**, rever a origem e gerar um novo plano. A origem/contagem desta versão estão fixadas no export de setembro; mudar o backup exige alterar e rever o contrato do executor. Não repetir o import numa base utilizada pela aplicação.

```powershell
node scripts/firestore-restore-rehearsal.cjs plan <base-temporaria-datada> <pasta-absoluta-nova>
node scripts/firestore-restore-rehearsal.cjs execute <base-temporaria-datada> <pasta-absoluta-nova> <sha256-do-plano>
node scripts/firestore-restore-rehearsal.cjs validate <base-temporaria-datada> <pasta-absoluta-nova> <sha256-do-plano>
node scripts/firestore-restore-rehearsal-verify.cjs <pasta-absoluta-nova>
node scripts/firestore-restore-rehearsal.cjs cleanup <base-temporaria-datada> <pasta-absoluta-nova> <sha256-do-plano>
```

`cleanup` só elimina a base criada por esta execução, comparando o seu UID com o registo de criação e exigindo ambas as verificações aprovadas. Conserva a metadata das regras `deny-all` do destino; não conserva uma base com dados de ensaio. O bucket/export de origem não é apagado. Os modos de criação/import/eliminação implicam operações faturáveis; a importação reportou 359 documentos. Não foi calculado o custo final da fatura.

Os logs conservam as tentativas recusadas: paginação de índices não suportada pelo serviço, primeira espera por índices e um nome reservado no pedido de teste anónimo. Foram corrigidos o executor e o probe; estas falhas não alteraram a base ativa. **Quinze testes de pipeline**, incluindo as cinco proteções novas, passaram. A etapa Windows da CI inclui estas proteções e o YAML manteve cinco jobs; a execução remota continua pendente. Os testes gerais da aplicação não foram repetidos neste incremento operacional, que não altera fontes frontend/Functions nem regras da aplicação.

## Limites e critérios ainda abertos

- O backup é de **24 de setembro**, não contém as alterações posteriores. Antes de migrações/rollout será necessária uma cópia atual e uma decisão sobre consistência temporal/janela de escritas ou PITR.
- O export normal não é um snapshot de um instante exato. Esta execução não mediu um RTO operacional: houve espera pelos índices e interrupção na recolha dos resultados.
- Os totais foram comparados com a metadata do export. Não houve comparação dos campos com os bytes originais do ficheiro exportado, nem ensaio de desencriptação com chaves dos proprietários.
- Foram recuperados documentos e recriados os dez índices compostos observados. Não se afirma recuperação completa das definições de isenção de índices, TTL, IAM, Auth, Functions ou restantes configurações do projeto.
- O ensaio **não restaura utilizadores Auth, bytes do Storage, chaves locais ou dados exclusivamente locais dos clientes**. Os respetivos backups, recuperação e pilotos continuam necessários.
- A decisão de retenção/novos exports e a situação dos anexos históricos em `US-CENTRAL1` continuam abertas. Não se promete residência exclusivamente europeia de todo o produto.
- As fases 0–6 continuam ativas. Este resultado fecha o ensaio técnico de importação deste export Firestore, não a recuperação integral do sistema ou a prontidão de lançamento.

Evidência privada: `W:/real/mnemosyne-launch-evidence/firestore-restore-validation-20261018/`. Prova consolidada: `W:/real/mnemosyne-launch-evidence/firestore-restore-operational-validation-20261018.json`, com hashes de fontes/ficheiros de evidência e ligação à prova anterior de emparelhamento. Os documentos/valores recuperados não foram copiados para o repositório.

Referências: [gestão de bases e regras por base](https://firebase.google.com/docs/firestore/manage-databases), [export/import, índices e custos](https://docs.cloud.google.com/firestore/native/docs/manage-data/export-import). A documentação oficial confirma que os imports mantêm IDs, podem sobrescrever documentos no destino e não disparam Cloud Functions; por isso o executor fixa uma base de ensaio explícita.
