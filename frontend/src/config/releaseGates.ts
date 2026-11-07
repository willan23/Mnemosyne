/** Team writes stay closed until epoch migration, historical re-encryption and the release pilot are verified. */
export const TEAM_WRITES_ENABLED = false;
/** Agent proposals open with reviewed consent, client diffs, receipts and the server admission. */
export const AGENT_MUTATION_WRITES_ENABLED = false;
/** Historical maintenance requires a separate pilot and server switch. */
export const TEAM_HISTORY_REENCRYPTION_ENABLED = false;

export const TEAM_READ_ONLY_MESSAGE =
  'Equipas em modo de leitura. Novas memórias, convites e alterações aguardam a validação completa da rotação e migração de chaves.';

/** New attachments stay closed until uploads and read URLs have a safe content policy. */
export const ATTACHMENT_WRITES_ENABLED = false;
/** Account cleanup remains closed until shared writers, legacy ownership and retention are verified. */
export const ACCOUNT_DELETION_ENABLED = false;
/** Team deletion remains closed until object retention and recovery pilots are verified. */
export const TEAM_DELETION_ENABLED = false;
/** Clip receipt/journal creation opens only with the verified callable and device recovery rollout. */
export const CLIP_CAPTURE_ENABLED = false;
/** Sync imports open only with transactional receipts/quota, prepared clients and device recovery. */
export const MOBILE_SYNC_WRITES_ENABLED = false;
/** Device enrollment opens only with recoverable private keys and the server/rules cutover. */
export const MOBILE_PAIRING_ENABLED = false;
/** Personal reciprocal changes open with the atomic callable and encrypted recovery journal. */
export const PERSONAL_CONNECTION_WRITES_ENABLED = false;
/** Complete Obsidian/starter import opens with its encrypted plan and transactional progress. */
export const OBSIDIAN_IMPORT_WRITES_ENABLED = false;
export const CAPSULE_IMPORT_WRITES_ENABLED = false;
/** Whole document imports open with their encrypted file/plan journals and transactional recovery. */
export const DOCUMENT_IMPORT_WRITES_ENABLED = false;
/** Personal text creation opens with stable IDs, atomic usage receipts and encrypted recovery. */
export const PERSONAL_MEMORY_CREATION_ENABLED = false;
/** Personal revisions open with encrypted requests, draft baselines and receipt recovery. */
export const PERSONAL_REVISION_WRITES_ENABLED = false;
/** Identity regeneration opens with the encrypted old/new key journal and remote receipt recovery. */
export const COMMS_IDENTITY_ROLLOVERS_ENABLED = false;
/** Bootstrap/profile refresh opens only with the actor-bound server publication and coordinated SDK cutover. */
export const COMMS_IDENTITY_PUBLICATION_ENABLED = false;
/** Contact mutations open with authenticated discovery, receipts, budgets and recovery. */
export const COMMS_CONTACT_WRITES_ENABLED = false;
/** Relay sends require the encrypted pending journal, server admission and receipt recovery. */
export const COMMS_DELIVERY_WRITES_ENABLED = false;
/** P2P opens separately after durable confirmation, fragmentation and signaling admission. */
export const COMMS_P2P_WRITES_ENABLED = false;
/** Public copies open only with server publication, owner withdrawal and retention verified. */
export const CAPSULE_PUBLICATION_ENABLED = false;

export const ATTACHMENT_READ_ONLY_MESSAGE =
  'Novos anexos estão suspensos neste lançamento. Os ficheiros existentes continuam disponíveis; o upload aguarda cifra do cofre, validação de conteúdo e URLs de leitura sem token persistente.';
