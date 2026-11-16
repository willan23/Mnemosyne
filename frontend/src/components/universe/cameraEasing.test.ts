import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  computeFocusCameraPosition,
  computeFocusDistance,
  computeMinOrbitDistance,
  expAlpha,
  expSmoothScalar,
  expSmoothVec3,
} from './cameraEasing';

describe('cameraEasing', () => {
  it('produces a frame-rate independent blend factor', () => {
    expect(expAlpha(0, 4)).toBe(0);
    expect(expAlpha(1, 0)).toBe(0);
    expect(expAlpha(10, 4)).toBeGreaterThan(0.99);
    expect(expAlpha(1 / 60, 4)).toBeGreaterThan(0);
    expect(expAlpha(1 / 60, 4)).toBeLessThan(expAlpha(1 / 30, 4));
  });

  it('eases a scalar toward the target without overshooting', () => {
    let value = 0;
    for (let i = 0; i < 40; i += 1) {
      value = expSmoothScalar(value, 10, 1 / 60, 6);
    }
    expect(value).toBeGreaterThan(8);
    expect(value).toBeLessThanOrEqual(10);
  });

  it('eases a camera position in place', () => {
    const current = new Vector3(0, 0, 0);
    const target = new Vector3(0, 8, 28);
    expSmoothVec3(current, target, 1 / 30, 3.2);
    expect(current.z).toBeGreaterThan(0);
    expect(current.z).toBeLessThan(28);
    expect(current.y).toBeGreaterThan(0);
  });

  it('keeps focus distance and orbit clearance proportional to scale', () => {
    expect(computeFocusDistance(0.2)).toBe(5.5);
    expect(computeFocusDistance(3)).toBe(15);
    expect(computeMinOrbitDistance(0.2)).toBe(1.5);
    expect(computeMinOrbitDistance(4)).toBeCloseTo(6.2, 5);
  });

  it('places the camera along the current view ray at the focus distance', () => {
    const target = new Vector3(10, 0, 0);
    const camera = new Vector3(10, 0, 20);
    const lookAt = new Vector3(10, 0, 0);
    const out = new Vector3();

    computeFocusCameraPosition(target, camera, lookAt, 8, out);

    expect(out.distanceTo(target)).toBeCloseTo(8, 5);
    expect(out.x).toBeCloseTo(10, 5);
    expect(out.z).toBeGreaterThan(target.z);
  });
});
