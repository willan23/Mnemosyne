import { createContext, useContext, type MutableRefObject } from 'react';
import type { SphereGeometry } from 'three';
import type { MemoryObject } from '../../types/universe';
import type { UniverseQualityProfile } from './qualityProfile';

export interface UniverseRuntime {
  memoriesRef: MutableRefObject<MemoryObject[]>;
  lookupRef: MutableRefObject<Map<string, MemoryObject>>;
  sphereGeometry: SphereGeometry;
  glowGeometry: SphereGeometry;
  quality: UniverseQualityProfile;
}

export const UniverseRuntimeContext = createContext<UniverseRuntime | null>(null);

export function useUniverseRuntime(): UniverseRuntime {
  const runtime = useContext(UniverseRuntimeContext);
  if (!runtime) {
    throw new Error('useUniverseRuntime must be used inside UniverseScene');
  }
  return runtime;
}
