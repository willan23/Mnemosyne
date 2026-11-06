# Importação simples do Comms — 10 de outubro de 2026

## Contrato

Mensagens individuais recebidas passam pelo `commsMemoryImport`, com UUIDs próprios de memória e ficheiro. O ID incluído no texto do remetente é removido do corpo; não decide a identidade nem a deduplicação da memória local. A interface verifica apenas texto igual entre memórias pessoais legíveis da conta atual. Não publica uma memória otimista antes de confirmar o recibo; os listeners de sessões apresentam a escrita confirmada.

Conta/cofre/política e o contexto do painel são capturados antes de inferência/cifra. Uma mudança observada permanece inválida mesmo depois de regressar à conta, desbloquear o cofre ou reabrir o painel. Os candidatos semânticos são pessoais, legíveis, vivos e copiados por valor. O enriquecimento é local e não cria ligações implícitas. A importação simples usa os gates existentes de criação pessoal/anexos e os callables europeus de criação com recibo atómico; não acrescenta um percurso de escrita direta.

Um anexo recebido só é aceite como data URL base64 canónica, com nome/MIME/tamanho limitados e consistentes com os bytes. Não se consulta uma URL recebida. O cliente cria o ficheiro local, cifra conteúdo e nome/MIME sob uma chave própria, fixa o ID e conserva os bytes cifrados em IndexedDB. Guarda depois um diário AES-GCM em `mnemosyne:comms-import:v1:<uid>` com pedido/cifra da memória e manifesto/digest do upload, antes de qualquer pedido de upload ou criação. O pedido contém apenas cifra, IDs opacos e metadados permitidos; não contém o anexo inline nem nome/texto em claro.

Web Locks serializam por UID; conta/cofre/política e bytes exatos do diário são revalidados durante os awaits. Status precede upload/escrita; recuperação conserva IDs e cifras e não volta a inferir. Se a criação já está confirmada, a retoma não depende de recuperar os bytes locais do anexo. A confirmação terminal é repetida antes e depois da limpeza local, antes de remover o diário. Recibos confirmados depois de eliminar a memória não a recriam.

O painel de recuperação fica disponível no Comms e no compositor global. Cancelamento exige confirmação; um commit existente é confirmado, sem o desfazer. Falhas conservam o diário e mostram uma mensagem sem erro privado. A limpeza de conta remove apenas a chave exata do UID e conserva outras contas. Packs continuam no contrato [de cápsulas integrais](IMPORTACAO_CAPSULAS_RECUPERAVEL.md).

## Âmbito e limites

- Texto até 250.000 bytes UTF-8, título até 2.000 bytes, nome até 1.024 bytes e sem caminhos/caracteres de controlo. Limites de tipo/tamanho e validação de assinatura do ficheiro seguem o módulo comum de anexos; texto/cifra/pedido/diário também seguem os limites comuns.
- `never-cloud` recusa novos anexos antes de inferência/preparação/rede. Sincronização de texto já cifrado conserva o contrato existente. Confirmação de recibos e cancelamento continuam disponíveis com gates de escrita fechados.
- Cancelar um upload já pronto conserva o ficheiro/checkpoint para recuperação. Não significa que o objeto tenha sido eliminado. Inventário, retenção e purga global de órfãos continuam necessários.
- Uma interrupção depois de preparar localmente o ficheiro e antes de guardar o diário principal pode deixar um checkpoint local cifrado, sem upload remoto. Perder armazenamento/cofre impede recuperação local; retoma entre instalações continua pendente.
- Inbox e identidade são ligadas ao UID/época local; callbacks de decifragem relay/P2P deixam de publicar após perda de contexto. Relay/P2P recusam destinatário incorreto e snapshots antigos não substituem os mais recentes. Este incremento não prova todos os handlers de envio/contactos/rooms, publicação de identidade, limites de transporte, clientes antigos ou pilotos reais; permanecem no inventário global de Comms.
- Metadata/embeddings continuam sensíveis e em claro por decisão de produto. As rules/escritores legados, revisão de equipa, privacidade/persistência dos rascunhos, quotas/retenção globais e as demais fases ainda exigem conclusão antes do deploy completo.

## Validação

Passaram 863 testes gerais frontend/138 ficheiros e 61 focados finais/cinco ficheiros. A suite geral precede dois testes adicionais de deduplicação pessoal e troca de conta, abrangidos pelos focados finais. Build/TypeScript e lint passaram com zero erros/23 avisos anteriores; as auditorias de produção frontend/Functions reportaram zero vulnerabilidades. O preflight confirma 29 gates/14 ficheiros fechados. Não houve alterações de produto no backend/rules; a prova anterior conserva os 237 unitários Functions e 156 Functions +23 frontend no emulador, e os hashes das fontes backend abrangidas foram comparados. Essas suites não foram repetidas neste incremento exclusivo do cliente.

O ensaio Chromium confirmou cifra real de memória/ficheiro, IndexedDB, localStorage e Web Locks contra executor real de criação com DB sintética e upload RPC localhost. Confirmou perda de ACK de upload/criação, um POST por ficheiro, IDs/cifras estáveis, recuperação noutra aba, confirmação/cancelamento com gate fechado, não recriação de pai eliminado, adulteração de diário/bytes e isolamento de UID/cofre. Zero pedidos externos ou produção. As falhas iniciais de fixture/lint foram corrigidas e conservadas. Prova privada: `W:\real\mnemosyne-launch-evidence\comms-import-local-validation-20261010.json`. O ensaio não valida Cloud Storage, fornecedor, dispositivo nativo ou entrega real de mensagens. Nenhuma fase ou lançamento completo foi declarado concluído.
