import type { LocalAiConfig } from './localAiConfig';

export type AiFailureDecision = 'continue-save' | 'skip-save' | 'block-save';

export const shouldUseNvidiaBackend = (
  config: LocalAiConfig,
  confirmCloudUse: () => boolean
): boolean => {
  if (config.primaryProvider !== 'nvidia') return false;
  if (config.memoryPermission === 'never-cloud') return false;
  if (config.memoryPermission === 'confirm-cloud') return confirmCloudUse();
  return true;
};

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
