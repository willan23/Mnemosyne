import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestGenerationJson, AiGenerationHttpError, AiGenerationTransportError } from './aiGenerationTransport';

const endpoint = 'https://europe-west1-demo-mnemosyne-rules.cloudfunctions.net/generateText';
const headers = async () => ({ Authorization: 'Bearer synthetic-credential', 'Content-Type': 'application/json' });
const signal = () => new AbortController().signal;
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('returns bounded JSON without redirects, cookies, referrer or a retry', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: 'Synthetic answer' })));
  expect(await requestGenerationJson('text', endpoint, { prompt: 'synthetic prompt' }, signal(), headers)).toEqual({ text: 'Synthetic answer' });
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
});
it('does no auth or fetch work for an already cancelled request or invalid bounds', async () => {
  const controller = new AbortController(); controller.abort(); const prepare = vi.fn(headers);
  await expect(requestGenerationJson('text', endpoint, {}, controller.signal, prepare)).rejects.toBeInstanceOf(AiGenerationTransportError);
  for (const bounds of [{ timeoutMs: 0, maxBytes: 10 }, { timeoutMs: 75_001, maxBytes: 10 }, { timeoutMs: 10, maxBytes: 1_048_577 }]) {
    await expect(requestGenerationJson('text', endpoint, {}, signal(), prepare, bounds)).rejects.toBeInstanceOf(AiGenerationTransportError);
  }
  expect(prepare).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('bounds auth preparation and cannot start a request when a late auth promise settles after the deadline', async () => {
  vi.useFakeTimers(); let finish!: (value: Record<string, string>) => void;
  const pending = requestGenerationJson('text', endpoint, {}, signal(), () => new Promise(resolve => { finish = resolve; }), { timeoutMs: 40, maxBytes: 128 });
  const refused = expect(pending).rejects.toBeInstanceOf(AiGenerationTransportError);
  await vi.advanceTimersByTimeAsync(41); await refused; finish(await headers()); await Promise.resolve(); await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('cancels a stalled response body on context revocation and discards late output', async () => {
  const cancel = vi.fn(), controller = new AbortController();
  vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const pending = requestGenerationJson('text', endpoint, {}, controller.signal, headers);
  const refused = expect(pending).rejects.toBeInstanceOf(AiGenerationTransportError);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce()); controller.abort(); await refused;
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
});
it('applies the deadline after headers while the body is still pending', async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const pending = requestGenerationJson('text', endpoint, {}, signal(), headers, { timeoutMs: 50, maxBytes: 128 });
  const refused = expect(pending).rejects.toBeInstanceOf(AiGenerationTransportError);
  await vi.advanceTimersByTimeAsync(51); await refused; expect(cancel).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it.each([true, false])('bounds %s declared or streamed bytes and does not let mutable input raise the budget', async declared => {
  const bounds = { timeoutMs: 500, maxBytes: 16 };
  vi.mocked(fetch).mockImplementation(async () => {
    bounds.maxBytes = 1024;
    return new Response(JSON.stringify({ text: 'Synthetic oversized response' }), { headers: declared ? { 'Content-Length': '5000' } : {} });
  });
  await expect(requestGenerationJson('text', endpoint, {}, signal(), headers, bounds)).rejects.toBeInstanceOf(AiGenerationTransportError);
});
it('retains an HTTP status but never the response body or input in its error', async () => {
  vi.mocked(fetch).mockResolvedValue(new Response('synthetic-private-upstream-body', { status: 503 }));
  const error = await requestGenerationJson('text', endpoint, { prompt: 'synthetic-private-prompt' }, signal(), headers).catch(error => error);
  expect(error).toBeInstanceOf(AiGenerationHttpError); expect(error.status).toBe(503);
  expect(JSON.stringify(error) + String(error)).not.toMatch(/synthetic|credential|prompt|upstream/);
});
it.each(['null', '[]', '{broken', new Uint8Array([255])])('rejects malformed response JSON without including its content', async input => {
  vi.mocked(fetch).mockResolvedValue(new Response(input));
  await expect(requestGenerationJson('text', endpoint, {}, signal(), headers)).rejects.toBeInstanceOf(AiGenerationTransportError);
});
