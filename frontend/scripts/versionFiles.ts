import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Avoids truncating a live manifest and leaves the previous bytes intact if replacement fails. */
export function writeVersionFile(file: string, json: string): void {
  try { if (fs.readFileSync(file, 'utf8') === json) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const directory = dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.version-${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let created = false, failed = false, failure: unknown;
  try {
    descriptor = fs.openSync(temporary, 'wx'); created = true;
    fs.writeFileSync(descriptor, json, 'utf8');
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (error) { failed = true; failure = error; }
  if (descriptor !== undefined) {
    try { fs.closeSync(descriptor); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (created) {
    try { fs.unlinkSync(temporary); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !failed) { failed = true; failure = error; }
    }
  }
  if (failed) throw failure;
}
