# Inventário de produção e pré-requisitos do corte — 2 de outubro de 2026

## Operações verificadas

Foram executadas leituras no projeto explícito `mnemosyne-one`, com credencial ADC de utilizador. A configuração global do gcloud não foi alterada. As operações fizeram contagens agregadas, leitura da definição/estado dos índices e varreduras com projeção de metadata. Não houve aplicação de backfill, publicação de índices/regras, import/export novo, escrita de convites, alteração de bucket ou deploy.

Evidência detalhada, com contagens e timestamp UTC, fora deste repositório: `W:/real/mnemosyne-launch-evidence/read-only-inventory-20261002T192941Z.json`. O JSON foi relido e validado. Não contém UIDs, nomes, caminhos de objetos, URLs, tokens, conteúdo de memória ou headers de chave. As passagens são independentes e não constituem um snapshot global.

Comandos de leitura:

```powershell
node scripts/count-launch-data.js --project=mnemosyne-one
node scripts/audit-attachment-references.js --project=mnemosyne-one --require-clean
node scripts/backfill-team-invite-inbox.js --project=mnemosyne-one --require-complete
node scripts/backfill-personal-scope.js --project=mnemosyne-one
node scripts/backfill-personal-scope.js --project=mnemosyne-one --require-complete
```

`count-launch-data` não busca corpos de documentos nem utilizadores Auth: conta as fontes relevantes e verifica a presença dos três índices pessoais esperados através da API Admin. A varredura dos anexos usa a projeção descrita em [INVENTARIO_REFERENCIAS_ANEXOS.md](INVENTARIO_REFERENCIAS_ANEXOS.md). O backfill de âmbito passou a projetar apenas `uid`/`teamId`, inclusive na revalidação transacional do modo de aplicação. Os modos de aplicação foram exercitados apenas no projeto de emulador.

## Resultado e consequência

| Verificação | Estado observado | Consequência |
|---|---|---|
| Âmbito pessoal | Todas as sessões observadas são candidatas de backfill; não há `uid` inválido ou `teamId` presente inválido nesse dry-run | Publicar o leitor `teamId == null` agora omitiria as sessões antigas. O gate `--require-complete` terminou com código 1 |
| Índices de leitura pessoal | Os três padrões exigidos faltam entre os índices READY observados | Preparar/publicar separadamente esses índices na sequência autorizada e aguardar READY antes do corte |
| Referências de anexos | Existem URLs tokenizadas, referências inline/remotas, um descritor malformado e metadata de âmbito/histórico por resolver | `--require-clean` terminou com código 1 depois de completar o scan; não foi uma falha de credenciais |
| Memórias aninhadas e versão histórica | Existem dados no namespace legado e metadata histórica não comprovada | Preservar, migrar/rever no percurso próprio; o backfill de sessões não os resolve |
| Equipas, épocas e caixa de convites | As coleções observadas estão vazias | O gate atual da caixa passou, código 0, sem alterações ou lookup de utilizadores Auth. A migração futura/piloto de equipas continua a exigir os critérios próprios |
| Registries do novo protocolo | Nenhum registo observado | Não prova ausência de objetos Storage. Os anexos antigos continuam fora deste registry |

O inventário deste incremento **não lê texto/título/cifra das memórias**, logo não atualiza a prova de exposição desses campos. A constatação anterior de conteúdo legado em claro mantém a cronologia em [MIGRACAO_ESCOPO_SESSOES.md](MIGRACAO_ESCOPO_SESSOES.md); a migração assistida de cifra e a validação com os proprietários continuam pendentes. Nenhuma mnemónica foi pedida ou recebida por este processo.

## Endurecimento do operador

O backfill recusa flags desconhecidas/repetidas, parâmetros de aplicação num modo de leitura e contagem esperada fora do intervalo inteiro seguro, antes de abrir o SDK. A aplicação e o gate bloqueiam se existir ownership malformado; esses registos não são ignorados para produzir um resultado limpo. Cada transação volta a ler somente UID/âmbito e atualiza apenas `teamId`, sem modificar timestamps, texto, cifra ou anexos.

Erros operacionais conhecidos têm mensagens fixas. Erros de SDK não são imprimidos com paths/dados privados. `--backup-uri` continua a ser uma declaração operacional, não uma prova de restauração. A regra de manutenção com escritores incompatíveis suspensos e o ensaio isolado de restauração continuam necessários.

## Próxima sequência de dados

1. Concluir a preparação do ensaio de restauração no destino isolado por designar e validar o export autorizado anteriormente. O inventário não concede autorização para aplicar reparações em produção.
2. Preparar os índices e a versão transitória de cliente/escritores, com leitores compatíveis com o legado. A árvore do corte final não serve como versão transitória sem adaptação explícita.
3. Depois da restauração/validação e da janela sem escritores incompatíveis, aplicar o backfill de âmbito autorizado, voltar a contar e exigir o gate completo.
4. Executar a migração assistida de cifra com cada proprietário e tratar referências/bytes legados, inline e tokenizados; preservar metadata histórica até existir decisão/prova de ownership. Não trocar UID/AAD no servidor.
5. Validar leitores novos/antigos, histórico, ficheiros, contas e dispositivos; repetir inventários e pilotos de Storage/Auth/App Check. Só depois cumprir os restantes critérios globais e publicar o deploy completo já autorizado.

Não abrir os gates por a caixa de convites atual estar vazia. Isso não comprova quotas, revogação real, retenção, recuperação ou comportamento de novas equipas.

## Evidência local

- **139 unitários Functions passaram**, build incluído, suite de rules em skip nesse comando sem emulador.
- **Sete casos unitários focados passaram** para argumentos do operador, índices e validação de ownership.
- **Um caso novo de emulador passou** executando o CLI real em `demo-mnemosyne-rules`: ownership desconhecido bloqueou sem escrever; depois da reparação da fixture, aplicação de metadata preservou o conteúdo, repetição atualizou zero e contagem esperada antiga foi recusada. O output não incluiu conteúdo, UID ou ID das fixtures.
- Este incremento não repetiu a suite completa de 99 +22 nem os testes/build frontend; esses resultados pertencem ao incremento anterior. A alteração de guard de CLI foi validada pelo caso focado, e os comandos somente de leitura foram executados no projeto real.
- Logs em `%TEMP%`: `mnemosyne-production-inventory-unit-final.log`, `mnemosyne-personal-scope-cli-unit.log`, `mnemosyne-personal-scope-cli-emulator.log`; logs reais e contagens foram consolidados no ficheiro de evidência acima. Todos os processos observados terminaram e os emuladores encerraram normalmente.

O objetivo global e a autorização condicionada de deploy mantêm-se em [ESTADO_LANCAMENTO_COMPLETO.md](ESTADO_LANCAMENTO_COMPLETO.md).
