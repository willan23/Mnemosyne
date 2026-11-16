# Emparelhamento recuperável e credenciais cifradas

## Integração local de 18 de outubro de 2026

Os cinco escritores SDK de `mobilePairing.ts` foram substituídos pelas callables do [protocolo de servidor](EMPARELHAMENTO_DISPOSITIVOS_SERVIDOR.md). As raízes `devicePairings` e `trustedDevices` negam criar, alterar e apagar por SDK, incluindo escritas sem alteração de valores. A leitura própria mantém o contrato necessário às interfaces e à sincronização. As inscrições novas continuam com os dois gates `MOBILE_PAIRING_ENABLED` fechados.

Esta integração é local. Não houve deploy ou alteração de regras em produção. A classificação dos registos legados, os ensaios em hardware/rede e os restantes critérios de lançamento continuam exigidos.

## Chaves e preparação antes do pedido

Cada papel, desktop ou mobile, tem um registo v2 cifrado pelo cofre com UID interno, comando exato, chave privada e estado de recuperação. A chave e o pedido são guardados, relidos e decifrados antes de enviar uma mutação. O transporte contém só o ator, chaves públicas, referências limitadas e handshake cifrado. Nunca recebe a chave privada ou a mnemónica.

Web Locks serializam os papéis na mesma instalação. As escritas locais usam comparação com a base capturada e readback. Trocar conta/cofre/vista ou observar alteração do registo noutra aba retira o percurso; mesmo uma alteração seguida de reposição dos bytes originais invalida a operação quando o evento é observado. Uma operação já admitida pelo servidor não pode ser recolhida pelo fecho da interface.

Os listeners distinguem cache de confirmação do servidor e pedem eventos de metadata para receber também essa transição quando os dados não mudam. Uma falha de leitura apresenta estado indisponível; não confirma uma lista vazia. A opção segue a [documentação oficial de listeners Firestore](https://firebase.google.com/docs/firestore/query-data/listen#events-metadata-changes). Os testes de subscrição usam snapshots sintéticos e não substituem o piloto com rede real.

O importador da chave privada valida o par real por ECDH com uma chave de prova: igualdade das coordenadas JWK, só por si, não prova que o escalar privado corresponde à chave pública. Os handles devolvidos não permitem extrair a chave. A identidade persistente de sync do desktop conserva a cifra com derivação vinculada ao UID e passou a ser aberta sem cache de mnemónicas/handles privados.

## Falha, retoma e cancelamento

Criar/retomar o QR usa o mesmo ID e a mesma chave enquanto o convite estiver pendente/aceite. Uma resposta perdida não gera automaticamente outra identidade. O mobile permite retomar o último pedido cifrado sem voltar a ler o QR; depois da confirmação, guarda a credencial local com readback. Uma falha nesse armazenamento conserva o pedido e a chave para repetir.

A confiança no desktop verifica o handshake integral, fixa o comando no registo cifrado antes do RPC e confirma o dispositivo atual depois do recibo. Uma repetição com resposta perdida não altera a chave nem recria um dispositivo apagado ou revogado.

Cancelar conserva a intenção e a chave, incluindo em caso de falha. O servidor pode fixar o cancelamento antes de receber uma criação atrasada. Renovar um convite expirado exige fixar o seu cancelamento antes de arquivar a intenção anterior; assim, uma confiança antiga ainda em trânsito tem de serializar com o cancelamento. Se a confiança já tiver vencido, é necessário recuperar a credencial ativa ou revogar o dispositivo.

Uma retoma explícita pode recuperar a chave local de uma confiança já ativa depois de um cancelamento recusado. Verifica o dispositivo atual e não reverte cancelamentos/revogações do servidor. A intenção anterior fica arquivada com cifra. Uma nova inscrição depois de um cancelamento ou revogação confirmados também conserva o registo anterior antes de substituir o atual.

## Credencial principal, origem legada e retenção

A credencial nova é cifrada pelo cofre também quando a biblioteca SecureStorage usa a implementação web. Na plataforma nativa, mantém-se adicionalmente a configuração do armazenamento nativo e, em iOS, a opção de keychain local ao dispositivo. A resistência efetiva desse armazenamento exige o piloto em hardware; Chromium só ensaia a implementação web real da biblioteca.

Uma credencial legada é identificada como tal. A interface mostra a conta/dispositivo declarado e pede uma ação explícita para a proteger. A confirmação está ligada ao digest da origem revista; se a origem mudar, não a substitui. Essa atribuição não transforma a declaração UID de um formato antigo em prova criptográfica de origem.

Antes de substituir uma credencial, o objeto/cipher anterior é conservado num arquivo cifrado e verificado. Repetir a mesma credencial confirmada não volta a gravar. Arquivos e pedidos de outras contas, incluindo UIDs com prefixos semelhantes, ficam separados. A purga autorizada de conta remove os seus pedidos/arquivos e o armazenamento de credenciais, incluindo depois da retirada de Auth/cofre. O limite de cem arquivos por instalação/conta recusa novas substituições sem truncagem automática.

Readback e reload não provam durabilidade perante falha física, limpeza do perfil ou remoção do armazenamento pelo sistema. Os arquivos locais ainda exigem integração no backup/exportação de chaves do programa completo. Sobrescrever o registo principal não é uma promessa de apagamento forense dos bytes antigos. A revogação não recolhe chaves ou conteúdo já recebido no passado.

## Evidência e rollout

Os testes focados incluem serviços com crypto real e executor do servidor, armazenamento cifrado/arquivo/CAS, credenciais legadas e confirmação obsoleta, troca de conta/cofre, fecho, falhas de resposta/persistência e retoma da interface mobile. O ensaio Chromium usa as factories reais, ECDH/AES, Web Locks, perfis independentes e a implementação web real de SecureStorage; o transporte é uma ponte HTTP local para o executor real com Auth/Firestore sintéticos. A atomicidade e a matriz de negações SDK são verificadas separadamente no emulador.

Os resultados finais estão no [estado do lançamento completo](ESTADO_LANCAMENTO_COMPLETO.md). O rollout exige callable, clientes atuais e regras coordenados, classificação dos convites/dispositivos legados e validação de recuperação/dispositivos/rede. Rollback pode fechar os gates e retirar as interfaces, conservando os registos; não deve restaurar a publicação/confiança por SDK. Esta integração não conclui uma fase inteira nem o programa completo.
