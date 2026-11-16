import type { ReactNode } from 'react';
import { Html } from '@react-three/drei';

interface SceneLabelProps {
  children: ReactNode;
  position?: [number, number, number];
  fontSize: number;
  color: string;
  maxWidth: number;
  opacity?: number;
}

// Html's transform maps a CSS pixel to distanceFactor / 400 world units.
const DISTANCE_FACTOR = 10;
const PIXELS_PER_WORLD_UNIT = 400 / DISTANCE_FACTOR;

/** Camera-facing labels use the existing scene transform and the app's local fonts. */
export function SceneLabel({ children, position, fontSize, color, maxWidth, opacity = 1 }: SceneLabelProps) {
  return (
    <Html transform center position={position} distanceFactor={DISTANCE_FACTOR} zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
      <span data-scene-label style={{
        display: 'block', width: 'max-content', maxWidth: maxWidth * PIXELS_PER_WORLD_UNIT,
        color, opacity, fontSize: fontSize * PIXELS_PER_WORLD_UNIT, lineHeight: 1.25,
        textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif',
        whiteSpace: 'normal', overflowWrap: 'anywhere', userSelect: 'none',
      }}>{children}</span>
    </Html>
  );
}
