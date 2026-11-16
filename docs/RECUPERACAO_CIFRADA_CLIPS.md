# Recuperação cifrada da captura de clips — 3 de outubro de 2026

## Problema corrigido

A captura criava uma memória com `addDoc`, sem identificador recuperável. Uma confirmação perdida devolvia o texto à fila e podia criar outra memória. O percurso passa a preparar uma operação pessoal com UUID e cifra imutáveis, gravá-la/relê-la num journal cifrado ligado ao UID e consultar um recibo no servidor antes de repetir o mesmo pedido.

O hook liga a entrada da sessão ao UID antes de preparar a captura. Retira essa entrada somente depois da confirmação de gravação local do journal; uma preparação recusada conserva a entrada. Uma falha de rede não devolve o conteúdo enviado à fila como captura nova. Outra operação pendente bloqueia novos clips. Feedback tardio depois de sair da vista/mudar de conta é ignorado.

## Contratos e estados

| Operação | Contrato |
|---|---|
| Criar | Recebe exatamente `sessionId` UUID v4 e `enc:{v:1,iv,ct}`; cifra limitada a 16 KiB, sem texto/título/UID/equipa/metadata fornecidos pelo cliente |
| Consultar | Exige conta ativa e o mesmo pedido cifrado; devolve `unknown`, `committed` ou `cancelled`, com identificador/digest/data |
| Cancelar | Confirma um commit existente ou grava um recibo `cancelled`; não apaga a memória se a criação já ganhou a corrida |

As três Functions ficam em `europe-west1`, autenticadas, com limite por UID/operação. A conta, perfil, marcador permanente, recibo, memória e contabilização são lidos dentro da transação. Em modo pago, o contador mensal e entitlement server-side determinam a quota. Memória, incremento de utilização e os dois recibos são criados atomicamente. O trigger de utilização reconhece o recibo e não cobra outra vez.

O recibo de criação usa `memoryCreationReceipts`, com `kind=clip`, UID, âmbito pessoal e SHA-256 do **pedido cifrado**, não do texto. Exige o mesmo digest em consultas/repetições/cancelamento; outro dono ou outra cifra são recusados. As regras já negam acesso direto aos recibos e recriação de IDs com recibo. Um recibo confirmado continua a confirmar a operação depois da memória ser editada/apagada e nunca a recria. A eliminação da conta já cobre estas coleções; o marcador permanente impede reativação posterior.

O journal contém UID e o pedido cifrado dentro de um envelope adicional do cofre. Usa uma chave exata em localStorage por UID, leitura de confirmação e Web Locks exclusivos entre separadores. Recusa storage indisponível, dados malformados/transplantados, cifra que não abre e alterações observadas de conta/cofre. Uma falha de resposta ou de limpeza conserva a operação recuperável quando o armazenamento continua disponível. O serviço não regista conteúdo ou erros de transporte.

## Privacidade e produto

Só a cifra pessoal é enviada a Firebase. Não há extração, fallback, chamadas a fornecedores ou envio de texto/anexos/prompts. O consentimento de IA continua no módulo central; sincronizar a cifra pessoal deste clip não autoriza processamento externo. Tags/categoria fixas são metadata de produto.

O painel mostra a captura pendente, bloqueia ações enquanto aguarda e oferece recuperação/cancelamento explícitos. Cancelar exige confirmação e explica que um commit existente será confirmado e que um rascunho ainda não gravado será retirado. A eliminação local confirmada da conta limpa apenas o journal desse UID.

## Rollout e pendências

Novas capturas estão fechadas por `CLIP_CAPTURE_ENABLED=false` no frontend e backend. Consultar/cancelar e confirmar recibos existentes permanecem disponíveis. Com o gate fechado, uma consulta `unknown` conserva o journal e não tenta criar. Rollback fecha somente novas criações e mantém os recibos/journals/recuperação; nunca elimina IDs para desbloquear uma repetição.

O deploy completo publica Functions antes do cliente e requer confirmar os três endpoints, conta/quota/recibos e clientes antigos no piloto. O preflight passou a verificar **15 gates em nove ficheiros**: os dez anteriores, associação de anexos, criação inicial com anexos, escritas API e os dois gates de clips. Todos permanecem fechados. Abrir um gate não comprova conclusão das fases.

Ainda necessários antes da ativação: pilotos com Auth real e web/Tauri/Android, compatibilidade com ausência de Web Locks/storage, recuperação da chave, ingressos legados de clips por query/extension, retenção e demais escritores de sync/importação. O journal local não substitui backup e não promete sobreviver à limpeza/perda do browser ou do cofre. Não há garantia de entrega exatamente uma vez ao nível de TCP/HTTP; o recibo impede repetir o efeito da mesma operação.

## Verificação reproduzível

Os fixtures são sintéticos. Unitários e testes frontend verificam preparação/guardas/checkpoints/ACK/cancelamento; o Firestore Emulator verifica transações reais, concorrência, quota, marcadores de conta, negação de recibos ao cliente e não recriação. Não houve escrita de produção nem chamadas reais a fornecedores.

O ensaio de Chromium usa cifra/localStorage/Web Locks reais, Firebase App substituída por fixture e um RPC local sintético. Recupera uma resposta inválida após commit noutro separador; recusa UID transplantado, cofre errado e captura concorrente antes da rede. Não prova Auth real, Admin/Functions de produção ou comportamento de Tauri/Android. O ensaio de Firestore fornece a evidência separada da transação server-side.

```powershell
# Node 22; dependências dos dois packages e Chromium Playwright instalado.
npm --prefix functions run build
node scripts/clip-recovery-browser.cjs
```

O ensaio foi acrescentado ao job de rules do CI, após instalar Chromium. O workflow foi preparado localmente; CI remoto/checks obrigatórios permanecem por verificar. Resultados finais e hashes ficam no estado de lançamento e na evidência privada fora do repositório.

Validação do incremento com Node **22.23.3** e JBR **21.0.6**:

- **55 testes frontend focados /seis ficheiros** e **582 gerais /112 ficheiros** passaram; build web e lint geral com **zero erros/23 avisos preexistentes**.
- **177 unitários Functions** passaram; uma suite de rules foi ignorada fora do emulador. O build Functions passou.
- A suite completa dos emuladores passou **120 Functions +22 frontend** e encerrou normalmente. A adição final dos gates de criação não mudou o executor transacional; o unitário posterior confirmou a recusa do callable fechado antes de rate/database e os testes cliente confirmaram recuperação com gates fechados.
- Chromium passou com recuperação noutro separador, recusa de transplantação/cofre errado e exclusão antes da rede. RPC de teste recebeu uma criação, zero pedidos externos e zero mutações de produção.
- **Quatro testes de scripts** passaram, incluindo falha em cada uma das 21 etapas simuladas do deploy. O preflight real parou nos **15 gates fechados**, sem comandos de publicação. YAML/diff do escopo passaram. O CI remoto não foi executado/verificado.

Na primeira compilação foi corrigida uma parameter property incompatível com `erasableSyntaxOnly`. O primeiro lint apontou a referência usada no cleanup do efeito; foi corrigida sem desativar a regra. A primeira injeção de falha de browser fechava o socket e o Chromium repetiu automaticamente o pedido; o fixture passou a devolver JSON inválido depois do commit para testar a confirmação de negócio perdida sem depender do comportamento de retry do transporte. Os diagnósticos conservam somente fase/tipo/flags/contagens, sem payloads.
