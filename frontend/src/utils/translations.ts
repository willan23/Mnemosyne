import { useUniverseStore } from '../store/universeStore';

export const translations = {
  'pt-pt': {
    // Geral
    settings: 'Definições',
    close: 'Fechar',
    save: 'Guardar',
    remove: 'Remover',
    active: 'Ativo',
    inactive: 'Inativo',
    loading: 'A carregar...',
    restoringSession: 'A restaurar sessão...',

    // Tabs de Definições
    tabIdentity: 'Identidade',
    tabIdentityDesc: 'Chave, UID e frase',
    tabMobile: 'Mobile Sync',
    tabMobileDesc: 'Android, QR e dispositivos',
    tabUniverse: 'Universo',
    tabUniverseDesc: 'Aparência mental',
    tabAi: 'Inteligências',
    tabAiDesc: 'Modelos e permissões',
    tabIntegrations: 'Integrações',
    tabIntegrationsDesc: 'Desktop e plano',
    tabPrivacy: 'Privacidade',
    tabPrivacyDesc: 'Zero-Knowledge e partilha',
    tabAccount: 'Conta',
    tabAccountDesc: 'Ações irreversíveis',

    // Secção Universo & Idioma
    universeTitle: 'Universo',
    universeDesc: 'Escolhe a linguagem visual com que a tua memória é representada.',
    languageTitle: 'Idioma da Interface',
    languageDesc: 'Escolhe o idioma principal da interface do Mnemosyne.',
    languagePortuguesePT: 'Português (PT)',
    languagePortugueseBR: 'Português (BR)',
    languageEnglish: 'Inglês',
    languageFrench: 'Francês',

    // Compositor Cognitivo (Flow)
    flowTitle: 'Flow',
    flowPlaceholder: 'O que estás a pensar agora?',
    btnMemory: 'Memória',
    btnWeb: 'Web',
    btnImage: 'Imagem',
    btnFiles: 'Ficheiros',
    btnFolders: 'Pastas',
    btnCrystallize: 'Cristalizar pensamento',
    flowSerendipityMemory: 'Guardar memória',
    flowSerendipityWeb: 'Pesquisa web',
    flowSerendipityImage: 'Gerar imagem',
    flowSerendipityFiles: 'Importar ficheiros',
    flowSerendipityFolders: 'Importar pastas',

    // Toasts de Upload / Importação
    organizingFiles: 'A organizar {count} ficheiro(s)...',
    organizingFolders: 'A organizar pasta recursivamente...',
    filesLearnedSuccess: '{count} ficheiro(s) aprendidos e organizados.',
    filesLearnedError: 'Não foi possível importar os ficheiros.',
    foldersLearnedSuccess: '{count} ficheiro(s) da pasta aprendidos e organizados.',
    foldersLearnedError: 'Não foi possível importar a pasta.',
    folderLimitWarning: 'A pasta contém muitos ficheiros. Apenas os primeiros 20 documentos elegíveis serão importados.',
    noFilesFound: 'Nenhum ficheiro elegível encontrado na pasta.',
    localFolderAssimilation: 'Assimilação de Diretório Local',
    localFolderAssimilationDesc: 'Importa uma pasta completa de documentos e código do teu computador para a tua galáxia.',
    selectFolder: 'Selecionar Pasta',
    folderImporting: 'A assimilar diretório...',

    // Badges / Tabs adicionais
    badgeIdentityLocked: 'Bloq.',
    badgeMobileActive: 'ativos',
    badgeMobilePairs: 'pares',
    badgeUniverseGalaxy: 'Galáxia',
    badgeUniverseSolar: 'Sistema Solar',
    badgeUniverseNebula: 'Nebulosa',
    badgeUniverseVoid: 'Buraco Negro',
    badgeIntegrationsFree: 'Grátis',
    badgePrivacySharing: 'Partilha on',
    badgePrivacyPrivate: 'Privado',
    badgeAccountCritical: 'Crítico',

    // Orphaned Memories
    orphanedMemoriesFound: '{count} memórias órfãs encontradas.',
    clean: 'Limpar',
    dismiss: 'Ignorar',
  },
  'pt-br': {
    // Geral
    settings: 'Configurações',
    close: 'Fechar',
    save: 'Salvar',
    remove: 'Remover',
    active: 'Ativo',
    inactive: 'Inativo',
    loading: 'Carregando...',
    restoringSession: 'Restaurando sessão...',

    // Tabs de Definições
    tabIdentity: 'Identidade',
    tabIdentityDesc: 'Chave, UID e frase',
    tabMobile: 'Sincronização Móvel',
    tabMobileDesc: 'Android, QR e dispositivos',
    tabUniverse: 'Universo',
    tabUniverseDesc: 'Aparência mental',
    tabAi: 'Inteligências',
    tabAiDesc: 'Modelos e permissões',
    tabIntegrations: 'Integrações',
    tabIntegrationsDesc: 'Desktop e plano',
    tabPrivacy: 'Privacidade',
    tabPrivacyDesc: 'Zero-Knowledge e compartilhamento',
    tabAccount: 'Conta',
    tabAccountDesc: 'Ações irreversíveis',

    // Secção Universo & Idioma
    universeTitle: 'Universo',
    universeDesc: 'Escolha a linguagem visual com a qual sua memória é representada.',
    languageTitle: 'Idioma da Interface',
    languageDesc: 'Escolha o idioma principal da interface do Mnemosyne.',
    languagePortuguesePT: 'Português (PT)',
    languagePortugueseBR: 'Português (BR)',
    languageEnglish: 'Inglês',
    languageFrench: 'Francês',

    // Compositor Cognitivo (Flow)
    flowTitle: 'Flow',
    flowPlaceholder: 'O que você está pensando agora?',
    btnMemory: 'Memória',
    btnWeb: 'Web',
    btnImage: 'Imagem',
    btnFiles: 'Arquivos',
    btnFolders: 'Pastas',
    btnCrystallize: 'Cristalizar pensamento',
    flowSerendipityMemory: 'Salvar memória',
    flowSerendipityWeb: 'Pesquisa web',
    flowSerendipityImage: 'Gerar imagem',
    flowSerendipityFiles: 'Importar arquivos',
    flowSerendipityFolders: 'Importar pastas',

    // Toasts de Upload / Importação
    organizingFiles: 'Organizando {count} arquivo(s)...',
    organizingFolders: 'Organizando pasta recursivamente...',
    filesLearnedSuccess: '{count} arquivo(s) aprendidos e organizados.',
    filesLearnedError: 'Não foi possível importar os arquivos.',
    foldersLearnedSuccess: '{count} arquivo(s) da pasta aprendidos e organizados.',
    foldersLearnedError: 'Não foi possível importar a pasta.',
    folderLimitWarning: 'A pasta contém muitos arquivos. Apenas os primeiros 20 documentos elegíveis serão importados.',
    noFilesFound: 'Nenhum arquivo elegível encontrado na pasta.',
    localFolderAssimilation: 'Assimilação de Diretório Local',
    localFolderAssimilationDesc: 'Importa uma pasta completa de documentos e código do seu computador para a sua galáxia.',
    selectFolder: 'Selecionar Pasta',
    folderImporting: 'Assimilando diretório...',

    // Badges / Tabs adicionais
    badgeIdentityLocked: 'Bloq.',
    badgeMobileActive: 'ativos',
    badgeMobilePairs: 'pares',
    badgeUniverseGalaxy: 'Galáxia',
    badgeUniverseSolar: 'Sistema Solar',
    badgeUniverseNebula: 'Nebulosa',
    badgeUniverseVoid: 'Buraco Negro',
    badgeIntegrationsFree: 'Grátis',
    badgePrivacySharing: 'Compartilhamento on',
    badgePrivacyPrivate: 'Privado',
    badgeAccountCritical: 'Crítico',

    // Orphaned Memories
    orphanedMemoriesFound: '{count} memórias órfãs encontradas.',
    clean: 'Limpar',
    dismiss: 'Ignorar',
  },
  en: {
    // General
    settings: 'Settings',
    close: 'Close',
    save: 'Save',
    remove: 'Remove',
    active: 'Active',
    inactive: 'Inactive',
    loading: 'Loading...',
    restoringSession: 'Restoring session...',

    // Settings Tabs
    tabIdentity: 'Identity',
    tabIdentityDesc: 'Key, UID and phrase',
    tabMobile: 'Mobile Sync',
    tabMobileDesc: 'Android, QR and devices',
    tabUniverse: 'Universe',
    tabUniverseDesc: 'Mental appearance',
    tabAi: 'Inteligências', // Lucide title / translated
    tabAiDesc: 'Models and permissions',
    tabIntegrations: 'Integrations',
    tabIntegrationsDesc: 'Desktop and plan',
    tabPrivacy: 'Privacy',
    tabPrivacyDesc: 'Zero-Knowledge and sharing',
    tabAccount: 'Account',
    tabAccountDesc: 'Irreversible actions',

    // Universe & Language Section
    universeTitle: 'Universe',
    universeDesc: 'Choose the visual language with which your memory is represented.',
    languageTitle: 'Interface Language',
    languageDesc: 'Choose the primary language for Mnemosyne\'s interface.',
    languagePortuguesePT: 'Portuguese (PT)',
    languagePortugueseBR: 'Portuguese (BR)',
    languageEnglish: 'English',
    languageFrench: 'French',

    // Cognitive Composer (Flow)
    flowTitle: 'Flow',
    flowPlaceholder: 'What is on your mind right now?',
    btnMemory: 'Memory',
    btnWeb: 'Web',
    btnImage: 'Image',
    btnFiles: 'Files',
    btnFolders: 'Folders',
    btnCrystallize: 'Crystallize thought',
    flowSerendipityMemory: 'Save memory',
    flowSerendipityWeb: 'Web search',
    flowSerendipityImage: 'Generate image',
    flowSerendipityFiles: 'Import files',
    flowSerendipityFolders: 'Import folders',

    // Upload / Import Toasts
    organizingFiles: 'Organizing {count} file(s)...',
    organizingFolders: 'Organizing folder recursively...',
    filesLearnedSuccess: '{count} file(s) learned and organized.',
    filesLearnedError: 'Unable to import files.',
    foldersLearnedSuccess: '{count} file(s) from folder learned and organized.',
    foldersLearnedError: 'Unable to import the folder.',
    folderLimitWarning: 'The folder contains too many files. Only the first 20 eligible documents will be imported.',
    noFilesFound: 'No eligible files found in the folder.',
    localFolderAssimilation: 'Local Folder Assimilation',
    localFolderAssimilationDesc: 'Import an entire folder of documents and code from your computer into your galaxy.',
    selectFolder: 'Select Folder',
    folderImporting: 'Assimilating directory...',

    // Badges / Tabs
    badgeIdentityLocked: 'Lock.',
    badgeMobileActive: 'active',
    badgeMobilePairs: 'pairs',
    badgeUniverseGalaxy: 'Galaxy',
    badgeUniverseSolar: 'Solar System',
    badgeUniverseNebula: 'Nebula',
    badgeUniverseVoid: 'Black Hole',
    badgeIntegrationsFree: 'Free',
    badgePrivacySharing: 'Sharing on',
    badgePrivacyPrivate: 'Private',
    badgeAccountCritical: 'Critical',

    // Orphaned Memories
    orphanedMemoriesFound: '{count} orphaned memories found.',
    clean: 'Clean',
    dismiss: 'Dismiss',
  },
  fr: {
    // General
    settings: 'Paramètres',
    close: 'Fermer',
    save: 'Enregistrer',
    remove: 'Supprimer',
    active: 'Actif',
    inactive: 'Inactif',
    loading: 'Chargement...',
    restoringSession: 'Restauration de la session...',

    // Settings Tabs
    tabIdentity: 'Identité',
    tabIdentityDesc: 'Clé, UID et phrase de récupération',
    tabMobile: 'Sync Mobile',
    tabMobileDesc: 'Android, QR et appareils',
    tabUniverse: 'Univers',
    tabUniverseDesc: 'Apparence mentale',
    tabAi: 'Intelligence',
    tabAiDesc: 'Modèles et autorisations',
    tabIntegrations: 'Intégrations',
    tabIntegrationsDesc: 'Bureau et formule',
    tabPrivacy: 'Confidentialité',
    tabPrivacyDesc: 'Zero-Knowledge et partage',
    tabAccount: 'Compte',
    tabAccountDesc: 'Actions irréversibles',

    // Universe & Language Section
    universeTitle: 'Univers',
    universeDesc: 'Choisissez le langage visuel par lequel votre mémoire est représentée.',
    languageTitle: 'Langue de l\'interface',
    languageDesc: 'Choisissez la langue principale de l\'interface de Mnemosyne.',
    languagePortuguesePT: 'Portugais (PT)',
    languagePortugueseBR: 'Portugais (BR)',
    languageEnglish: 'Anglais',
    languageFrench: 'Français',

    // Cognitive Composer (Flow)
    flowTitle: 'Flux',
    flowPlaceholder: 'À quoi pensez-vous en ce moment ?',
    btnMemory: 'Mémoire',
    btnWeb: 'Web',
    btnImage: 'Image',
    btnFiles: 'Fichiers',
    btnFolders: 'Dossiers',
    btnCrystallize: 'Cristalliser la pensée',
    flowSerendipityMemory: 'Enregistrer la mémoire',
    flowSerendipityWeb: 'Recherche web',
    flowSerendipityImage: 'Générer une image',
    flowSerendipityFiles: 'Importer des fichiers',
    flowSerendipityFolders: 'Importer des dossiers',

    // Upload / Import Toasts
    organizingFiles: 'Organisation de {count} fichier(s)...',
    organizingFolders: 'Organisation récursive du dossier...',
    filesLearnedSuccess: '{count} fichier(s) appris et organisés.',
    filesLearnedError: 'Impossible d\'importer les fichiers.',
    foldersLearnedSuccess: '{count} fichier(s) du dossier appris et organisés.',
    foldersLearnedError: 'Impossible d\'importer le dossier.',
    folderLimitWarning: 'Le dossier contient trop de fichiers. Seuls les 20 premiers documents éligibles seront importés.',
    noFilesFound: 'Aucun fichier éligible trouvé dans le dossier.',
    localFolderAssimilation: 'Assimilation de dossier local',
    localFolderAssimilationDesc: 'Importez un dossier entier de documents et de code de votre ordinateur dans votre galaxie.',
    selectFolder: 'Sélectionner un dossier',
    folderImporting: 'Assimilation du dossier...',

    // Badges / Tabs
    badgeIdentityLocked: 'Bloqué',
    badgeMobileActive: 'actifs',
    badgeMobilePairs: 'paires',
    badgeUniverseGalaxy: 'Galaxie',
    badgeUniverseSolar: 'Système Solaire',
    badgeUniverseNebula: 'Nébuleuse',
    badgeUniverseVoid: 'Trou Noir',
    badgeIntegrationsFree: 'Gratuit',
    badgePrivacySharing: 'Partage actif',
    badgePrivacyPrivate: 'Privé',
    badgeAccountCritical: 'Critique',

    // Orphaned Memories
    orphanedMemoriesFound: '{count} mémoires orphelines trouvées.',
    clean: 'Nettoyer',
    dismiss: 'Ignorer',
  }
};

export type TranslationKey = keyof typeof translations['pt-pt'];

export const useTranslation = () => {
  const language = useUniverseStore((state) => state.language) || 'pt-pt';
  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    const lang = (translations[language] ? language : 'pt-pt') as keyof typeof translations;
    let text = translations[lang]?.[key] || translations['pt-pt'][key] || String(key);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  };
  return { t, language };
};
