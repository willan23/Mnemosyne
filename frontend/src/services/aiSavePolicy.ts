import type { LocalAiConfig } from './localAiConfig';

export type AiFailureDecision = 'continue-save' | 'skip-save' | 'block-save';

export const resolveAiFailureDecision = (
  config: LocalAiConfig,
  aiErrors: string[],
  confirmSaveWithoutAi: () => boolean
): AiFailureDecision => {
  if (aiErrors.length === 0) return 'continue-save';
  if (config.failurePolicy === 'block-save') return 'block-save';
  if (config.failurePolicy === 'confirm-before-save') {
    return confirmSaveWithoutAi() ? 'continue-save' : 'skip-save';
  }
  return 'continue-save';
};
