/**
 * Assimila o Starter Founder in-app → memórias E2EE na conta do utilizador.
 */

import type { SessionData } from '../hooks/useSessions';
import {
  STARTER_FOUNDER_ID,
  STARTER_FOUNDER_NOTES,
  STARTER_FOUNDER_TITLE,
} from '../data/starterFounder';
import { importParsedObsidianNotes, type ObsidianVaultImportResult } from './obsidianVaultImport';
import { parseObsidianMarkdown, type ParsedObsidianNote } from './obsidianVaultParse';
import {hasAssimilatedStarter} from './starterAssimilationState';
import {withPersonalMemoryMutation} from './personalMemoryMutation';
export {hasAssimilatedStarter,markStarterAssimilated} from './starterAssimilationState';

/** Parse do seed in-app (sem File — fiável em browser e testes). */
export function parseStarterFounderNotes(
  notes = STARTER_FOUNDER_NOTES,
  rootFolder = STARTER_FOUNDER_TITLE,
): ParsedObsidianNote[] {
  return notes.map((seed) =>
    parseObsidianMarkdown(`${rootFolder}/${seed.path}`.replace(/\\/g, '/'), seed.markdown),
  );
}

/** Converte o seed in-app em File[] (para export/ZIP futuro). */
export function starterNotesToFiles(
  notes = STARTER_FOUNDER_NOTES,
  rootFolder = STARTER_FOUNDER_TITLE,
): File[] {
  return notes.map((seed) => {
    const relative = `${rootFolder}/${seed.path}`.replace(/\\/g, '/');
    const fileName = relative.split('/').pop() || 'note.md';
    const bytes = new TextEncoder().encode(seed.markdown);
    const file = new File([bytes], fileName, {
      type: 'text/markdown',
      lastModified: Date.now(),
    });
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relative,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    return file;
  });
}

export async function assimilateStarterFounder(
  uid: string,
  existingMemories: SessionData[] = [],
  options?: { onProgress?: (done: number, total: number) => void; force?: boolean; assertCurrent?:()=>void },
): Promise<ObsidianVaultImportResult & { starterId: string }> {
  return withPersonalMemoryMutation(uid,async context=>{
  const guard=()=>{context.assertCurrent();options?.assertCurrent?.();};guard();
  if (!options?.force && hasAssimilatedStarter(uid)) {
    throw new Error(
      'Já assimilaste o Starter Founder neste browser. Usa Importar vault se quiseres outro céu.',
    );
  }

  const notes = parseStarterFounderNotes();
  const result = await importParsedObsidianNotes(uid, notes, existingMemories, {
    onProgress: options?.onProgress,
    sourceTag: 'starter-universe',
    batchPrefix: 'starter',
    assertCurrent:guard,
  });

  guard();
  return { ...result, starterId: STARTER_FOUNDER_ID };
  });
}

export { STARTER_FOUNDER_ID, STARTER_FOUNDER_TITLE, STARTER_FOUNDER_NOTES };
