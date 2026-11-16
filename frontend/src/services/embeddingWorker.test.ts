import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ pipeline: vi.fn(), embed: vi.fn(), env: {
  remotePathTemplate: '{model}/resolve/{revision}/', useWasmCache: true, backends: { onnx: { wasm: { wasmPaths: {}, numThreads: 0 } } },
} }));
vi.mock('@huggingface/transformers', () => ({ env: state.env, pipeline: state.pipeline }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); state.env.remotePathTemplate = '{model}/resolve/{revision}/'; });

it('loads exact pinned weights, validates dimensions and refuses profile changes in one worker', async () => {
  let receive!: (event: { data: unknown }) => void;
  const postMessage = vi.fn();
  vi.stubGlobal('self', { addEventListener: (_name: string, callback: typeof receive) => { receive = callback; }, postMessage });
  state.embed.mockResolvedValue({ data: new Float32Array(384).fill(0.1) });
  state.pipeline.mockResolvedValue(state.embed);
  await import('./embeddingWorker');
  expect(state.env.backends.onnx.wasm.wasmPaths).toEqual({
    wasm: expect.stringContaining('ort-wasm-simd-threaded.asyncify.wasm'),
    mjs: expect.stringContaining('ort-wasm-simd-threaded.asyncify.mjs'),
  });
  expect(state.env.backends.onnx.wasm.numThreads).toBe(1);
  expect(state.env.useWasmCache).toBe(false);
  receive({ data: { id: 1, type: 'embed', profile: 'multilingualCandidate', text: 'synthetic' } });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1, ok: true })));
  expect(state.pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    { revision: '2c4055b12046f11709e9df2c122e59ffbdc2f900', dtype: 'q8' });
  expect(state.embed).toHaveBeenCalledWith('synthetic', { pooling: 'mean', normalize: true });
  expect(state.env.remotePathTemplate).toBe('{model}/resolve/2c4055b12046f11709e9df2c122e59ffbdc2f900/');
  receive({ data: { id: 2, type: 'initialize', profile: 'englishPinned' } });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, ok: false })));
  expect(state.pipeline).toHaveBeenCalledOnce();
  state.embed.mockResolvedValue({ data: new Float32Array(2) });
  receive({ data: { id: 3, type: 'embed', profile: 'multilingualCandidate', text: 'synthetic' } });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, ok: false })));
});

it('pins English profile discovery independently while preserving the explicitly legacy model route', async () => {
  for (const profile of ['englishPinned', undefined] as const) {
    vi.resetModules(); state.pipeline.mockClear(); state.env.remotePathTemplate = '{model}/resolve/{revision}/';
    let receive!: (event: { data: unknown }) => void;
    const postMessage = vi.fn();
    vi.stubGlobal('self', { addEventListener: (_name: string, callback: typeof receive) => { receive = callback; }, postMessage });
    state.pipeline.mockResolvedValue(state.embed);
    await import('./embeddingWorker');
    receive({ data: { id: 1, type: 'initialize', ...(profile ? { profile } : {}) } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ id: 1, ok: true }));
    expect(state.env.remotePathTemplate).toBe(profile ? '{model}/resolve/751bff37182d3f1213fa05d7196b954e230abad9/' : '{model}/resolve/{revision}/');
    expect(state.pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/all-MiniLM-L6-v2', profile ?
      { revision: '751bff37182d3f1213fa05d7196b954e230abad9', dtype: 'q8' } : {});
  }
});

it('refuses a missing local Wasm backend before registering requests or falling back to a CDN', async () => {
  const wasm = state.env.backends.onnx.wasm;
  Reflect.deleteProperty(state.env.backends.onnx, 'wasm');
  const register = vi.fn();
  vi.stubGlobal('self', { addEventListener: register, postMessage: vi.fn() });
  try {
    await expect(import('./embeddingWorker')).rejects.toThrow('The local embedding runtime is unavailable.');
    expect(register).not.toHaveBeenCalled();
    expect(state.pipeline).not.toHaveBeenCalled();
  } finally { state.env.backends.onnx.wasm = wasm; }
});
