import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withAiGenerationContext, AiGenerationContextError, type AiGenerationContext, type AiGenerationContextDeps } from './aiGenerationContext';
import { generateImageFromPrompt, generateTextFromPrompt } from './aiGenerationService';
import type { TeamRecord } from './teamsService';
import * as providerPolicy from '../../../functions/src/generationProviderPolicy';

const state = vi.hoisted(() => ({ headers: vi.fn(), provider: 'openai', nvidiaModel: '' }));
vi.mock('../firebase', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('./memoryCrypto', () => ({ isMemoryCryptoReady: () => true, onMemoryCryptoChanged: vi.fn() }));
vi.mock('./teamVault', () => ({ getTeamKeyCacheGeneration: () => 0, onTeamKeyChanged: vi.fn() }));
vi.mock('./teamsService', () => ({ parseTeam: vi.fn() }));
vi.mock('./authHttp', () => ({ getAuthJsonHeaders: () => state.headers() }));
vi.mock('./localAiConfig', () => ({ getLocalAiConfig: () => ({ primaryProvider: state.provider, memoryPermission: 'allow-cloud',
  providers: { openrouter: { model: 'openrouter-gemma-4-free' }, nvidia: { model: state.nvidiaModel }, openai: { model: 'openai-mini' }, gemini: { model: 'gemini-flash' }, ollama: { model: 'synthetic-local', endpoint: 'http://localhost:11434' } } }) }));

function fixture() {
  const team = { id: 'synthetic-team', ownerUid: 'alice', memberUids: ['alice', 'bob'], keyRotationStatus: 'active',
    activeKeyEpoch: 1, activeKeyId: '11111111-1111-4111-8111-111111111111', wrappedKeys: { alice: {}, bob: {} } } as unknown as TeamRecord;
  const current = { uid: 'alice', ready: true, policy: 'allow-cloud', generation: 0, team: team as TeamRecord | null };
  let changed = () => {}; const stop = vi.fn();
  const deps: AiGenerationContextDeps = { uid: () => current.uid, ready: () => current.ready, policy: () => current.policy,
    generation: () => current.generation, team: vi.fn(async () => current.team), subscribe: callback => { changed = callback; return stop; } };
  return { current, deps, changed: () => changed(), stop };
}
beforeEach(() => {
  // These lifecycle tests exercise the retained adapter under an explicit future OpenAI configuration.
  vi.spyOn(providerPolicy, 'isGenerationProviderEnabled').mockReturnValue(true);
  state.provider = 'openai'; state.nvidiaModel = ''; state.headers.mockReset().mockResolvedValue({ 'Content-Type': 'application/json' }); vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('captures immutable personal scope and closes the context after persistence', async () => {
  const f = fixture(); let saved: AiGenerationContext | undefined;
  const result = await withAiGenerationContext({ uid: 'alice' }, async context => { saved = context; await context.assertAccess(); return 'synthetic-result'; }, f.deps);
  expect(result).toBe('synthetic-result'); expect(saved!.scope).toEqual({ kind: 'personal' });
  expect(Object.isFrozen(saved!.scope)).toBe(true); expect(f.stop).toHaveBeenCalledOnce();
  expect(() => saved!.assertCurrent()).toThrow(AiGenerationContextError);
});
it('latches an account switch away and back and aborts the operation', async () => {
  const f = fixture(); const persist = vi.fn(); let signal: AbortSignal | undefined;
  await expect(withAiGenerationContext({}, async context => {
    signal = context.signal; f.current.uid = 'bob'; f.changed(); f.current.uid = 'alice';
    await context.assertAccess(); persist();
  }, f.deps)).rejects.toThrow(AiGenerationContextError);
  expect(signal!.aborted).toBe(true); expect(persist).not.toHaveBeenCalled(); expect(f.stop).toHaveBeenCalledOnce();
});
it('rejects vault lock, policy change and team cache invalidation before returning output', async () => {
  for (const change of ['lock', 'policy', 'cache']) {
    const f = fixture();
    await expect(withAiGenerationContext({ teamId: 'synthetic-team' }, async () => {
      if (change === 'lock') f.current.ready = false;
      if (change === 'policy') f.current.policy = 'never-cloud';
      if (change === 'cache') f.current.generation++;
      return 'synthetic-output';
    }, f.deps)).rejects.toThrow(AiGenerationContextError);
  }
});
it('requires current membership and epoch throughout team generation', async () => {
  for (const change of ['removed', 'rotating', 'epoch', 'missing']) {
    const f = fixture();
    await expect(withAiGenerationContext({ uid: 'alice', teamId: 'synthetic-team' }, async context => {
      expect(context.scope).toEqual({ kind: 'team', teamId: 'synthetic-team', keyEpoch: 1, keyId: '11111111-1111-4111-8111-111111111111' });
      if (change === 'removed') f.current.team!.memberUids = ['bob'];
      if (change === 'rotating') f.current.team!.keyRotationStatus = 'rotation_pending';
      if (change === 'epoch') f.current.team!.activeKeyEpoch = 2;
      if (change === 'missing') f.current.team = null;
      return 'synthetic-output';
    }, f.deps)).rejects.toThrow(AiGenerationContextError);
  }
});
it('does not fall back to personal scope for invalid or unavailable team destinations', async () => {
  const work = vi.fn(); const f = fixture();
  for (const input of [{ uid: 'bob' }, { teamId: '' }, { teamId: 'bad/path' }]) {
    await expect(withAiGenerationContext(input, work, f.deps)).rejects.toThrow(AiGenerationContextError);
  }
  f.current.team!.activeKeyId = 'bad/key';
  await expect(withAiGenerationContext({ teamId: 'synthetic-team' }, work, f.deps)).rejects.toThrow(AiGenerationContextError);
  expect(work).not.toHaveBeenCalled();
});
it('sends the captured actor and team epoch with text generation', async () => {
  const f = fixture(); vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: 'Synthetic answer' }), { status: 200 }));
  expect(await withAiGenerationContext({ teamId: 'synthetic-team' }, context => generateTextFromPrompt('Synthetic prompt', { context }), f.deps)).toBe('Synthetic answer');
  const request = vi.mocked(fetch).mock.calls[0][1]!;
  expect(JSON.parse(request.body as string)).toEqual({ prompt: 'Synthetic prompt', model: 'openai-mini', expectedUid: 'alice',
    scope: { kind: 'team', teamId: 'synthetic-team', keyEpoch: 1, keyId: '11111111-1111-4111-8111-111111111111' } });
  expect(request.signal).toBeInstanceOf(AbortSignal);
});
it('does zero provider requests when auth headers race with an account switch', async () => {
  const f = fixture(); state.headers.mockImplementation(async () => { f.current.uid = 'bob'; f.changed(); return {}; });
  await expect(withAiGenerationContext({}, context => generateTextFromPrompt('Synthetic prompt', { context }), f.deps)).rejects.toThrow(AiGenerationContextError);
  expect(fetch).not.toHaveBeenCalled();
});

it('sends the explicit Ultra ID for new NVIDIA configurations and never retries Super on failure', async () => {
  state.provider = 'nvidia'; const f = fixture();
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: 'Synthetic answer' }), { status: 200 }));
  await withAiGenerationContext({}, context => generateTextFromPrompt('Synthetic prompt', { context }), f.deps);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).model).toBe('nvidia-nemotron-ultra');
  vi.mocked(fetch).mockClear(); state.nvidiaModel = 'nvidia-nemotron';
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 404 }));
  await expect(withAiGenerationContext({}, context => generateTextFromPrompt('Synthetic prompt', { context }), f.deps)).rejects.toThrow(/404/);
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).model).toBe('nvidia-nemotron');
});
it('sends only the server free-model ID with the captured scope and never falls back after a limit', async () => {
  state.provider = 'openrouter'; const f = fixture();
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: 'Synthetic free answer' }), { status: 200 }));
  await withAiGenerationContext({ teamId: 'synthetic-team' }, context => generateTextFromPrompt('Synthetic prompt', { context }), f.deps);
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body.model).toBe('openrouter-gemma-4-free'); expect(body.scope).toMatchObject({ kind: 'team', teamId: 'synthetic-team' });
  expect(body.expectedUid).toBe('alice');
  vi.mocked(fetch).mockClear(); vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 429 }));
  await expect(withAiGenerationContext({}, context => generateTextFromPrompt('Synthetic prompt', { context }), f.deps)).rejects.toThrow(/429/);
  expect(fetch).toHaveBeenCalledOnce(); expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).model).toBe('openrouter-gemma-4-free');
  vi.mocked(fetch).mockClear();
  await expect(withAiGenerationContext({}, context => generateImageFromPrompt('Synthetic image', { context }), f.deps)).rejects.toThrow(/gera texto/);
  expect(fetch).not.toHaveBeenCalled();
});
it('discards a delayed response after revocation and never persists it', async () => {
  const f = fixture(); const persist = vi.fn();
  vi.mocked(fetch).mockImplementation(async () => new Response(new ReadableStream({ pull(controller) {
    f.current.team!.memberUids = ['bob']; controller.enqueue(new TextEncoder().encode(JSON.stringify({ text: 'Synthetic answer' }))); controller.close();
  } }), { headers: { 'Content-Type': 'application/json' } }));
  await expect(withAiGenerationContext({ teamId: 'synthetic-team' }, async context => {
    const output = await generateTextFromPrompt('Synthetic prompt', { context }); persist(output);
  }, f.deps)).rejects.toThrow(AiGenerationContextError);
  expect(fetch).toHaveBeenCalledOnce(); expect(persist).not.toHaveBeenCalled();
});
it('rejects provider URLs and preserves scope for image bytes', async () => {
  const f = fixture();
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ image_url: 'https://synthetic.invalid/?prompt=private' }), { status: 200 }));
  await expect(withAiGenerationContext({}, context => generateImageFromPrompt('Synthetic image', { context }), f.deps)).rejects.toThrow(/bytes/);
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ image_base64: 'c3ludGhldGlj', provider: 'synthetic-provider' }), { status: 200 }));
  const result = await withAiGenerationContext({ teamId: 'synthetic-team' }, context => generateImageFromPrompt('Synthetic image', { context }), f.deps);
  expect(result.dataUrl).toBe('data:image/png;base64,c3ludGhldGlj'); expect(result.imageUrl).toBeUndefined();
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).scope.kind).toBe('team');
});
it('applies the account lifecycle to local Ollama without sending cloud scope or credentials', async () => {
  state.provider = 'ollama'; const f = fixture();
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ response: 'Synthetic local answer' }), { status: 200 }));
  expect(await withAiGenerationContext({}, context => generateTextFromPrompt('Synthetic local prompt', { context }), f.deps)).toBe('Synthetic local answer');
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ model: 'synthetic-local', prompt: 'Synthetic local prompt', stream: false });
  expect(state.headers).not.toHaveBeenCalled();
});

it('preserves captured scope for future Gemini text and images while choosing the corresponding server model', async () => {
  state.provider = 'gemini'; const f = fixture();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Synthetic Gemini answer' }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ image_base64: 'c3ludGhldGlj', provider: 'gemini' }), { status: 200 }));
  await withAiGenerationContext({ teamId: 'synthetic-team' }, context => generateTextFromPrompt('Synthetic prompt', { context }), f.deps);
  await withAiGenerationContext({ teamId: 'synthetic-team' }, context => generateImageFromPrompt('Synthetic image', { context }), f.deps);
  const bodies = vi.mocked(fetch).mock.calls.map(call => JSON.parse(call[1]!.body as string));
  expect(bodies.map(body => body.model)).toEqual(['gemini-flash', 'gemini-image']);
  expect(bodies.every(body => body.expectedUid === 'alice' && body.scope.kind === 'team' && body.scope.teamId === 'synthetic-team')).toBe(true);
});
