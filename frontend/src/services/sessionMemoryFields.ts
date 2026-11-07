/**
 * Branch de leitura/escrita de sessões: pessoal (mnemónica) vs equipa (teamKey).
 *
 * Documentos com `teamId` NUNCA passam por memoryCrypto pessoal — a teamKey
 * é outra chave. Sem unwrap, o doc fica encLocked sem corromper o envelope.
 */

import {
  buildEncryptedMemoryFields,
  resolveMemoryDocFields,
  type EncryptedMemoryDocFields,
  type ResolvedMemoryFields,
} from './memoryCrypto';
import {
  buildTeamMemoryDocFields,
  decryptTeamMemoryEnvelope,
  getCachedTeamKey,
  isTeamMemoryEnvelope,
  type TeamMemoryEnvelope,
  type TeamMemoryFields,
} from './teamVault';
import { TEAM_WRITES_ENABLED, TEAM_READ_ONLY_MESSAGE } from '../config/releaseGates';

export const TEAM_LOCKED_PLACEHOLDER =
  'Memória de equipa cifrada — desbloqueia a mnemónica e aceita o convite para a teamKey.';

export type SessionWriteFields = (EncryptedMemoryDocFields & { teamId: null }) | TeamMemoryFields;

export function parseSessionTeamId(data: Record<string, unknown>): string | null {
  return typeof data.teamId === 'string' && data.teamId.trim()
    ? data.teamId.trim()
    : null;
}

export function sessionWriteMode(teamId?: string | null): 'team' | 'personal' {
  return typeof teamId === 'string' && teamId.trim() ? 'team' : 'personal';
}

/**
 * Resolve text/title de um doc `sessions`.
 * Equipa: só teamKey (cache ou `options.teamKey`). Pessoal: memoryCrypto.
 */
export async function resolveSessionSecretFields(
  data: Record<string, unknown>,
  options?: { teamKey?: CryptoKey | null },
): Promise<ResolvedMemoryFields> {
  const teamId = parseSessionTeamId(data);
  if (!teamId) {
    return resolveMemoryDocFields(data);
  }

  const envelope = data.enc;
  const epoch = Number.isSafeInteger(data.keyEpoch) && (data.keyEpoch as number) >= 1
    ? data.keyEpoch as number : envelope && typeof envelope === 'object' &&
      (envelope as { v?: unknown }).v === 1 ? 1 : null;
  const keyId = typeof data.keyId === 'string' && data.keyId.trim() ? data.keyId : null;
  const teamKey = options && 'teamKey' in options
    ? options.teamKey ?? null
    : epoch === null ? null : getCachedTeamKey(teamId, epoch);

  if (!isTeamMemoryEnvelope(envelope) || !teamKey || epoch === null ||
      (envelope.v === 2 && !keyId)) {
    return {
      text: TEAM_LOCKED_PLACEHOLDER,
      title: undefined,
      encrypted: true,
      locked: true,
    };
  }

  try {
    const fields = await decryptTeamMemoryEnvelope(teamKey, envelope as TeamMemoryEnvelope,
      envelope.v === 2 && keyId ? { teamId, keyEpoch: epoch, keyId } : undefined);
    return {
      text: fields.text,
      title: fields.title ?? undefined,
      encrypted: true,
      locked: false,
    };
  } catch {
    return {
      text: TEAM_LOCKED_PLACEHOLDER,
      title: undefined,
      encrypted: true,
      locked: true,
    };
  }
}

export async function buildSessionWriteFields(input: {
  text: string;
  title?: string | null;
  teamId?: string | null;
  teamKey?: CryptoKey | null;
  keyEpoch?: number;
  keyId?: string;
}): Promise<SessionWriteFields> {
  const teamId = parseSessionTeamId({ teamId: input.teamId ?? null });
  if (!teamId) {
    return { ...await buildEncryptedMemoryFields(input.text, input.title), teamId: null };
  }
  if (!TEAM_WRITES_ENABLED) {
    throw new Error(TEAM_READ_ONLY_MESSAGE);
  }
  if (!input.teamKey) {
    throw new Error('TeamKey necessária para gravar numa equipa.');
  }
  return buildTeamMemoryDocFields(teamId, input.teamKey, input.text, input.title,
    input.keyEpoch, input.keyId);
}
