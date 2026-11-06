import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeCloudUse, decideCloudUse, isLoopbackEndpoint } from './cloudUsePolicy';
import { generateImageFromPrompt, generateTextFromPrompt } from './aiGenerationService';
import { runWebResearch } from './webResearchService';
import * as providerPolicy from '../../../functions/src/generationProviderPolicy';

vi.mock('./authHttp', () => ({ AuthHttpError: class extends Error {}, getAuthJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })) }));

const summary = { bytes: 42, containsMemory: true, containsAttachment: false, containsPrompt: true };

function setPolicy(memoryPermission: 'never-cloud' | 'confirm-cloud' | 'allow-cloud'): void {
  // Retained NVIDIA text/image adapters require an explicit future configuration.
  vi.spyOn(providerPolicy, 'isGenerationProviderEnabled').mockReturnValue(true);
  localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({
    primaryProvider: 'nvidia',
    memoryPermission,
    providers: { nvidia: { model: 'meta/llama-3.1-70b-instruct' } },
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('cloud use policy', () => {
  it('nega e pede consentimento conforme a política, sem conteúdo no evento', () => {
    const request = { purpose: 'extraction' as const, provider: 'fornecedor', payloadSummary: summary, policy: 'never-cloud' as const };
    expect(decideCloudUse(request)).toBe('deny');
    expect(decideCloudUse({ ...request, policy: 'unexpected' as never })).toBe('deny');
    const confirmUse = vi.fn(() => true);
    expect(() => authorizeCloudUse(request, confirmUse)).toThrow(/política de privacidade/);
    expect(confirmUse).not.toHaveBeenCalled();
    expect(decideCloudUse({ ...request, policy: 'confirm-cloud' })).toBe('require-confirmation');
    expect(() => authorizeCloudUse({ ...request, policy: 'confirm-cloud' }, () => false)).toThrow(/cancelada/);
    expect(isLoopbackEndpoint('http://localhost:11434')).toBe(true);
    expect(isLoopbackEndpoint('https://ollama.example')).toBe(false);
  });

  it('faz zero pedidos para texto, imagem e pesquisa em never-cloud', async () => {
    setPolicy('never-cloud');
    await expect(generateTextFromPrompt('texto privado')).rejects.toThrow(/política de privacidade/);
    await expect(generateImageFromPrompt('imagem privada')).rejects.toThrow(/política de privacidade/);
    await expect(runWebResearch({ query: 'pesquisa privada', mode: 'contextual', context: ['memória privada'] }))
      .rejects.toThrow(/política de privacidade/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('não envia prompts com uma política persistida desconhecida', async () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({
      primaryProvider: 'openrouter',
      memoryPermission: 'unexpected-cloud-policy',
    }));
    await expect(generateTextFromPrompt('texto privado')).rejects.toThrow(/política de privacidade/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejeita consentimento antes de construir pedidos externos', async () => {
    setPolicy('confirm-cloud');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(generateTextFromPrompt('texto privado')).rejects.toThrow(/cancelada/);
    await expect(generateImageFromPrompt('imagem privada')).rejects.toThrow(/cancelada/);
    expect(fetch).not.toHaveBeenCalled();
  });

  for (const provider of ['nvidia', 'huggingface', 'openai', 'gemini'] as const) {
    for (const [purpose, generate] of [['texto', generateTextFromPrompt], ['imagem', generateImageFromPrompt]] as const) {
      it(`identifica ${provider} no consentimento de ${purpose} e cancela sem pedido`, async () => {
        // Preserve consent coverage for a future release that explicitly enables OpenAI.
        vi.spyOn(providerPolicy, 'isGenerationProviderEnabled').mockReturnValue(true);
        localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: provider, memoryPermission: 'confirm-cloud' }));
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        await expect(generate('Synthetic prompt')).rejects.toThrow(/cancelada/);
        expect(confirm).toHaveBeenCalledOnce();
        expect(confirm.mock.calls[0][0]).toContain(provider === 'nvidia' ? 'NVIDIA (via Mnemosyne)' : provider === 'huggingface' ? 'Hugging Face Router' : provider === 'gemini' ? 'Google Gemini (via Mnemosyne)' : 'OpenAI (via Mnemosyne)');
        expect(confirm.mock.calls[0][0]).toContain(purpose === 'texto' ? 'geração de texto' : 'geração de imagem');
        expect(fetch).not.toHaveBeenCalled();
      });
    }
  }

  it('refuses stored OpenAI selection before consent or network without changing the selection', async () => {
    const stored = JSON.stringify({ primaryProvider: 'openai', memoryPermission: 'allow-cloud' });
    localStorage.setItem('mnemosyne_local_ai_config', stored);
    const confirm = vi.spyOn(window, 'confirm');
    for (const generate of [generateTextFromPrompt, generateImageFromPrompt]) await expect(generate('Synthetic prompt')).rejects.toThrow(/não está ativo/);
    expect(confirm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('mnemosyne_local_ai_config')).toBe(stored);
  });

  for (const provider of ['nvidia', 'gemini', 'huggingface'] as const) it(`refuses inactive ${provider} without changing the selection or contacting any provider`, async () => {
    const stored = JSON.stringify({ primaryProvider: provider, memoryPermission: 'allow-cloud' });
    localStorage.setItem('mnemosyne_local_ai_config', stored); const confirm = vi.spyOn(window, 'confirm');
    for (const generate of [generateTextFromPrompt, generateImageFromPrompt]) await expect(generate('Synthetic prompt')).rejects.toThrow(/não está ativo/);
    expect(fetch).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(localStorage.getItem('mnemosyne_local_ai_config')).toBe(stored);
  });

  it('keeps the free OpenRouter route behind never-cloud and explicit operation consent with a zero inference price', async () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'openrouter', memoryPermission: 'never-cloud' }));
    await expect(generateTextFromPrompt('Synthetic prompt')).rejects.toThrow(/política de privacidade/);
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'openrouter', memoryPermission: 'confirm-cloud' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await expect(generateTextFromPrompt('Synthetic prompt')).rejects.toThrow(/cancelada/);
    expect(confirm.mock.calls[0][0]).toContain('OpenRouter → Google AI Studio');
    expect(confirm.mock.calls[0][0]).toContain('0 USD'); expect(confirm.mock.calls[0][0]).toContain('retenção');
    await expect(generateImageFromPrompt('Synthetic image')).rejects.toThrow(/gera texto/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps Hugging Face behind never-cloud for text and images', async () => {
    vi.spyOn(providerPolicy, 'isGenerationProviderEnabled').mockReturnValue(true);
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'huggingface', memoryPermission: 'never-cloud' }));
    for (const generate of [generateTextFromPrompt, generateImageFromPrompt]) await expect(generate('Synthetic prompt')).rejects.toThrow(/política de privacidade/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
