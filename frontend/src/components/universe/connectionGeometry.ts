/** Quadratic Bézier at `t` ∈ [0, 1]. Writes into `out` as xyz. */
export function quadraticBezierPoint(
  out: Float32Array,
  offset: number,
  t: number,
  sx: number,
  sy: number,
  sz: number,
  cx: number,
  cy: number,
  cz: number,
  ex: number,
  ey: number,
  ez: number,
): void {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  out[offset] = a * sx + b * cx + c * ex;
  out[offset + 1] = a * sy + b * cy + c * ey;
  out[offset + 2] = a * sz + b * cz + c * ez;
}

export function connectionControlPoint(
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
): [number, number, number] {
  const mx = (sx + ex) * 0.5;
  const my = (sy + ey) * 0.5;
  const mz = (sz + ez) * 0.5;
  const dx = ex - sx;
  const dy = ey - sy;
  const dz = ez - sz;
  const distance = Math.hypot(dx, dy, dz);
  const lift = Math.min(7, Math.max(0.8, distance * 0.16));
  const midLen = Math.hypot(mx, my, mz);
  if (midLen < 1e-4) {
    return [mx, my + lift, mz];
  }
  return [mx + (mx / midLen) * lift, my + (my / midLen) * lift, mz + (mz / midLen) * lift];
}

/**
 * Writes `segments` line pairs (start→next) for a lifted arc into `positions`.
 * Returns the next float offset.
 */
export function writeArcLinePairs(
  positions: Float32Array,
  offset: number,
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
  segments: number,
): number {
  const [cx, cy, cz] = connectionControlPoint(sx, sy, sz, ex, ey, ez);
  const safeSegments = Math.max(1, Math.floor(segments));

  for (let i = 0; i < safeSegments; i += 1) {
    const t0 = i / safeSegments;
    const t1 = (i + 1) / safeSegments;
    quadraticBezierPoint(positions, offset, t0, sx, sy, sz, cx, cy, cz, ex, ey, ez);
    quadraticBezierPoint(positions, offset + 3, t1, sx, sy, sz, cx, cy, cz, ex, ey, ez);
    offset += 6;
  }

  return offset;
}

export function sampleArcPoint(
  out: Float32Array,
  offset: number,
  t: number,
  sx: number,
  sy: number,
  sz: number,
  ex: number,
  ey: number,
  ez: number,
): void {
  const [cx, cy, cz] = connectionControlPoint(sx, sy, sz, ex, ey, ez);
  quadraticBezierPoint(out, offset, t, sx, sy, sz, cx, cy, cz, ex, ey, ez);
}
