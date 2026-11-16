import { afterEach, expect, it, vi } from 'vitest';
import { generationBackendBase, generationBackendUrl } from './generationEndpoints';

afterEach(() => vi.unstubAllEnvs());

it('addresses the same Firebase project directly and does not inherit the retired VITE_API_URL backend', () => {
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-mnemosyne-rules'); vi.stubEnv('VITE_API_URL', 'http://localhost:8000');
  vi.stubEnv('VITE_FIREBASE_FUNCTIONS_EMULATOR_ORIGIN', '');
  expect(generationBackendBase()).toBe('https://europe-west1-demo-mnemosyne-rules.cloudfunctions.net');
  expect(generationBackendUrl('image')).toBe('https://europe-west1-demo-mnemosyne-rules.cloudfunctions.net/generateImage');
});
it('uses an explicit development emulator without falling back to any public endpoint', () => {
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-mnemosyne-rules');
  vi.stubEnv('VITE_FIREBASE_FUNCTIONS_EMULATOR_ORIGIN', 'http://127.0.0.1:5001');
  expect(generationBackendUrl('text')).toBe('http://127.0.0.1:5001/demo-mnemosyne-rules/europe-west1/generateText');
  vi.stubEnv('DEV', false); expect(() => generationBackendUrl('text')).toThrow(/produção/);
});
