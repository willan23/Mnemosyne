import { Capacitor } from '@capacitor/core';

export interface UniverseDeviceHints {
  android: boolean;
  native: boolean;
}

export interface UniverseQualityProfile {
  dpr: [number, number];
  antialias: boolean;
  /** Extra glow meshes / attachment orbits / nebula dust. */
  reduceEffects: boolean;
  isAndroid: boolean;
  connectionSegments: number;
  activeConnectionSegments: number;
  maxPulseSignals: number;
  fogDensity: number;
}

export function detectUniverseDevice(): UniverseDeviceHints {
  try {
    return {
      android: Capacitor.getPlatform() === 'android',
      native: Capacitor.isNativePlatform(),
    };
  } catch {
    return { android: false, native: false };
  }
}

/**
 * Quality vs battery: desktop stays at dpr 1–1.5; Android locks to 1×
 * and skips expensive layers. More than 150 memories also reduces effects
 * (no composer bloom — that pass is not cheap without a dedicated lib).
 */
export function getUniverseQualityProfile(
  memoryCount: number,
  device: UniverseDeviceHints = detectUniverseDevice(),
): UniverseQualityProfile {
  const isAndroid = device.android;
  const reduceEffects = memoryCount > 150 || isAndroid;

  return {
    dpr: isAndroid ? [1, 1] : [1, 1.5],
    antialias: !isAndroid,
    reduceEffects,
    isAndroid,
    connectionSegments: reduceEffects ? 6 : 10,
    activeConnectionSegments: reduceEffects ? 12 : 20,
    maxPulseSignals: reduceEffects ? 2 : 6,
    fogDensity: reduceEffects ? 0.0055 : 0.0072,
  };
}
