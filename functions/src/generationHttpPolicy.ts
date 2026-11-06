/** Public timing/routing contract. No SDKs, credentials or environment access. */
export type GenerationHttpKind = 'text' | 'image';
export const GENERATION_HTTP_POLICY = Object.freeze({
  text: Object.freeze({ providerTimeoutMs: 30_000, functionTimeoutSeconds: 60, clientTimeoutMs: 75_000, maxResponseBytes: 1_048_576 }),
  image: Object.freeze({ providerTimeoutMs: 120_000, functionTimeoutSeconds: 150, clientTimeoutMs: 180_000, maxResponseBytes: 17 * 1024 * 1024 }),
});
export const GENERATION_HTTP_FUNCTIONS = Object.freeze({ text: 'generateText', image: 'generateImage' });
export interface GenerationEndpointConfig { projectId?: string; development?: boolean; emulatorOrigin?: string }

export function generationFunctionsBase(config: GenerationEndpointConfig = {}): string {
  const project = config.projectId ?? 'mnemosyne-one';
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error('Projeto Firebase de geração inválido.');
  if (config.emulatorOrigin) {
    if (!config.development) throw new Error('O emulador de geração não pode ser usado num build de produção.');
    let url: URL;
    try { url = new URL(config.emulatorOrigin); } catch { throw new Error('Origem do emulador de geração inválida.'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Origem do emulador de geração inválida.');
    return `${url.origin}/${project}/europe-west1`;
  }
  return `https://europe-west1-${project}.cloudfunctions.net`;
}

export function generationFunctionUrl(kind: GenerationHttpKind, config: GenerationEndpointConfig = {}): string {
  if (kind !== 'text' && kind !== 'image') throw new Error('Tipo de geração inválido.');
  return `${generationFunctionsBase(config)}/${GENERATION_HTTP_FUNCTIONS[kind]}`;
}
