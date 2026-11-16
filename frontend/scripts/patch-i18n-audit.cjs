const fs = require('fs');
const p = 'src/utils/translationCatalog.ts';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('statusH1:')) {
  console.log('already present');
  process.exit(0);
}
const needle =
  "  changelogCrypto: ['Detalhe criptográfico', 'Detalhe criptográfico', 'Cryptographic detail', 'Détail cryptographique'],\n";
const insert = `${needle}  statusH1: ['Estado do sistema', 'Status do sistema', 'System status', 'État du système'],
  statusIntro: ['Vista honesta dos componentes públicos. Sem SLOs inventados — actualiza-se com cada deploy.', 'Vista honesta dos componentes públicos. Sem SLOs inventados — atualiza-se a cada deploy.', 'Honest view of public components. No invented SLOs — updates with each deploy.', 'Vue honnête des composants publics. Pas de SLO inventés — mise à jour à chaque déploiement.'],
  statusGenerated: ['Gerado em', 'Gerado em', 'Generated at', 'Généré le'],
  txImportedOk: ['Memória assimilada no teu Universo.', 'Memória assimilada no seu Universo.', 'Memory assimilated into your Universe.', 'Mémoire assimilée dans votre Univers.'],
  txImportPackOk: ['{count} memórias do pack assimiladas.', '{count} memórias do pack assimiladas.', '{count} pack memories assimilated.', '{count} mémoires du pack assimilées.'],
  txAlreadyExists: ['Esta memória (ou uma idêntica) já existe no teu Universo.', 'Esta memória (ou uma idêntica) já existe no seu Universo.', 'This memory (or an identical one) already exists in your Universe.', 'Cette mémoire (ou une identique) existe déjà dans votre Univers.'],
  txImportFail: ['Não foi possível importar a memória.', 'Não foi possível importar a memória.', 'Could not import the memory.', "Impossible d'importer la mémoire."],
  txNoProfile: ['Não encontrei um perfil público com chave E2E para esse destinatário.', 'Não encontrei um perfil público com chave E2E para esse destinatário.', 'No public E2E profile found for that recipient.', 'Aucun profil public E2E trouvé pour ce destinataire.'],
  txSelfRecipient: ['Escolhe outro utilizador como destinatário.', 'Escolha outro utilizador como destinatário.', 'Choose another user as recipient.', 'Choisissez un autre utilisateur comme destinataire.'],
  txResolveFail: ['Não foi possível resolver o destinatário.', 'Não foi possível resolver o destinatário.', 'Could not resolve the recipient.', 'Impossible de résoudre le destinataire.'],
  txAlreadyContact: ['Este perfil já está na tua lista de contactos.', 'Este perfil já está na sua lista de contactos.', 'This profile is already in your contacts.', 'Ce profil est déjà dans vos contacts.'],
  txPendingRequest: ['Já existe um pedido pendente entre vocês.', 'Já existe um pedido pendente entre vocês.', 'A pending request already exists between you.', 'Une demande en attente existe déjà entre vous.'],
  txCopied: ['Copiado para a área de transferência.', 'Copiado para a área de transferência.', 'Copied to the clipboard.', 'Copié dans le presse-papiers.'],
  captureTextLearned: ['Texto gerado e aprendido. Revê e usa Ctrl+Enter para atualizar a memória.', 'Texto gerado e aprendido. Revise e use Ctrl+Enter para atualizar a memória.', 'Text generated and learned. Review it and use Ctrl+Enter to update the memory.', 'Texte généré et appris. Relisez-le et utilisez Ctrl+Entrée pour mettre à jour la mémoire.'],
  captureTextFail: ['Não foi possível gerar texto.', 'Não foi possível gerar texto.', 'Could not generate text.', 'Impossible de générer le texte.'],
  captureImageLearned: ['Imagem gerada e aprendida. Podes editar a nota e enviar para atualizar.', 'Imagem gerada e aprendida. Você pode editar a nota e enviar para atualizar.', 'Image generated and learned. You can edit the note and send to update.', 'Image générée et apprise. Vous pouvez modifier la note et envoyer pour mettre à jour.'],
  captureImageFail: ['Não foi possível gerar a imagem.', 'Não foi possível gerar a imagem.', 'Could not generate the image.', "Impossible de générer l'image."],
  captureLearnUpdated: ['Aprendizagem atualizada.', 'Aprendizagem atualizada.', 'Learning updated.', 'Apprentissage mis à jour.'],
  captureLearnUpdateFail: ['Não foi possível atualizar a memória aprendida.', 'Não foi possível atualizar a memória aprendida.', 'Could not update the learned memory.', 'Impossible de mettre à jour la mémoire apprise.'],
  captureAiPolicyBlock: ['A política atual bloqueia guardar quando a IA configurada falha.', 'A política atual bloqueia salvar quando a IA configurada falha.', 'Current policy blocks saving when the configured AI fails.', "La politique actuelle bloque l'enregistrement quand l'IA configurée échoue."],
  captureFormError: ['Erro ao formar memória.', 'Erro ao formar memória.', 'Error forming memory.', 'Erreur lors de la formation de la mémoire.'],
`;
if (!s.includes(needle)) {
  console.error('needle missing');
  process.exit(1);
}
fs.writeFileSync(p, s.replace(needle, insert));
console.log('ok');
