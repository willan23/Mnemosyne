import { describe, expect, it, vi } from 'vitest';
import type { LocalAiConfig } from './localAiConfig';
import { resolveAiFailureDecision } from './aiSavePolicy';
import { defaultLocalAiConfig } from './localAiConfig';

const config = (overrides: Partial<LocalAiConfig>): LocalAiConfig => ({
  ...defaultLocalAiConfig,
  providers: { ...defaultLocalAiConfig.providers },
  ...overrides,
});

describe('AI save policy integration decisions', () => {
  it('continues saving when no AI errors exist regardless of policy', () => {
    const confirmSaveWithoutAi = vi.fn(() => false);

    expect(resolveAiFailureDecision(config({ failurePolicy: 'block-save' }), [], confirmSaveWithoutAi)).toBe('continue-save');
    expect(resolveAiFailureDecision(config({ failurePolicy: 'confirm-before-save' }), [], confirmSaveWithoutAi)).toBe('continue-save');
    expect(confirmSaveWithoutAi).not.toHaveBeenCalled();
  });

  it('maps AI failure policies to save decisions', () => {
    expect(resolveAiFailureDecision(
      config({ failurePolicy: 'save-with-warning' }),
      ['Embeddings locais indisponíveis.'],
      vi.fn(() => false)
    )).toBe('continue-save');

    expect(resolveAiFailureDecision(
      config({ failurePolicy: 'block-save' }),
      ['Embeddings locais indisponíveis.'],
      vi.fn(() => true)
    )).toBe('block-save');
  });

  it('asks before saving without AI when policy requires confirmation', () => {
    const accept = vi.fn(() => true);
    const reject = vi.fn(() => false);
    const base = config({ failurePolicy: 'confirm-before-save' });

    expect(resolveAiFailureDecision(base, ['NVIDIA NIM indisponível.'], accept)).toBe('continue-save');
    expect(resolveAiFailureDecision(base, ['NVIDIA NIM indisponível.'], reject)).toBe('skip-save');
    expect(accept).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
  });
});
