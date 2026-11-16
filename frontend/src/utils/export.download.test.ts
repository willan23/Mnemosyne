import { afterEach, expect, it, vi } from 'vitest';
import { downloadAttachmentFile } from './export';
afterEach(() => { vi.unstubAllGlobals(); });
it('does not initiate a browser download if the vault/view context changed while fetching', async () => {
  let ready = true; let finish!: (value: Blob) => void;
  const blob = new Promise<Blob>(resolve => { finish = resolve; });
  const fetcher = vi.fn().mockResolvedValue({ ok: true, blob: () => blob }); vi.stubGlobal('fetch', fetcher);
  const createUrl = vi.fn(); vi.stubGlobal('URL', { createObjectURL: createUrl });
  const pending = downloadAttachmentFile('https://storage.googleapis.com/synthetic/safe', 'synthetic.pdf', { guard: () => ready });
  await Promise.resolve(); ready = false; finish(new Blob(['synthetic']));
  await expect(pending).rejects.toThrow('Não foi possível descarregar o anexo.'); expect(createUrl).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledWith('https://storage.googleapis.com/synthetic/safe', { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' });
});
