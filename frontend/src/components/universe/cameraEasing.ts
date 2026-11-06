import type { Vector3 } from 'three';

/** Frame-rate independent exponential blend factor. `dt=0` → 0; large `dt` → ~1. */
export function expAlpha(dt: number, stiffness: number): number {
  return 1 - Math.exp(-Math.max(0, stiffness) * Math.max(0, dt));
}

export function expSmoothScalar(
  current: number,
  target: number,
  dt: number,
  stiffness: number,
): number {
  return current + (target - current) * expAlpha(dt, stiffness);
}

/** In-place exponential ease of a Vector3 toward `target`. */
export function expSmoothVec3(
  current: Vector3,
  target: Vector3,
  dt: number,
  stiffness: number,
): Vector3 {
  const alpha = expAlpha(dt, stiffness);
  current.x += (target.x - current.x) * alpha;
  current.y += (target.y - current.y) * alpha;
  current.z += (target.z - current.z) * alpha;
  return current;
}

export function computeFocusDistance(scale: number): number {
  return Math.max(5.5, scale * 4 + 3);
}

export function computeMinOrbitDistance(scale: number): number {
  return Math.max(1.5, scale * 1.35 + 0.8);
}

/**
 * Keep the current view direction, but sit `focusDistance` away from `target`.
 * Writes into `out` to avoid allocations in the render loop.
 */
export function computeFocusCameraPosition(
  target: Vector3,
  currentCamera: Vector3,
  currentLookAt: Vector3,
  focusDistance: number,
  out: Vector3,
): Vector3 {
  out.copy(currentCamera).sub(currentLookAt);
  if (out.lengthSq() < 1e-6) {
    out.set(0, 0.25, 1);
  }
  return out.normalize().multiplyScalar(focusDistance).add(target);
}
