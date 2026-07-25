import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

  it('migrates legacy cluster-only permission to allow-cloud', () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({
      memoryPermission: 'cluster-only',
    }));

    expect(getLocalAiConfig().memoryPermission).toBe('allow-cloud');
  });

  it('normalizes invalid primary provider and failure policy', () => {
    localStorage.setItem('mnemosyne_local_ai_config', JSON.stringify({
      primaryProvider: 'unknown',
      failurePolicy: 'ignore-everything',
    }));

    const config = getLocalAiConfig();
    expect(config.primaryProvider).toBe('ollama');
    expect(config.failurePolicy).toBe('save-with-warning');
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
    expect(saved.providers.openai.model).toBe('gpt-test');
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
