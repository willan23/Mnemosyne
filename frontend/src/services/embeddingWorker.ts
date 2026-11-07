import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import onnxWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import onnxModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import { LEGACY_EMBEDDING_MODEL } from './embeddingModel';
import { embeddingProfile, type EmbeddingProfileId } from './embeddingProfile';
import type { EmbeddingWorkerRequest, EmbeddingWorkerResponse } from './embeddingWorkerProtocol';

// Only model files are fetched. Memory text stays in this local worker.
env.allowLocalModels = false;
env.allowRemoteModels = true;
// Transformers.js' extra Wasm cache rewrites the runtime as a Blob module.
// App assets already have versioned URLs; keep execution on those same-origin URLs.
env.useWasmCache = false;
// Ship the matching executable runtime with the app. The native CSP permits
// model data from Hugging Face, but never executable modules from a public CDN.
const onnxWasm = env.backends.onnx.wasm;
if (!onnxWasm) throw new Error('The local embedding runtime is unavailable.');
// The embedding already owns a Worker. Avoid nested pthread/Blob module imports
// on clients without cross-origin isolation, including the desktop WebView.
onnxWasm.numThreads = 1;
onnxWasm.wasmPaths = {
  wasm: new URL(onnxWasmUrl, import.meta.url).href,
  mjs: new URL(onnxModuleUrl, import.meta.url).href,
};

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let queue: Promise<void> = Promise.resolve();
let selectedProfile: EmbeddingProfileId | 'legacy' | null = null;

const extractor = (profileId?: EmbeddingProfileId) => {
  const requested = profileId ?? 'legacy';
  if (selectedProfile !== null && selectedProfile !== requested) throw new Error('Embedding profile mismatch');
  selectedProfile = requested;
  const profile = profileId ? embeddingProfile(profileId) : null;
  if (!extractorPromise) {
    // Transformers.js 4.3 discovers tokenizer/config files without forwarding
    // revision. A worker owns one profile: pin discovery as well as the weights.
    if (profile) env.remotePathTemplate = `{model}/resolve/${profile.revision}/`;
    extractorPromise = pipeline('feature-extraction', profile?.modelId ?? LEGACY_EMBEDDING_MODEL,
      profile ? { revision: profile.revision, dtype: 'q8' } : {}).catch((error) => {
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
};

self.addEventListener('message', (event: MessageEvent<EmbeddingWorkerRequest>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: EmbeddingWorkerResponse;
    try {
      const embedder = await extractor(request.profile);
      if (request.type === 'initialize') {
        response = { id: request.id, ok: true };
      } else {
        const output = await embedder(request.text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data as Float32Array);
        const expectedDimensions = request.profile ? embeddingProfile(request.profile).dimensions : null;
        if (!embedding.length || !embedding.every(Number.isFinite) ||
            (expectedDimensions !== null && embedding.length !== expectedDimensions)) {
          throw new Error('Invalid embedding');
        }
        response = { id: request.id, ok: true, embedding };
      }
    } catch {
      response = {
        id: request.id,
        ok: false,
        error: request.type === 'initialize'
          ? 'Falha ao carregar o modelo local de embeddings.'
          : 'Falha ao gerar o embedding local.',
      };
    }
    self.postMessage(response);
  });
});
