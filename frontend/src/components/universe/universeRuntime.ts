import { createContext, useContext, type MutableRefObject } from 'react';
import type { SphereGeometry } from 'three';
import type { MemoryObject } from '../../types/universe';
import type { UniverseQualityProfile } from './qualityProfile';
import type { OrbitPositionAccess } from '../../hooks/useOrbitLayout';

export interface UniverseRuntime {
  lookupRef: MutableRefObject<ReadonlyMap<string, MemoryObject>>;
  orbitRef: MutableRefObject<OrbitPositionAccess>;
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
