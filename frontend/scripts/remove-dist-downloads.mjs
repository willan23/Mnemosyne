import { rm } from 'node:fs/promises';

await rm(new URL('../dist/downloads', import.meta.url), {
  recursive: true,
  force: true,
});
