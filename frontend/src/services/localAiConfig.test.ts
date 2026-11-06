import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MODEL_PRESETS,
  isAiProviderEnabled,
  clearProviderSecret,
  getLocalAiConfig,
  hasProviderSecret,
  readProviderSecret,
  saveLocalAiConfig,
  saveProviderSecret,
  type LocalAiConfig,
} from './localAiConfig';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' ');
const wrongMnemonic = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'.split(' ');

describe('local AI configuration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to local-first and save-with-warning behavior', () => {
    const config = getLocalAiConfig();

    expect(config.primaryProvider).toBe('ollama');
    expect(config.memoryPermission).toBe('never-cloud');
    expect(config.failurePolicy).toBe('save-with-warning');
    expect(config.providers.ollama.enabled).toBe(true);
  });

  it('only lists model presets the generation path can send', () => {
    expect(AI_MODEL_PRESETS.openrouter.map(preset => preset.id)).toEqual(['openrouter-gemma-4-free']);
    expect(AI_MODEL_PRESETS.nvidia.map((preset) => preset.id)).toEqual(['nvidia-nemotron-ultra']);
    expect(AI_MODEL_PRESETS.huggingface.map((preset) => preset.id)).toEqual(['hf-default']);
    expect(AI_MODEL_PRESETS.openai.map((preset) => preset.id)).toEqual(['openai-mini']);
    expect(AI_MODEL_PRESETS.gemini.map(preset => preset.id)).toEqual(['gemini-flash']);
    expect(AI_MODEL_PRESETS.anthropic).toEqual([]);
    expect(AI_MODEL_PRESETS.mistral).toEqual([]);
  });

  it('enables the launch providers and preserves an inactive OpenAI selection without fallback', () => {
    for (const provider of ['ollama', 'openrouter'] as const) expect(isAiProviderEnabled(provider)).toBe(true);
    for (const provider of ['nvidia', 'huggingface', 'gemini'] as const) expect(isAiProviderEnabled(provider)).toBe(false);
    expect(isAiProviderEnabled('openai')).toBe(false);
    for (const provider of ['nvidia', 'openai', 'huggingface', 'gemini']) {
      localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: provider }));
      expect(getLocalAiConfig().primaryProvider).toBe(provider);
    }
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'openai' }));
    expect(getLocalAiConfig().primaryProvider).toBe('openai');
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'huggingface', providers: { huggingface: { model: 'unknown' } } }));
    expect(getLocalAiConfig().providers.huggingface.model).toBe('hf-default');
  });

  it('normalizes an OpenRouter selection to the only server-allowlisted free model without storing a key', () => {
    for (const model of ['openrouter-gemma-4-free', 'google/gemma-4-31b-it', 'openrouter/auto', 'unknown']) {
      localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'openrouter', providers: { openrouter: { model } } }));
      const config = getLocalAiConfig(); expect(config.primaryProvider).toBe('openrouter');
      expect(config.providers.openrouter.model).toBe('openrouter-gemma-4-free'); expect(config.providers.openrouter.hasSecret).toBe(false);
    }
  });

  it('migrates legacy cluster-only permission to confirmation', () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({
      memoryPermission: 'cluster-only',
    }));

    expect(getLocalAiConfig().memoryPermission).toBe('confirm-cloud');
  });

  it('uses Ultra for a new NVIDIA selection and preserves explicitly saved Super selections', () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'nvidia' }));
    expect(getLocalAiConfig().providers.nvidia.model).toBe('nvidia-nemotron-ultra');
    for (const model of ['nvidia-nemotron', 'nvidia-llama', 'meta/llama-3.1-70b-instruct']) {
      localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'nvidia', providers: { nvidia: { model } } }));
      expect(getLocalAiConfig().providers.nvidia.model).toBe('nvidia-nemotron');
    }
    const config = getLocalAiConfig();
    config.providers.nvidia.model = 'nvidia-nemotron-ultra';
    expect(saveLocalAiConfig(config).providers.nvidia.model).toBe('nvidia-nemotron-ultra');
  });

  it('normalizes invalid primary provider and failure policy', () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({
      primaryProvider: 'unknown',
      failurePolicy: 'ignore-everything',
      memoryPermission: 'unexpected-cloud-policy',
    }));

    const config = getLocalAiConfig();
    expect(config.primaryProvider).toBe('ollama');
    expect(config.failurePolicy).toBe('save-with-warning');
    expect(config.memoryPermission).toBe('never-cloud');
  });

  it('migrates a provider without a generation adapter back to local mode', () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({ primaryProvider: 'anthropic' }));
    expect(getLocalAiConfig().primaryProvider).toBe('ollama');
  });

  it('persists normalized config and emits an update event', () => {
    const listener = vi.fn();
    window.addEventListener('mnemosyne:local-ai-config', listener);

    const saved = saveLocalAiConfig({
      ...getLocalAiConfig(),
      primaryProvider: 'openai',
      memoryPermission: 'confirm-cloud',
      failurePolicy: 'block-save',
      providers: {
        ...getLocalAiConfig().providers,
        openai: {
          enabled: true,
          endpoint: ' https://api.openai.com/v1/ ',
          model: ' gpt-test ',
          hasSecret: true,
        },
      },
    } as LocalAiConfig);

    expect(saved.primaryProvider).toBe('openai');
    expect(saved.memoryPermission).toBe('confirm-cloud');
    expect(saved.failurePolicy).toBe('block-save');
    expect(saved.providers.openai.endpoint).toBe('https://api.openai.com/v1');
    expect(saved.providers.openai.model).toBe('openai-mini');
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener('mnemosyne:local-ai-config', listener);
  });

  it('encrypts provider secrets and reads them only with the mnemonic', async () => {
    await saveProviderSecret('user-1', 'openai', ' sk-live-secret ', mnemonic);

    const stored = localStorage.getItem('mnemosyne_ai_secret_user-1_openai');
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('sk-live-secret');
    expect(hasProviderSecret('user-1', 'openai')).toBe(true);
    await expect(readProviderSecret('user-1', 'openai', mnemonic)).resolves.toBe('sk-live-secret');
    await expect(readProviderSecret('user-1', 'openai', wrongMnemonic)).rejects.toThrow();

    clearProviderSecret('user-1', 'openai');
    expect(hasProviderSecret('user-1', 'openai')).toBe(false);
  });

  it('refuses to save provider secrets without an unlocked 12-word mnemonic', async () => {
    await expect(saveProviderSecret('user-1', 'openai', 'secret', null)).rejects.toThrow(
      'Desbloqueia primeiro a tua mnemónica Zero-Knowledge para cifrar a API key.'
    );
    await expect(saveProviderSecret('user-1', 'openai', 'secret', mnemonic.slice(0, 11))).rejects.toThrow();
    await expect(saveProviderSecret('user-1', 'openai', '   ', mnemonic)).rejects.toThrow('A API key está vazia.');
  });
});
