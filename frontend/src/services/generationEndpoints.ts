import { generationFunctionsBase, generationFunctionUrl, type GenerationHttpKind } from '../../../functions/src/generationHttpPolicy';

const config = () => ({
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'mnemosyne-one',
  development: import.meta.env.DEV,
  emulatorOrigin: import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_ORIGIN || undefined,
});

export const generationBackendBase = () => generationFunctionsBase(config());
export const generationBackendUrl = (kind: GenerationHttpKind) => generationFunctionUrl(kind, config());
