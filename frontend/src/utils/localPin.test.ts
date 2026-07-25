import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalPinVault,
  disableLocalPin,
  enableLocalPin,
  isLocalPinEnabled,
  unlockWithLocalPin,
  validatePinFormat,
} from './localPin';

const SAMPLE_MNEMONIC = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];

describe('local PIN vault', () => {
  beforeEach(() => {
    clearLocalPinVault();
  });

  it('validates PIN format', () => {
    expect(validatePinFormat('12')).toMatch(/entre/);
    expect(validatePinFormat('abcd')).toMatch(/dígitos/);
    expect(validatePinFormat('1234')).toBeNull();
  });

  it('enables, unlocks and disables PIN-sealed mnemonic', async () => {
    expect(isLocalPinEnabled()).toBe(false);

    await enableLocalPin('4829', '4829', SAMPLE_MNEMONIC);
    expect(isLocalPinEnabled()).toBe(true);

    const unlocked = await unlockWithLocalPin('4829');
    expect(unlocked).toEqual(SAMPLE_MNEMONIC);

    await expect(unlockWithLocalPin('0000')).rejects.toThrow(/PIN incorreto/);

    await disableLocalPin('4829');
    expect(isLocalPinEnabled()).toBe(false);
  });

  it('rejects mismatched confirmation on enable', async () => {
    await expect(enableLocalPin('1234', '9999', SAMPLE_MNEMONIC)).rejects.toThrow(/coincidem/);
  });
});
