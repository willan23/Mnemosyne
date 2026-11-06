import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLocalPinVault,
  disableLocalPin,
  enableLocalPin,
  isLocalPinEnabled,
  unlockWithLocalPin,
  validatePinFormat,
  writeLocalPinVault,
} from './localPin';

const SAMPLE_MNEMONIC = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
];

describe('local PIN vault', () => {
  beforeEach(() => {
    clearLocalPinVault();
  });

  it('validates PIN format on create (min 6 alphanumeric)', () => {
    expect(validatePinFormat('12')).toMatch(/entre/);
    expect(validatePinFormat('1234')).toMatch(/entre/);
    expect(validatePinFormat('abcd!!')).toMatch(/alfanumérico/);
    expect(validatePinFormat('123456')).toBeNull();
    expect(validatePinFormat('Ab12cd')).toBeNull();
  });

  it('accepts legacy 4-digit PINs only on unlock', () => {
    expect(validatePinFormat('1234', 'unlock')).toBeNull();
    expect(validatePinFormat('12', 'unlock')).toMatch(/entre/);
    expect(validatePinFormat('1234', 'create')).toMatch(/entre/);
  });

  it('enables, unlocks and disables PIN-sealed mnemonic', async () => {
    expect(isLocalPinEnabled()).toBe(false);

    await enableLocalPin('4829ab', '4829ab', SAMPLE_MNEMONIC);
    expect(isLocalPinEnabled()).toBe(true);

    const unlocked = await unlockWithLocalPin('4829ab');
    expect(unlocked).toEqual(SAMPLE_MNEMONIC);

    await expect(unlockWithLocalPin('000000')).rejects.toThrow(/PIN incorreto/);

    await disableLocalPin('4829ab');
    expect(isLocalPinEnabled()).toBe(false);
  });

  it('unlocks a legacy 4-digit PIN vault', async () => {
    await writeLocalPinVault('4829', SAMPLE_MNEMONIC);
    const unlocked = await unlockWithLocalPin('4829');
    expect(unlocked).toEqual(SAMPLE_MNEMONIC);
  });

  it('rejects mismatched confirmation on enable', async () => {
    await expect(enableLocalPin('123456', '999999', SAMPLE_MNEMONIC)).rejects.toThrow(/coincidem/);
  });

  it('rejects short PIN on create', async () => {
    await expect(enableLocalPin('1234', '1234', SAMPLE_MNEMONIC)).rejects.toThrow(/entre/);
  });
});
